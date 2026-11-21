import { Hono } from "hono";
import { PROBLEMS } from "../problem.js";
import { buildReceipt } from "../receipt.js";
import {
  buildEvidenceBundle,
  evaluatePayment,
  normalizePaymentRequired,
  buildReviewPacket,
} from "@paystage/preflight";
import { BUNDLE_STORE_VAR, type BundleStore } from "../bundle-store.js";
import { parsePolicyCached } from "../policy-cache.js";
import { checkAddressRisk } from "../address-risk.js";
import { checkHostReputation, youngestSignal, YOUNG_DOMAIN_DAYS } from "../host-reputation.js";
import {
  listOutstandingAuths,
  evaluateOutstandingAuths,
  createRpcClient,
  resolveRpcUrl,
} from "@paystage/auth-watch";

export const evaluateRoutes = new Hono<{ Variables: { bundleStore: BundleStore | undefined } }>();

evaluateRoutes.post("/v1/evaluate_mcp_payment", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(PROBLEMS.invalidJson(), 400);
  }
  const b = body as { payment_required?: unknown; policy?: unknown; agent_id?: unknown };
  if (!b || typeof b !== "object" || b.payment_required == null) {
    return c.json(PROBLEMS.missingPaymentRequired(), 400);
  }
  if (b.agent_id !== undefined && typeof b.agent_id !== "string") {
    return c.json(PROBLEMS.agentIdType(), 400);
  }
  try {
    const normalized = normalizePaymentRequired(b.payment_required as never);
    const policy = parsePolicyCached(b.policy);
    // Without this the hosted API could not reach per-agent budgets at all: the policy
    // declares them, the packages enforce them, and the endpoint silently judged every
    // caller against the loosest rules in the file.
    // Capture the clock explicitly: a time-window verdict is only recomputable if the
    // bundle records the hour the evaluator saw.
    const evaluatedAt = new Date();
    const decision = evaluatePayment(normalized, policy, {
      now: evaluatedAt,
      ...(typeof b.agent_id === "string" ? { agentId: b.agent_id } : {}),
    });

    /**
     * A second source, consulted only when the answer is `pay`.
     *
     * The order matters: our own lists and the caller's policy decide first, and the feed only gets a vote on a payment that
     * would otherwise go through. A flag turns the verdict into `do_not_pay` naming the source; an *outage* turns it into
     * `review`, because "we could not check" and "we checked and it is clean" must never produce the same answer.
     */
    const payee = (normalized.accepts?.[0] as { payTo?: string } | undefined)?.payTo;
    if (decision.decision === "pay" && typeof payee === "string" && /^0x[a-fA-F0-9]{40}$/.test(payee)) {
      const risk = await checkAddressRisk(payee, {
        chainId: String((normalized.accepts?.[0] as { network?: string } | undefined)?.network ?? "").includes("84532")
          ? "84532"
          : "8453",
      });
      /**
       * Reputation is the *other* half of the same question (#164): the payee registry speaks only about hosts we have probed, and
       * for every other host the honest answer is silence. A domain registered last month has no history to lose, which is the
       * shape of a clone — so it turns `pay` into `review`, and it never turns anything into a refusal.
       */
      const resourceUrl = (normalized.resource as { url?: string } | undefined)?.url;
      if (resourceUrl) {
        try {
          const host = new URL(resourceUrl).host;
          const reputation = await checkHostReputation(host);
          /**
           * The observation is returned whether or not it changes the verdict.
           *
           * A check that only speaks when it fires is indistinguishable from a check that never ran — the first live test of this
           * returned `pay` and there was no way to tell whether the domain was old or the lookup had failed. Publishing the fact
           * makes the difference visible to the caller and to us.
           */
          (decision as unknown as Record<string, unknown>).seller_reputation = {
            host: reputation.host,
            registered_at: reputation.registered_at,
            domain_age_days: reputation.domain_age_days,
            first_certificate_at: reputation.first_certificate_at,
            ...(reputation.error ? { error: reputation.error } : {}),
          };
          const youngest = youngestSignal(reputation);
          if (youngest && youngest.days < YOUNG_DOMAIN_DAYS) {
            decision.decision = "review";
            decision.reasons = [
              `seller host ${reputation.host}: ${youngest.source === "domain" ? "domain" : "first certificate"} is ${youngest.days} days old — a host with no history has none to lose`,
              ...(decision.reasons ?? []),
            ];
          }
        } catch {
          // A malformed resource URL is not a reputation finding; fall through with the verdict we already had.
        }
      }

      if (risk.flagged.length > 0) {
        decision.decision = "do_not_pay";
        decision.reasons = [
          `payee flagged by the address-risk feed (gopluslabs): ${risk.flagged.join(", ")}`,
          ...(decision.reasons ?? []),
        ];
      } else if (risk.error) {
        decision.decision = "review";
        decision.reasons = [
          `address-risk check could not complete (gopluslabs): ${risk.error}`,
          ...(decision.reasons ?? []),
        ];
      }
    }
    // A review that the hosted-only network checks produced is still a review,
    // and still owes the human the same case. The evaluator's own verdict was
    // `pay`, so it could not build this packet; build it from the same helper so
    // the shape and the rule string cannot drift from the local one.
    if (decision.decision === "review" && decision.packet === undefined && decision.selectedAccept) {
      decision.packet = buildReviewPacket(
        policy,
        decision.selectedAccept,
        normalized.resource,
        decision.reasons[0] ?? "review",
        {
          networkChecks: true,
          allRulesRan: true,
          checked: ["seller reputation and address-risk feed: checked by the hosted API"],
        },
      );
    }
    // Additive: the receipt binds the verdict to these exact inputs. It never
    // changes the decision, and degrades to signed:false when no key is set.
    // Bind the receipt to the payment it is about, so a verifier holding both can tell whether the decision
    // refers to *this* payment rather than merely to a request that hashed the same.
    const chosen = normalized.accepts?.[0] as
      | { scheme?: string; network?: string; asset?: string; amount?: string; maxAmountRequired?: string; payTo?: string }
      | undefined;
    const receipt = await buildReceipt({
      decision,
      request: normalized,
      policy,
      ...(chosen
        ? {
            payment: {
              scheme: chosen.scheme ?? "exact",
              network: chosen.network ?? "",
              asset: chosen.asset ?? "",
              amount: chosen.amount ?? chosen.maxAmountRequired ?? "",
              payee: chosen.payTo ?? "",
            },
          }
        : {}),
      signingKeyPkcs8B64: (c.env as { RECEIPT_SIGNING_KEY_PKCS8?: string } | undefined)?.RECEIPT_SIGNING_KEY_PKCS8,
      // Which build produced this verdict. Unset means the receipt says "unknown" rather
      // than advertising a placeholder version as provenance.
      serviceVersion: (c.env as { PAYSTAGE_SERVICE_VERSION?: string } | undefined)?.PAYSTAGE_SERVICE_VERSION,
    });
    /**
     * The record of this decision, built from the evaluator's own transcript. Storage is
     * best-effort: a verdict must never be withheld because accounting failed, but the
     * response says `bundle_stored: false` rather than letting the caller assume a GET
     * will find it.
     */
    let bundleId: string | undefined;
    let bundleStored = false;
    let bundleError: string | undefined;
    try {
      const bundle = await buildEvidenceBundle(
        {
          payment_required: normalized,
          policy,
          options: {
            now: evaluatedAt,
            ...(typeof b.agent_id === "string" ? { agent_id: b.agent_id } : {}),
          },
          receipt,
        },
        decision,
      );
      bundleId = bundle.bundle_id;
      const store = c.get(BUNDLE_STORE_VAR);
      if (store !== undefined) {
        try {
          await store.put({
            id: bundle.bundle_id,
            decision: decision.decision,
            events: bundle.events_jsonl,
            proof: bundle.proof,
            receipt: bundle.receipt ?? null,
            summary: bundle.summary_md,
          });
          bundleStored = true;
        } catch (storageError) {
          bundleError = storageError instanceof Error ? storageError.message : String(storageError);
          console.log(
            JSON.stringify({
              level: "error",
              msg: "evidence_bundle_write_failed",
              error: bundleError,
            }),
          );
        }
      }
    } catch (bundleBuildError) {
      bundleError = bundleBuildError instanceof Error ? bundleBuildError.message : String(bundleBuildError);
      console.log(
        JSON.stringify({
          level: "error",
          msg: "evidence_bundle_build_failed",
          error: bundleError,
        }),
      );
    }

    return c.json({
      ...decision,
      receipt,
      ...(bundleId !== undefined ? { bundle_id: bundleId } : {}),
      bundle_stored: bundleStored,
      ...(bundleError !== undefined ? { bundle_error: bundleError } : {}),
    });
  } catch (err) {
    return c.json(
      PROBLEMS.evaluationFailed((err as Error).message),
      400,
    );
  }
});

/**
 * The paid-only alias (#150) is the same evaluation, reachable at a path the free tier never answers.
 *
 * Implemented as a forward to the canonical path rather than a second copy of the handler: two copies of a payment evaluator
 * drift, and the drift would be invisible until a caller got a different verdict from the alias.
 */
evaluateRoutes.post("/v1/paid/evaluate_mcp_payment", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/v1/evaluate_mcp_payment";
  return evaluateRoutes.fetch(new Request(url.toString(), c.req.raw));
});

evaluateRoutes.post("/v1/evaluate_outstanding_auths", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(PROBLEMS.invalidJson(), 400);
  }
  const b = body as {
    wallet?: unknown;
    network?: unknown;
    tokens?: unknown;
    spenders?: unknown;
    policy?: unknown;
    eip3009_nonces?: unknown;
    rpc_url?: unknown;
  };
  if (!b || typeof b !== "object" || typeof b.wallet !== "string") {
    return c.json(PROBLEMS.missingWallet(), 400);
  }
  try {
    const policy = parsePolicyCached(b.policy);
    const network =
      typeof b.network === "string" ? b.network : "eip155:84532";
    const rpc = createRpcClient(
      typeof b.rpc_url === "string" ? b.rpc_url : resolveRpcUrl(network),
    );
    const tokens = Array.isArray(b.tokens)
      ? (b.tokens as string[])
      : policy.allowed_assets
          .filter((a) => a.network === network)
          .map((a) => a.address);
    const spenders = Array.isArray(b.spenders)
      ? (b.spenders as string[])
      : (policy.allowed_spenders ?? policy.allowed_pay_to);
    const eip3009Nonces = Array.isArray(b.eip3009_nonces)
      ? (b.eip3009_nonces as string[])
      : undefined;
    const listed = await listOutstandingAuths({
      wallet: b.wallet,
      network,
      tokens,
      spenders,
      rpc,
      eip3009Nonces,
    });
    const evaluated = evaluateOutstandingAuths(listed, policy);
    return c.json({ listed, evaluated });
  } catch (err) {
    return c.json(
      PROBLEMS.evaluationFailed((err as Error).message),
      400,
    );
  }
});

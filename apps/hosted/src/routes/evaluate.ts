import { Hono } from "hono";
import { PROBLEMS } from "../problem.js";
import { buildReceipt } from "../receipt.js";
import {
  buildEvidenceBundle,
  evaluateWithChallengeIdempotency,
  normalizePaymentRequired,
  buildReviewPacket,
  type MandateEvaluationInput,
} from "@paystage/preflight";
import { BUNDLE_STORE_VAR, type BundleStore } from "../bundle-store.js";
import type { MandateSource } from "./mandate.js";
import { parsePolicyCached } from "../policy-cache.js";
import { checkAddressRisk } from "../address-risk.js";
import { checkHostReputation, youngestSignal, YOUNG_DOMAIN_DAYS } from "../host-reputation.js";
import {
  listOutstandingAuths,
  evaluateOutstandingAuths,
  createRpcClient,
  resolveRpcUrl,
} from "@paystage/auth-watch";

export function createEvaluateRoutes(
  options: { mandateSource?: MandateSource } = {},
): Hono<{ Variables: { bundleStore: BundleStore | undefined } }> {
  const routes = new Hono<{ Variables: { bundleStore: BundleStore | undefined } }>();

/**
 * Parse the optional `mandate` field (#473).
 *
 * A mandate is an *additional* restriction: it can only narrow what the policy already allows, so a
 * malformed one fails closed (the evaluator names `mandate.malformed`) rather than falling back to the
 * looser policy. This function only rejects shapes that cannot be read at all; the rule-level validation
 * — including the revocation check — stays in the evaluator so the rule names cannot drift.
 *
 * The caller supplies the envelope and any revocation statements it has seen, exactly as the evaluator's
 * contract says: signatures are verified before this point (`@paystage/mandate`'s `verify`), because this
 * synchronous evaluator holds no keys. The hosted route does not invent a revocation from a claim; it
 * will only refuse a payment when the caller passes a statement naming that serial.
 */
function parseMandateInput(
  raw: unknown,
): { ok: true; value: MandateEvaluationInput | undefined } | { ok: false; detail: string } {
  if (raw === undefined) return { ok: true, value: undefined };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, detail: "`mandate` must be an object, not a scalar or an array." };
  }
  const input = raw as Record<string, unknown>;
  if (input.mandate === null || typeof input.mandate !== "object" || Array.isArray(input.mandate)) {
    return { ok: false, detail: "`mandate.mandate` must be the signed mandate envelope object." };
  }
  if (input.history !== undefined && !Array.isArray(input.history)) {
    return { ok: false, detail: "`mandate.history` must be an array of settled payments." };
  }
  if (input.revocations !== undefined && !Array.isArray(input.revocations)) {
    return { ok: false, detail: "`mandate.revocations` must be an array of verified revocation statements." };
  }
  return {
    ok: true,
    value: {
      mandate: input.mandate as MandateEvaluationInput["mandate"],
      ...(input.history === undefined ? {} : { history: input.history as MandateEvaluationInput["history"] }),
      ...(input.revocations === undefined
        ? {}
        : { revocations: input.revocations as MandateEvaluationInput["revocations"] }),
    },
  };
}

routes.post("/v1/evaluate_mcp_payment", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(PROBLEMS.invalidJson(), 400);
  }
  const b = body as {
    payment_required?: unknown;
    policy?: unknown;
    agent_id?: unknown;
    mandate?: unknown;
  };
  if (!b || typeof b !== "object" || b.payment_required == null) {
    return c.json(PROBLEMS.missingPaymentRequired(), 400);
  }
  if (b.agent_id !== undefined && typeof b.agent_id !== "string") {
    return c.json(PROBLEMS.agentIdType(), 400);
  }
  const mandate = parseMandateInput(b.mandate);
  if (!mandate.ok) {
    return c.json(PROBLEMS.invalidMandate(mandate.detail), 400);
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
    /**
     * #444: the verdict carries the canonical challenge digest, and a host that owns a repeat store
     * can return the original verdict for a retry. This HTTP route deliberately passes **no** store
     * yet: its decision is not the evaluator's alone — the address-risk feed and seller-reputation
     * checks below can change it — so storing here would return the pre-network-check verdict on a
     * retry and silently skip those checks. The host that can safely own a store today is the MCP
     * tool (`@paystage/mcp`), whose handler is the evaluator plus nothing else. Until this route
     * stores the *final* decision, it says so with `repeat_check.reason = "challenge_store_absent"`
     * rather than pretending the check ran.
     */
    const decision = await evaluateWithChallengeIdempotency(normalized, policy, {
      now: evaluatedAt,
      ...(typeof b.agent_id === "string" ? { agentId: b.agent_id } : {}),
      // #473: a revoked mandate must refuse the very next payment. The evaluator has supported this
      // since #412; the hosted route was the missing seam, so a caller could not exercise it here.
      ...(mandate.value === undefined ? {} : { mandate: mandate.value }),
    });

    /**
     * #473 — the server's own revocation record outranks the caller's claim.
     *
     * The evaluator can only refuse a revocation it is handed, and an offboarded agent is exactly the
     * caller with a reason not to hand one over. When a mandate is supplied, the hosted service checks
     * its own `mandates` row by serial and refuses if that row says `revoked`, whether or not the body
     * carried a statement. A store that cannot be read does not read as "clean": the verdict becomes
     * `review` rather than `pay`, because "we could not check" and "we checked, it is active" are
     * different answers. No store configured (a deployment without Supabase) skips the lookup.
     */
    if (mandate.value !== undefined && options.mandateSource !== undefined) {
      const serial = mandate.value.mandate.serial;
      if (typeof serial === "string" && serial.length > 0) {
        try {
          const stored = await options.mandateSource.get(serial);
          if (stored?.status === "revoked") {
            const detail = `hosted mandate record marks serial ${serial} revoked (checked ${evaluatedAt.toISOString()})`;
            decision.decision = "do_not_pay";
            decision.reasons = [`mandate.revoked: ${detail}`, ...decision.reasons];
            decision.steps.push({
              seq: decision.steps.length + 1,
              rule: "accept.mandate.revoked",
              scope: "accept",
              outcome: "fail",
              detail,
            });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (decision.decision === "pay") {
            const detail = `mandate revocation state could not be read: ${message}`;
            decision.decision = "review";
            decision.reasons = [detail, ...decision.reasons];
            decision.steps.push({
              seq: decision.steps.length + 1,
              rule: "accept.mandate.revocation_unreadable",
              scope: "accept",
              outcome: "fail",
              detail,
            });
          }
        }
      }
    }

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
      /**
       * #473: the machine-readable rule names, alongside the prose `reasons`.
       *
       * This route has always returned `reasons` and `steps`, but never a `reason_codes` field — so the
       * request logger's `parseDecisionFromResponse` stored an empty array for every refusal it saw, and
       * the refusals page and the decisions export could only say `not recorded`. The codes here are not
       * a new judgement: they are the rules the transcript already marked `fail`, in the order they ran.
       * That makes the next refusal audit-able without changing any verdict.
       */
      reason_codes: decision.steps.filter((step) => step.outcome === "fail").map((step) => step.rule),
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
routes.post("/v1/paid/evaluate_mcp_payment", async (c) => {
  const url = new URL(c.req.url);
  url.pathname = "/v1/evaluate_mcp_payment";
  return routes.fetch(new Request(url.toString(), c.req.raw));
});

routes.post("/v1/evaluate_outstanding_auths", async (c) => {
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

  return routes;
}

import { Hono } from "hono";
import { PROBLEMS } from "../problem.js";
import { buildReceipt } from "../receipt.js";
import {
  evaluatePayment,
  normalizePaymentRequired,
} from "@paystage/preflight";
import { parsePolicyCached } from "../policy-cache.js";
import { checkAddressRisk } from "../address-risk.js";
import {
  listOutstandingAuths,
  evaluateOutstandingAuths,
  createRpcClient,
  resolveRpcUrl,
} from "@paystage/auth-watch";

export const evaluateRoutes = new Hono();

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
    const decision = evaluatePayment(normalized, policy, {
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
    return c.json({ ...decision, receipt });
  } catch (err) {
    return c.json(
      PROBLEMS.evaluationFailed((err as Error).message),
      400,
    );
  }
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

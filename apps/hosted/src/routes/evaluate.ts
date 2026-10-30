import { Hono } from "hono";
import {
  evaluatePayment,
  normalizePaymentRequired,
} from "@paystage/preflight";
import { parsePolicy } from "@paystage/policy";
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
    return c.json({ error: "invalid_json" }, 400);
  }
  const b = body as { payment_required?: unknown; policy?: unknown };
  if (!b || typeof b !== "object" || b.payment_required == null) {
    return c.json({ error: "missing_payment_required" }, 400);
  }
  try {
    const normalized = normalizePaymentRequired(b.payment_required as never);
    const policy = parsePolicy(b.policy as never);
    const decision = evaluatePayment(normalized, policy);
    return c.json(decision);
  } catch (err) {
    return c.json(
      { error: "evaluation_failed", message: (err as Error).message },
      400,
    );
  }
});

evaluateRoutes.post("/v1/evaluate_outstanding_auths", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
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
    return c.json({ error: "missing_wallet" }, 400);
  }
  try {
    const policy = parsePolicy(b.policy as never);
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
      { error: "evaluation_failed", message: (err as Error).message },
      400,
    );
  }
});

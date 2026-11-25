import { Hono } from "hono";
import { z } from "zod";
import { provenanceFromHeaders, provenanceKeyFrom, recordEvent, sourceFromHeaders } from "../telemetry.js";

/**
 * Collector for `guardFetch({ telemetryUrl })`.
 *
 * A caller who opts in gets a record of every verdict, including refusals — the thing a denial
 * otherwise lacks once the response is gone. Deliberately narrow: verdict, reason codes, payee and a
 * timestamp. No wallet address, no signature, no request body. Anything more would make an opt-in
 * telemetry call into surveillance of the caller's payments.
 *
 * Free and unauthenticated, like the free tier: the volume here is small and the alternative is that
 * the only people who can audit a refusal are the ones who already have a database.
 */
export const guardVerdictRoutes = new Hono<{ Variables: { channel: string | null } }>();

const VerdictSchema = z.object({
  verdict: z.enum(["pay", "review", "do_not_pay"]),
  reasonCodes: z.array(z.string()).max(20).default([]),
  payTo: z.string().max(128).optional(),
  at: z.string().max(40).optional(),
});

guardVerdictRoutes.post("/v1/guard-verdict", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "invalid_json" }, 400);
  }

  const parsed = VerdictSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "invalid_verdict", detail: parsed.error.issues[0]?.message }, 400);
  }

  const { verdict, reasonCodes, payTo } = parsed.data;
  const env = c.env as { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };

  console.log(JSON.stringify({ level: "info", msg: "provenance_debug", hasValue: Boolean(c.req.header("x-paystage-provenance")), hasSig: Boolean(c.req.header("x-paystage-provenance-sig")), hasKey: Boolean(provenanceKeyFrom(env)) }));
  const callerProvenance = await provenanceFromHeaders({ header: (n) => c.req.header(n) }, provenanceKeyFrom(env));

  recordEvent(
    { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY },
    {
      tool: "x402_guard",
      decision: verdict,
      network: "client",
      source: sourceFromHeaders({ header: (n) => c.req.header(n) }),
      // The reason codes go in their own column; joining them into error_class would file a refusal as
      // if it were a failure, which is the distinction this whole project is about.
      reason_codes: reasonCodes.slice(0, 10),
      // The listing that sent this caller (#326). Null is unknown; never a "direct" bucket.
      channel: c.get("channel") ?? null,
      // Provenance of the caller, from a signed header; unknown is not "external" (#430).
      caller_provenance: callerProvenance,
      // The payee is the subject of the decision and a public on-chain address, which is why it can
      // travel here at all. It is not the caller.
      pay_to: payTo ?? null,
    },
  );

  return c.json({ ok: true }, 202, { "cache-control": "no-store" });
});

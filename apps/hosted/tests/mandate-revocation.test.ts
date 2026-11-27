import { describe, expect, it, vi, afterEach } from "vitest";
import type { Policy } from "@paystage/policy";
import { generateSerial, issue, revoke, verify } from "@paystage/mandate";
import { createApp } from "../src/app.js";
import {
  createMemoryMandateStore,
  revokeStoredMandate,
  writeMandate,
} from "../src/mandate-store.js";

/**
 * #473 — revoking a mandate must make the **next** evaluation refuse with a reason that names the
 * revocation.
 *
 * This is the in-process proof: the real hosted app (`createApp`), the real signed envelope, a real
 * signed revocation statement, and the real evaluator. No chain, no wallet, no database, no network.
 * A refusal is the control working before anything is signed, so the strongest available evidence here
 * is the decision and its reason — not a transaction, which by definition does not exist for a refusal.
 *
 * The revocation mechanism itself is a signed statement plus a `revoked_at` row in `public.mandates`;
 * it is not an on-chain action. See the report for what that means for the row's "on testnet, with a
 * tx" wording.
 */

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const KID = "test-revocation-key";

/** Relative to the real clock: a fixture with a fixed expiry is a test that passes for one day. */
const NOW = new Date();
const ISSUED_AT = new Date(NOW.getTime() - 60_000);
const EXPIRES_AT = new Date(NOW.getTime() + 86_400_000);

function policy(): Policy {
  return {
    version: 1,
    max_amount: { value: "10.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: [PAY_TO],
    allowed_assets: [
      { symbol: "USDC", decimals: 6, address: BASE_SEPOLIA_USDC, network: "eip155:84532" },
    ],
    allowed_networks: ["eip155:84532"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
  };
}

function paymentRequired(amount = "1000000") {
  return {
    x402Version: 2,
    accepts: [
      {
        scheme: "exact",
        network: "eip155:84532",
        amount,
        asset: BASE_SEPOLIA_USDC,
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
      },
    ],
  };
}

const baseEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
  FACILITATOR_URL: "https://x402.org/facilitator",
  // The evaluation route is what is under test; the paid gate around it has its own tests.
  FREE_TIER_ENABLED: "false",
};

async function signedMandateAndRevocation(): Promise<{
  mandate: Awaited<ReturnType<typeof issue>>;
  statement: Awaited<ReturnType<typeof revoke>>;
  key: Record<string, unknown>;
}> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as unknown as Record<string, unknown>;
  const key = { ...jwk, kid: KID, use: "sig", alg: "ES256" };

  const mandate = await issue(
    {
      principal: "Northwind Ltd",
      agent: "agent-wallet-1",
      scope: { per_payment: "2.00", window_amount: "20.00", window_seconds: 86_400 },
      serial: generateSerial(),
      issued_at: ISSUED_AT,
      expires_at: EXPIRES_AT,
    },
    { privateKey: pair.privateKey, kid: KID, now: NOW },
  );
  const statement = await revoke(mandate, {
    privateKey: pair.privateKey,
    kid: KID,
    now: NOW,
    reason: "operator offboarded the agent",
  });
  return { mandate, statement, key };
}

function app() {
  return createApp(baseEnv, { protect: false });
}

function evaluateBody(input: {
  mandate: unknown;
  revocations?: unknown[];
}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      payment_required: paymentRequired(),
      policy: policy(),
      mandate: {
        mandate: input.mandate,
        ...(input.revocations === undefined ? {} : { revocations: input.revocations }),
      },
    }),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("#473 — a revoked mandate refuses the next payment", () => {
  it("returns do_not_pay with reason_codes naming accept.mandate.revoked, not a generic refusal", async () => {
    const { mandate, statement, key } = await signedMandateAndRevocation();

    // The statement is a genuine revocation for this serial: verify it with the same package a seller
    // would use before handing it to the evaluator. A fabricated object would not pass this.
    const verified = await verify(mandate, {
      keys: [key as never],
      revocations: [statement],
      now: NOW,
    });
    expect(verified.ok).toBe(false);
    if (!verified.ok) expect(verified.status).toBe("revoked");

    const res = await app().request("/v1/evaluate_mcp_payment", evaluateBody({ mandate, revocations: [statement] }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decision: string;
      reasons: string[];
      reason_codes: string[];
      steps: Array<{ rule: string; outcome: string }>;
    };

    expect(body.decision).toBe("do_not_pay");

    // The named code, not just prose: this is the field the request logger stores and the export reads.
    expect(body.reason_codes).toContain("accept.mandate.revoked");
    // The reason itself names revocation, the serial and when it happened — an operator can act on it.
    const reason = body.reasons.join(" ");
    expect(reason).toContain("mandate.revoked");
    expect(reason).toContain(`serial ${mandate.serial}`);
    expect(reason).toContain(NOW.toISOString());

    // It is the revocation rule that failed, and only that rule.
    expect(body.steps.find((step) => step.rule === "accept.mandate.revoked")?.outcome).toBe("fail");
    expect(body.reason_codes).not.toContain("accept.mandate.per-payment");
    expect(body.reason_codes).not.toContain("accept.mandate.expiry");

    // Nothing generic: the old failure mode was "outside mandate" with no rule, which is unactionable.
    expect(reason.toLowerCase()).not.toBe("outside mandate");
  });

  it("does not consult the address-risk feed on the way to a revocation refusal", async () => {
    const { mandate, statement } = await signedMandateAndRevocation();
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const res = await app().request("/v1/evaluate_mcp_payment", evaluateBody({ mandate, revocations: [statement] }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { decision: string }).decision).toBe("do_not_pay");

    // The refusal happens before any network check and before any signing step: "no transaction was sent"
    // is the expected shape of a refusal, not a gap in the evidence.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("records the named rule in telemetry, so the export and the refusals page can read it", async () => {
    const { mandate, statement } = await signedMandateAndRevocation();
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
        return new Response(null, { status: 201 });
      }),
    );

    // Without a Supabase config the middleware skips telemetry entirely; this proves the parsed
    // `reason_codes` path end to end, which is what made the earlier rows read `not recorded`.
    const res = await createApp(
      { ...baseEnv, SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-key" },
      { protect: false },
    ).request("/v1/evaluate_mcp_payment", evaluateBody({ mandate, revocations: [statement] }));
    expect(res.status).toBe(200);

    await vi.waitFor(() => {
      expect(bodies.length).toBeGreaterThan(0);
    });
    const event = bodies.find((row) => row.tool === "evaluate_mcp_payment");
    expect(event?.decision).toBe("do_not_pay");
    expect(event?.reason_codes).toContain("accept.mandate.revoked");
  });

  it("refuses when the hosted mandate record is revoked, even with no revocation in the request", async () => {
    const { mandate, statement, key } = await signedMandateAndRevocation();
    const store = createMemoryMandateStore();

    // The real offboarding path: the row is written from the signed envelope, then flipped to revoked
    // with a verified statement. The evaluation request below carries **only the envelope** — this is
    // the caller who would not volunteer its own revocation.
    await writeMandate(store, mandate, {
      tenantId: "tenant-test",
      verify: { keys: [key as never] },
      now: NOW,
    });
    await revokeStoredMandate(store, mandate, statement, {
      verify: { keys: [key as never] },
      now: NOW,
    });
    expect((await store.get(mandate.serial))?.status).toBe("revoked");

    const res = await createApp(baseEnv, { protect: false, mandateStore: store }).request(
      "/v1/evaluate_mcp_payment",
      evaluateBody({ mandate }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: string; reasons: string[]; reason_codes: string[] };
    expect(body.decision).toBe("do_not_pay");
    expect(body.reason_codes).toContain("accept.mandate.revoked");
    expect(body.reasons.join(" ")).toContain("hosted mandate record marks serial");
    expect(body.reasons.join(" ")).toContain(mandate.serial);
  });

  it("answers review, not pay, when the mandate record cannot be read", async () => {
    const { mandate } = await signedMandateAndRevocation();
    const res = await createApp(baseEnv, {
      protect: false,
      mandateSource: {
        get: async () => {
          throw new Error("mandate read failed (HTTP 503)");
        },
      },
    }).request("/v1/evaluate_mcp_payment", evaluateBody({ mandate }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: string; reasons: string[]; reason_codes: string[] };
    expect(body.decision).toBe("review");
    expect(body.reason_codes).toContain("accept.mandate.revocation_unreadable");
    expect(body.reasons.join(" ")).toContain("could not be read");
  });

  it("refuses a malformed mandate object with invalid_mandate rather than evaluating without it", async () => {
    const res = await app().request(
      "/v1/evaluate_mcp_payment",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          payment_required: paymentRequired(),
          policy: policy(),
          mandate: { mandate: "not-an-envelope" },
        }),
      },
    );
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_mandate");
  });
});

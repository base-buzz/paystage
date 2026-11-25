import { describe, expect, it } from "vitest";
import {
  evaluateMandate,
  issue,
  revoke,
  verify,
  type Mandate,
  type MandateScope,
  type Revocation,
} from "../src/index.js";

/**
 * Offline: keys are generated in-process, no network and no fixtures. The private key is passed as a
 * CryptoKey seam for tests; production callers use the PKCS#8 path shared with receipts.
 */

async function keypair(kid = "k-test") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>;
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid, use: "sig", alg: "ES256" } };
}

const SCOPE: MandateScope = {
  per_payment: "2.00",
  window_amount: "20.00",
  window_seconds: 86400,
};

const ISSUED = "2026-11-01T00:00:00.000Z";
const EXPIRES = "2026-12-01T00:00:00.000Z";
const NOW = new Date("2026-11-15T12:00:00.000Z");

async function signed(overrides: {
  scope?: MandateScope;
  principal?: string;
  agent?: string;
  expires_at?: string;
  revocable?: boolean;
  serial?: string;
} = {}): Promise<{ mandate: Mandate; keys: Awaited<ReturnType<typeof keypair>> }> {
  const keys = await keypair();
  const mandate = await issue(
    {
      principal: overrides.principal ?? "Northwind Ltd",
      agent: overrides.agent ?? "shopping-agent-7",
      serial: overrides.serial ?? "vch_0123456789abcdefghijkl",
      scope: overrides.scope ?? SCOPE,
      issued_at: ISSUED,
      expires_at: overrides.expires_at ?? EXPIRES,
      revocable: overrides.revocable,
    },
    { privateKey: keys.privateKey, kid: keys.jwk.kid as string, now: new Date(ISSUED) },
  );
  return { mandate, keys };
}

describe("@paystage/mandate — the envelope", () => {
  it("issues a signed mandate and verifies it against the published key", async () => {
    const { mandate, keys } = await signed();

    expect(mandate).toMatchObject({
      v: 1,
      serial: "vch_0123456789abcdefghijkl",
      principal: "Northwind Ltd",
      agent: "shopping-agent-7",
      scope: SCOPE,
      issued_at: ISSUED,
      expires_at: EXPIRES,
      revocable: true,
      kid: "k-test",
    });
    expect(mandate.signature.length).toBeGreaterThan(0);

    const result = await verify(mandate, { keys: [keys.jwk], now: NOW });
    expect(result).toMatchObject({ ok: true });
    if (result.ok) expect(result.mandate.serial).toBe(mandate.serial);
  });

  it("refuses to issue a mandate whose agent is its own principal, naming the reason", async () => {
    const keys = await keypair();
    await expect(
      issue(
        {
          principal: "shopping-agent-7",
          agent: "shopping-agent-7",
          scope: SCOPE,
          issued_at: ISSUED,
          expires_at: EXPIRES,
        },
        { privateKey: keys.privateKey, kid: "k-test" },
      ),
    ).rejects.toThrow(/permission slip the agent wrote for itself/);
  });

  it("reports an unsigned mandate as unsigned, never valid", async () => {
    const { mandate, keys } = await signed();
    const { signature: _signature, ...unsigned } = mandate;

    const result = await verify(unsigned, { keys: [keys.jwk], now: NOW });
    expect(result).toMatchObject({ ok: false, status: "unsigned" });
  });

  it("reports a changed scope as tampered", async () => {
    const { mandate, keys } = await signed();
    const tampered = { ...mandate, scope: { ...mandate.scope, per_payment: "200.00" } };

    const result = await verify(tampered, { keys: [keys.jwk], now: NOW });
    expect(result).toMatchObject({ ok: false, status: "tampered" });
    if (!result.ok) expect(result.reason).toMatch(/signature does not match/);
  });

  it("reports an unknown kid as unknown-kid, not as valid or tampered", async () => {
    const { mandate, keys } = await signed();
    const other = await keypair("k-other");

    const result = await verify(mandate, { keys: [other.jwk], now: NOW });
    expect(result).toMatchObject({ ok: false, status: "unknown-kid" });
    if (!result.ok) expect(result.reason).toMatch(/no key with kid "k-test"/);

    // A caller that explicitly pins one key with `jwk` has already chosen it; the kid cannot be
    // "unknown" when there is only one key to check against.
    const bare = { ...keys.jwk } as Record<string, unknown>;
    delete bare.kid;
    const viaBare = await verify(mandate, { jwk: bare, now: NOW });
    expect(viaBare).toMatchObject({ ok: true });
  });

  it("reports a signed mandate past expires_at as expired", async () => {
    const { mandate, keys } = await signed();
    const result = await verify(mandate, { keys: [keys.jwk], now: new Date("2026-12-02T00:00:00.000Z") });
    expect(result).toMatchObject({ ok: false, status: "expired" });
    if (!result.ok) expect(result.reason).toMatch(/expired/);
  });

  it("never throws on a non-object", async () => {
    for (const bad of [null, undefined, 42, "mandate", [], { v: 2 }]) {
      const result = await verify(bad, { now: NOW });
      expect(result.ok).toBe(false);
    }
  });
});

describe("@paystage/mandate — revocation is a separate signed statement", () => {
  it("revokes by signing a statement that names the serial, without touching the mandate", async () => {
    const { mandate, keys } = await signed();
    const before = mandate.signature;

    const revocation = await revoke(mandate, {
      privateKey: keys.privateKey,
      kid: "k-test",
      now: new Date("2026-11-15T00:00:00.000Z"),
      reason: "lost device",
    });

    expect(revocation.serial).toBe(mandate.serial);
    expect(revocation.reason).toBe("lost device");
    expect(mandate.signature).toBe(before);

    const result = await verify(mandate, { keys: [keys.jwk], revocations: [revocation], now: NOW });
    expect(result).toMatchObject({ ok: false, status: "revoked" });
    if (!result.ok) expect(result.reason).toMatch(/revoked at/);

    // The same mandate still verifies when the caller has not seen the revocation.
    expect(await verify(mandate, { keys: [keys.jwk], now: NOW })).toMatchObject({ ok: true });
  });

  it("refuses to read a mandate as live when the matching revocation is not validly signed", async () => {
    const { mandate, keys } = await signed();
    const revocation = await revoke(mandate, {
      privateKey: keys.privateKey,
      kid: "k-test",
      now: new Date("2026-11-15T00:00:00.000Z"),
    });
    const forged: Revocation = { ...revocation, serial: revocation.serial, revoked_at: "2026-11-20T00:00:00.000Z" };

    const result = await verify(mandate, { keys: [keys.jwk], revocations: [forged], now: NOW });
    expect(result).toMatchObject({ ok: false, status: "tampered" });
  });
});

describe("@paystage/mandate — the evaluator names the rule that failed", () => {
  const payment = { amount: "1500000", payee: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C", decimals: 6, symbol: "USDC" };

  it("passes a payment inside the mandate", async () => {
    const { mandate } = await signed();
    const result = evaluateMandate({
      mandate,
      payment,
      history: [{ amount: "5000000", at: "2026-11-15T10:00:00.000Z" }],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a payment above per_payment and names mandate.per-payment", async () => {
    const { mandate } = await signed();
    const result = evaluateMandate({
      mandate,
      payment: { ...payment, amount: "3000000" },
      now: NOW,
    });

    expect(result).toEqual(
      expect.objectContaining({
        ok: false,
        rule: "per-payment",
        reason: expect.stringContaining("mandate.per-payment"),
      }),
    );
    if (!result.ok) expect(result.reason).toMatch(/3 USDC exceeds per_payment 2\.00 USDC/);
  });

  it("refuses a payment that would breach the rolling window and names mandate.window", async () => {
    const { mandate } = await signed();
    const result = evaluateMandate({
      mandate,
      payment,
      history: [{ amount: "19000000", at: "2026-11-15T10:00:00.000Z" }],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, rule: "window" });
    if (!result.ok) expect(result.reason).toContain("mandate.window");
  });

  it("does not count spend outside the window or at its boundary", async () => {
    const { mandate } = await signed();
    // The window is 86,400s, so a payment exactly at NOW - 86400s is excluded (half-open, matching velocity).
    const result = evaluateMandate({
      mandate,
      payment: { ...payment, amount: "2000000" },
      history: [{ amount: "19000000", at: "2026-11-14T12:00:00.000Z" }],
      now: NOW,
    });

    expect(result).toMatchObject({ ok: true });
  });

  it("refuses a payee outside allowed_payees and names mandate.payee", async () => {
    const { mandate } = await signed({
      scope: { ...SCOPE, allowed_payees: ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"] },
    });
    const result = evaluateMandate({
      mandate,
      payment: { ...payment, payee: "0x0000000000000000000000000000000000000001" },
      now: NOW,
    });

    expect(result).toMatchObject({ ok: false, rule: "payee" });
    if (!result.ok) expect(result.reason).toContain("mandate.payee");
  });

  it("compares EVM allow-list entries case-insensitively", async () => {
    const { mandate } = await signed({
      scope: { ...SCOPE, allowed_payees: ["0x209693bc6afc0c5328ba36faf03c514ef312287c"] },
    });
    const result = evaluateMandate({ mandate, payment, now: NOW });
    expect(result).toMatchObject({ ok: true });
  });

  it("refuses an expired mandate and names mandate.expiry", async () => {
    const { mandate } = await signed();
    const result = evaluateMandate({
      mandate,
      payment,
      now: new Date("2026-12-02T00:00:00.000Z"),
    });

    expect(result).toMatchObject({ ok: false, rule: "expiry" });
    if (!result.ok) expect(result.reason).toContain("mandate.expiry");
  });

  it("refuses a revoked serial and names mandate.revoked", async () => {
    const { mandate, keys } = await signed();
    const revocation = await revoke(mandate, { privateKey: keys.privateKey, kid: "k-test", now: NOW });
    const result = evaluateMandate({ mandate, payment, revocations: [revocation], now: NOW });

    expect(result).toMatchObject({ ok: false, rule: "revoked" });
    if (!result.ok) expect(result.reason).toContain("mandate.revoked");
  });

  it("fails closed on an unreadable scope rather than passing", async () => {
    const { mandate } = await signed();
    const broken = { ...mandate, scope: { ...mandate.scope, per_payment: "two" } };
    const result = evaluateMandate({ mandate: broken, payment, now: NOW });

    expect(result).toMatchObject({ ok: false, rule: "malformed" });
  });
});

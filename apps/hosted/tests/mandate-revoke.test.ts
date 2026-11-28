import { describe, expect, it } from "vitest";
import {
  generateSerial,
  issue,
  revoke,
  type Mandate,
  type MandateScope,
  type Revocation,
} from "@paystage/mandate";
import { createApp, type AppEnv } from "../src/app.js";
import {
  createMemoryMandateStore,
  writeMandate,
  type MandateStore,
  type StoredMandateEnvelope,
} from "../src/mandate-store.js";
import type { VerificationKey } from "../src/routes/mandate-mint.js";

/**
 * `POST /v1/mandate/:serial/revoke` (#503).
 *
 * The route exists because the pass back promises "revocation is instant server-side" and, until
 * this route, nothing could call `revokeStoredMandate` over HTTP. Every test here is about the write:
 *
 *  - a valid signed statement flips the row and the public read answers `revoked` / `do_not_trust`;
 *  - the same call twice is a 409 carrying the **first** timestamp and exactly one revoke write;
 *  - a bad token, an unknown serial and a malformed statement each get their own refusal and write
 *    nothing;
 *  - the statement must name the path serial.
 *
 * The keys are real throwaway P-256 pairs generated per run. No fixture, no secret, no network, no
 * database.
 */

const NOW = new Date();
const KID = "test-revoke-key";
const TOKEN = "revoke-token-for-tests-only";
const OTHER_TOKEN = "mint-token-for-tests-only";

const baseEnv: AppEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
};

const SCOPE: MandateScope = {
  per_payment: "2.00",
  window_amount: "20.00",
  window_seconds: 86_400,
};

interface KeyPair {
  privateKey: CryptoKey;
  verificationKey: VerificationKey;
}

async function makeKeyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as unknown as Record<string, unknown>;
  return {
    privateKey: pair.privateKey,
    verificationKey: { ...jwk, kid: KID, use: "sig", alg: "ES256" } as unknown as VerificationKey,
  };
}

async function signedMandate(key: KeyPair, serial = generateSerial()): Promise<Mandate> {
  return issue(
    {
      principal: "Northwind Ltd",
      agent: "agent-wallet-1",
      scope: SCOPE,
      serial,
      issued_at: new Date(NOW.getTime() - 60_000),
      expires_at: new Date(NOW.getTime() + 86_400_000),
    },
    { privateKey: key.privateKey, kid: KID, now: NOW },
  );
}

/** The memory store, plus a revoke counter so "one revocation, one timestamp" is provable. */
function countingStore(): { store: MandateStore; revokes: () => number } {
  const inner = createMemoryMandateStore();
  let revokes = 0;
  const store: MandateStore = {
    get: (serial) => inner.get(serial),
    getEnvelope: (serial): Promise<StoredMandateEnvelope | null> => inner.getEnvelope(serial),
    insert: (row) => inner.insert(row),
    revoke: async (serial, statement, revokedAt) => {
      revokes += 1;
      await inner.revoke(serial, statement, revokedAt);
    },
  };
  return { store, revokes: () => revokes };
}

async function seeded(
  key: KeyPair,
): Promise<{ store: MandateStore; mandate: Mandate; revokes: () => number }> {
  const { store, revokes } = countingStore();
  const mandate = await signedMandate(key);
  await writeMandate(store, mandate, {
    tenantId: "tenant-test",
    verify: { keys: [key.verificationKey] },
    now: NOW,
  });
  return { store, mandate, revokes };
}

function appWith(
  store: MandateStore,
  key: KeyPair,
  options: { token?: string | undefined; keys?: readonly VerificationKey[] } = {},
) {
  return createApp(baseEnv, {
    protect: false,
    mandateStore: store,
    mandateSource: store,
    mandateRevoke: {
      token: "token" in options ? options.token : TOKEN,
      verificationKeys: async () => options.keys ?? [key.verificationKey],
      now: () => NOW,
    },
  });
}

function revokeRequest(statement: unknown, token: string | null = TOKEN): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(statement),
  };
}

async function refusal(res: Response): Promise<{ error: string; detail: string; revoked_at?: string }> {
  const body = (await res.json()) as Record<string, unknown>;
  return {
    error: String(body.error),
    detail: String(body.detail),
    ...(typeof body.revoked_at === "string" ? { revoked_at: body.revoked_at } : {}),
  };
}

describe("POST /v1/mandate/:serial/revoke — the write", () => {
  it("revokes with a valid signed statement and the public read turns do-not-trust", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const statement = await revoke(mandate, {
      privateKey: key.privateKey,
      kid: KID,
      now: NOW,
      reason: "operator offboarded the agent",
    });

    const app = appWith(store, key);
    const res = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      serial: mandate.serial,
      revoked_at: statement.revoked_at,
      status: "revoked",
    });
    expect(revokes()).toBe(1);

    const read = await app.request(`/v1/mandate/${mandate.serial}`);
    expect(read.status).toBe(200);
    const body = (await read.json()) as { status: string; verdict_for_seller: string };
    expect(body.status).toBe("revoked");
    expect(body.verdict_for_seller).toBe("do_not_trust");
  });

  it("is idempotent: the same call twice is a 409 with the first timestamp and one write", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const statement = await revoke(mandate, { privateKey: key.privateKey, kid: KID, now: NOW });
    const app = appWith(store, key);

    const first = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement));
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as { revoked_at: string };

    // A manager double-clicks: the second call must not move the timestamp or write again.
    const second = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement));
    expect(second.status).toBe(409);
    const conflict = await refusal(second);
    expect(conflict.error).toBe("mandate_already_revoked");
    expect(conflict.revoked_at).toBe(firstBody.revoked_at);
    expect(revokes()).toBe(1);

    const read = (await (await app.request(`/v1/mandate/${mandate.serial}`)).json()) as {
      status: string;
    };
    expect(read.status).toBe("revoked");
  });

  it("refuses a bad token with 403 and writes nothing", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const statement = await revoke(mandate, { privateKey: key.privateKey, kid: KID, now: NOW });
    const app = appWith(store, key);

    for (const token of ["not-the-token", null] as const) {
      const res = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement, token));
      expect(res.status, String(token)).toBe(403);
      expect((await refusal(res)).error).toBe("mandate_revoke_forbidden");
    }
    expect(revokes()).toBe(0);
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });

  it("answers 404 for a serial that is not on record", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const unknown = await signedMandate(key);
    const statement = await revoke(unknown, { privateKey: key.privateKey, kid: KID, now: NOW });
    const app = appWith(store, key);

    const res = await app.request(`/v1/mandate/${unknown.serial}/revoke`, revokeRequest(statement));
    expect(res.status).toBe(404);
    expect((await refusal(res)).error).toBe("mandate_not_found");
    // The seeded row was not touched by a revoke aimed at another serial.
    expect(revokes()).toBe(0);
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });

  it("answers 400 for a malformed statement and writes nothing", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const app = appWith(store, key);

    const malformed = [
      "{not json",
      { v: 1, serial: mandate.serial, revoked_at: NOW.toISOString() },
      { v: 99, serial: mandate.serial, revoked_at: NOW.toISOString(), kid: KID, signature: "AAAA" },
      { v: 1, serial: mandate.serial, revoked_at: "not-a-date", kid: KID, signature: "AAAA" },
    ];
    for (const body of malformed) {
      const res = await app.request(
        `/v1/mandate/${mandate.serial}/revoke`,
        typeof body === "string"
          ? { ...revokeRequest(body), body }
          : revokeRequest(body),
      );
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(revokes()).toBe(0);
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });

  it("refuses a statement that names a different serial", async () => {
    const key = await makeKeyPair();
    const { store, mandate } = await seeded(key);
    const other = await signedMandate(key);
    const statement = await revoke(other, { privateKey: key.privateKey, kid: KID, now: NOW });
    const app = appWith(store, key);

    const res = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_revocation_rejected");
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });

  it("refuses a statement whose signature does not verify, rather than flipping the row", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const statement = {
      ...(await revoke(mandate, { privateKey: key.privateKey, kid: KID, now: NOW })),
      signature: "AAAA",
    } as Revocation;
    const app = appWith(store, key);

    const res = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_revocation_rejected");
    expect(revokes()).toBe(0);
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });

  it("refuses every revoke when the deployment has no token or no published key", async () => {
    const key = await makeKeyPair();
    const { store, mandate, revokes } = await seeded(key);
    const statement = await revoke(mandate, { privateKey: key.privateKey, kid: KID, now: NOW });

    for (const [label, app] of [
      ["no token", appWith(store, key, { token: undefined })],
      ["no key", appWith(store, key, { keys: [] })],
    ] as const) {
      const res = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement));
      expect(res.status, label).toBe(503);
      expect((await refusal(res)).error, label).toBe("mandate_revoke_not_configured");
    }
    expect(revokes()).toBe(0);
  });

  it("prefers MANDATE_REVOKE_TOKEN over the mint token when both are configured", async () => {
    const key = await makeKeyPair();
    const { store, mandate } = await seeded(key);
    const statement = await revoke(mandate, { privateKey: key.privateKey, kid: KID, now: NOW });
    const app = createApp(
      { ...baseEnv, MANDATE_MINT_TOKEN: OTHER_TOKEN, MANDATE_REVOKE_TOKEN: TOKEN },
      {
        protect: false,
        mandateStore: store,
        mandateRevoke: { verificationKeys: async () => [key.verificationKey], now: () => NOW },
      },
    );

    const mintToken = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement, OTHER_TOKEN));
    expect(mintToken.status).toBe(403);

    const revokeToken = await app.request(`/v1/mandate/${mandate.serial}/revoke`, revokeRequest(statement, TOKEN));
    expect(revokeToken.status).toBe(200);
  });
});

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { generateSerial, issue, revoke, type Mandate, type MandateScope } from "@paystage/mandate";
import { createApp, type AppEnv } from "../src/app.js";
import {
  DuplicateMandateError,
  createMemoryMandateStore,
  type MandateStore,
  type NewMandateRow,
} from "../src/mandate-store.js";
import { MINT_SERIAL_RE, MINT_VERIFICATION_BASE, type VerificationKey } from "../src/routes/mandate-mint.js";
import { MANDATE_SERIAL_RE } from "../src/routes/mandate.js";

/**
 * The mint route (#455).
 *
 * Every test here is about the *write*, not the status code. The contract being pinned:
 *
 *  - only the service-token holder may mint, and the token is checked before the body is read;
 *  - the serial, scope and principal come from the signed envelope — a body-level `serial` is ignored;
 *  - an unsigned, tampered, unknown-kid, expired or revoked envelope is refused with its own named
 *    code, and **no row exists afterwards** (asserted against the store, not the response);
 *  - a minted mandate is readable through the public `GET /v1/mandate/:serial` with the same scope
 *    and principal it was signed with.
 *
 * The envelope is real: a throwaway P-256 pair is generated per run, `issue()` signs with it, and the
 * route verifies against its public half. No fixture, no secret, no network, no database.
 */

/**
 * The clock, taken from the real one.
 *
 * This used to be a hardcoded `2026-11-26T12:00Z`, and the default expiry was `NOW + 24h` — so the mint tests passed for
 * exactly one day and then failed with `expected 'expired' to be 'active'`, which reads like a mint bug and is a calendar.
 * A fixture that expires is a test that lies about a regression. Offsets stay relative to this, so nothing else changes.
 */
const NOW = new Date();
const KID = "test-mint-key";
/** A literal test token. Not a secret and not valid anywhere: the deployment value is a Wrangler secret. */
const TOKEN = "mint-token-for-tests-only";

const baseEnv: AppEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
  MANDATE_MINT_TOKEN: TOKEN,
  MANDATE_TENANT_ID: "tenant-test",
};

const SCOPE: MandateScope = {
  per_payment: "2.00",
  window_amount: "20.00",
  window_seconds: 86_400,
  allowed_payees: ["0x1111111111111111111111111111111111111111"],
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
    // `kid` is what the envelope names and the verifier selects by, exactly as the published JWKS does.
    verificationKey: { ...jwk, kid: KID, use: "sig", alg: "ES256" } as unknown as VerificationKey,
  };
}

async function signedMandate(
  key: KeyPair,
  overrides: { serial?: string; kid?: string; expires_at?: Date; issued_at?: Date } = {},
): Promise<Mandate> {
  return issue(
    {
      principal: "Northwind Ltd",
      agent: "agent-wallet-1",
      scope: SCOPE,
      serial: overrides.serial ?? generateSerial(),
      issued_at: overrides.issued_at ?? new Date(NOW.getTime() - 60_000),
      expires_at: overrides.expires_at ?? new Date(NOW.getTime() + 86_400_000),
    },
    { privateKey: key.privateKey, kid: overrides.kid ?? KID, now: NOW },
  );
}

/** The real memory store, with an insert counter so "no row was written" is provable per refusal. */
function countingStore(): {
  store: MandateStore;
  inner: MandateStore;
  inserts: () => number;
} {
  const inner = createMemoryMandateStore();
  let inserts = 0;
  const store: MandateStore = {
    get: (serial) => inner.get(serial),
    getEnvelope: (serial) => inner.getEnvelope(serial),
    insert: async (row) => {
      inserts += 1;
      await inner.insert(row);
    },
    revoke: (serial, revocation, revokedAt) => inner.revoke(serial, revocation, revokedAt),
  };
  return { store, inner, inserts: () => inserts };
}

function appWith(
  store: MandateStore,
  key: KeyPair,
  options: { env?: Partial<AppEnv>; now?: Date; keys?: readonly VerificationKey[] } = {},
) {
  return createApp({ ...baseEnv, ...options.env }, {
    protect: false,
    mandateStore: store,
    mandateMint: {
      verificationKeys: async () => options.keys ?? [key.verificationKey],
      now: () => options.now ?? NOW,
    },
  });
}

function mintRequest(body: unknown, token: string | null = TOKEN): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(token === null ? {} : { authorization: `Bearer ${token}` }),
    },
    body: JSON.stringify(body),
  };
}

async function refusal(res: Response): Promise<{ error: string; detail: string }> {
  const body = (await res.json()) as Record<string, unknown>;
  return { error: String(body.error), detail: String(body.detail) };
}

describe("POST /v1/mandate — the mint", () => {
  it("mints a real signed envelope and the public read returns the same scope and principal", async () => {
    const key = await makeKeyPair();
    const { store } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");

    // Exactly the serial and where to check it — never the envelope back.
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["serial", "verification_url"]);
    expect(body.serial).toBe(mandate.serial);
    expect(body.verification_url).toBe(`${MINT_VERIFICATION_BASE}${mandate.serial}`);
    expect(JSON.stringify(body)).not.toContain("signature");
    expect(JSON.stringify(body)).not.toContain("envelope");

    // End-to-end: read it back through the public route, in the same store.
    const read = await app.request(`/v1/mandate/${mandate.serial}`);
    expect(read.status).toBe(200);
    const record = (await read.json()) as Record<string, unknown>;
    expect(record.status).toBe("active");
    expect(record.verdict_for_seller).toBe("trust");
    expect(record.serial).toBe(mandate.serial);
    expect(record.principal).toEqual({ display: "Northwind Ltd", assertion: "self" });
    expect(record.scope).toEqual({
      per_payment: "2.00",
      window_amount: "20.00",
      window_seconds: 86_400,
      expires_at: mandate.expires_at,
    });
    // The public projection still carries no payee list or agent, even for a freshly minted row.
    expect(JSON.stringify(record)).not.toContain("0x1111111111111111111111111111111111111111");
    expect(JSON.stringify(record)).not.toContain("agent-wallet-1");
  });

  it("takes the serial from the signed envelope and ignores a serial in the request body", async () => {
    const key = await makeKeyPair();
    const { store } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);
    const chosen = generateSerial();

    const res = await app.request(
      "/v1/mandate",
      mintRequest({ envelope: mandate, serial: chosen, tenant_id: "someone-else" }),
    );
    expect(res.status).toBe(201);
    expect(((await res.json()) as Record<string, unknown>).serial).toBe(mandate.serial);

    // The envelope's serial is on record; the caller's choice is not, and it did not become a row.
    expect(await store.get(mandate.serial)).not.toBeNull();
    expect(await store.get(chosen)).toBeNull();

    const read = await app.request(`/v1/mandate/${mandate.serial}`);
    expect(((await read.json()) as Record<string, unknown>).status).toBe("active");
  });
});

describe("POST /v1/mandate — refusals, each named, none leaving a row", () => {
  it("refuses an unsigned envelope with mandate_unsigned", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    const { signature: _signature, ...unsigned } = await signedMandate(key);

    const res = await app.request("/v1/mandate", mintRequest({ envelope: unsigned }));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_unsigned");
    expect(inserts()).toBe(0);
    expect(await store.get(unsigned.serial)).toBeNull();
  });

  it("refuses a tampered envelope with mandate_tampered", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);
    const tampered = { ...mandate, scope: { ...mandate.scope, per_payment: "2000.00" } };

    const res = await app.request("/v1/mandate", mintRequest({ envelope: tampered }));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_tampered");
    expect(inserts()).toBe(0);
    expect(await store.get(mandate.serial)).toBeNull();
  });

  it("refuses an envelope naming a kid the deployment does not publish", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key, { kid: "some-other-key" });

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_unknown_kid");
    expect(inserts()).toBe(0);
    expect(await store.get(mandate.serial)).toBeNull();
  });

  it("refuses an envelope whose signed expiry is already past", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key, {
      issued_at: new Date(NOW.getTime() - 172_800_000),
      expires_at: new Date(NOW.getTime() - 60_000),
    });

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_expired");
    expect(inserts()).toBe(0);
    expect(await store.get(mandate.serial)).toBeNull();
  });

  it("refuses a revoked envelope, proven by the signed revocation statement", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);
    const statement = await revoke(mandate, {
      privateKey: key.privateKey,
      kid: KID,
      now: new Date(NOW.getTime() - 30_000),
      reason: "lost device",
    });

    const res = await app.request(
      "/v1/mandate",
      mintRequest({ envelope: mandate, revocations: [statement] }),
    );
    expect(res.status).toBe(409);
    expect((await refusal(res)).error).toBe("mandate_revoked");
    expect(inserts()).toBe(0);
    expect(await store.get(mandate.serial)).toBeNull();
  });

  it("refuses to re-mint a serial already stored as revoked", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const { store, inserts } = countingStore();
    await store.insert({
      serial: mandate.serial,
      tenant_id: "tenant-test",
      state: "revoked",
      scope: mandate.scope,
      issued_at: mandate.issued_at,
      expires_at: mandate.expires_at,
      principal: mandate.principal,
      agent: mandate.agent,
      envelope: mandate,
    });
    const app = appWith(store, key);

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(409);
    expect((await refusal(res)).error).toBe("mandate_revoked");
    expect(inserts()).toBe(1); // the seed, not the mint
  });

  it("refuses a serial that is already on record with mandate_already_minted", async () => {
    const key = await makeKeyPair();
    const { store } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    expect((await app.request("/v1/mandate", mintRequest({ envelope: mandate }))).status).toBe(201);
    const second = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(second.status).toBe(409);
    expect((await refusal(second)).error).toBe("mandate_already_minted");
  });

  it("refuses a guessable short-code serial before any row exists", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    // The pass face's display handle is 3 characters: fine to print, not fine to mint.
    const mandate = await signedMandate(key, { serial: "vch-7F3" });

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_serial_not_mintable");
    expect(inserts()).toBe(0);
    expect(await store.get("vch-7F3")).toBeNull();
  });

  it("refuses a body that is not JSON or carries no envelope", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);

    const notJson = await app.request("/v1/mandate", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${TOKEN}` },
      body: "{not json",
    });
    expect(notJson.status).toBe(400);
    expect((await refusal(notJson)).error).toBe("invalid_json");

    const noEnvelope = await app.request("/v1/mandate", mintRequest({ serial: generateSerial() }));
    expect(noEnvelope.status).toBe(400);
    expect((await refusal(noEnvelope)).error).toBe("mandate_envelope_required");

    const badRevocations = await app.request(
      "/v1/mandate",
      mintRequest({ envelope: await signedMandate(key), revocations: "not-a-list" }),
    );
    expect(badRevocations.status).toBe(400);
    expect((await refusal(badRevocations)).error).toBe("mandate_malformed");

    expect(inserts()).toBe(0);
  });
});

describe("POST /v1/mandate — the owner check", () => {
  it("refuses a missing token, a wrong token and another auth scheme", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    const cases: Array<[string, RequestInit]> = [
      ["missing", mintRequest({ envelope: mandate }, null)],
      ["wrong", mintRequest({ envelope: mandate }, "not-the-token")],
      [
        "basic",
        {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Basic ${TOKEN}` },
          body: JSON.stringify({ envelope: mandate }),
        },
      ],
    ];
    for (const [label, request] of cases) {
      const res = await app.request("/v1/mandate", request);
      expect(res.status, label).toBe(401);
      expect((await refusal(res)).error, label).toBe("mandate_mint_unauthorized");
    }

    expect(inserts()).toBe(0);
    expect(await store.get(mandate.serial)).toBeNull();
  });

  it("checks the token before it reads the body, so an unauthenticated caller learns nothing", async () => {
    const key = await makeKeyPair();
    const { store } = countingStore();
    const app = appWith(store, key);

    // Malformed JSON and no token: the answer is the auth refusal, not invalid_json.
    const res = await app.request("/v1/mandate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not json",
    });
    expect(res.status).toBe(401);
    expect((await refusal(res)).error).toBe("mandate_mint_unauthorized");
  });

  it("refuses every mint when the deployment has no token or no published key", async () => {
    const key = await makeKeyPair();
    const { store, inserts } = countingStore();

    const noToken = appWith(store, key, { env: { MANDATE_MINT_TOKEN: undefined } });
    const noKey = appWith(store, key, { keys: [] });

    for (const [label, app] of [
      ["no token", noToken],
      ["no key", noKey],
    ] as const) {
      const res = await app.request("/v1/mandate", mintRequest({ envelope: await signedMandate(key) }));
      expect(res.status, label).toBe(503);
      expect((await refusal(res)).error, label).toBe("mandate_mint_not_configured");
    }
    expect(inserts()).toBe(0);
  });

  it("answers 409 not 503 when the store's insert loses a race to a duplicate serial", async () => {
    const key = await makeKeyPair();
    const inner = createMemoryMandateStore();
    // `get` lies once (the row appears between the pre-read and the insert), as a real race would.
    const racing: MandateStore = {
      get: async () => null,
      getEnvelope: async () => null,
      insert: async (row) => {
        await inner.insert(row);
        throw new DuplicateMandateError(row.serial);
      },
      revoke: (serial, revocation, revokedAt) => inner.revoke(serial, revocation, revokedAt),
    };
    const app = appWith(racing, key);
    const mandate = await signedMandate(key);

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(409);
    expect((await refusal(res)).error).toBe("mandate_already_minted");
  });
});

describe("POST /v1/mandate — the optional org unit (#471)", () => {
  /** A store that keeps the inserted row so the column, not just the status, is asserted. */
  function capturingStore(): { store: MandateStore; rows: () => NewMandateRow[] } {
    const inner = createMemoryMandateStore();
    const rows: NewMandateRow[] = [];
    return {
      store: {
        get: (serial) => inner.get(serial),
        getEnvelope: (serial) => inner.getEnvelope(serial),
        insert: async (row) => {
          rows.push(row);
          await inner.insert(row);
        },
        revoke: (serial, revocation, revokedAt) => inner.revoke(serial, revocation, revokedAt),
      },
      rows: () => rows,
    };
  }

  it("stores the supplied org_unit without touching the signed envelope", async () => {
    const key = await makeKeyPair();
    const { store, rows } = capturingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    const res = await app.request(
      "/v1/mandate",
      mintRequest({ envelope: mandate, org_unit: "tenant-test/engineering/platform" }),
    );
    expect(res.status).toBe(201);
    expect(rows()).toHaveLength(1);
    expect(rows()[0]?.org_unit).toBe("tenant-test/engineering/platform");
    // The allocation label is not signed: the verified envelope is byte-for-byte what it was.
    expect(rows()[0]?.envelope).toEqual(mandate);
    expect(JSON.stringify(rows()[0]?.envelope)).not.toContain("org_unit");
  });

  it("accepts an absent org_unit and writes no column, so a single-person install still mints", async () => {
    const key = await makeKeyPair();
    const { store, rows } = capturingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    const res = await app.request("/v1/mandate", mintRequest({ envelope: mandate }));
    expect(res.status).toBe(201);
    expect(rows()).toHaveLength(1);
    // Omitted, not null: the insert must also work before the migration adds the column.
    expect(rows()[0]).not.toHaveProperty("org_unit");
  });

  it("refuses an org_unit belonging to another tenant, before any row exists", async () => {
    const key = await makeKeyPair();
    const { store, rows } = capturingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    const res = await app.request(
      "/v1/mandate",
      mintRequest({ envelope: mandate, org_unit: "another-tenant/engineering" }),
    );
    expect(res.status).toBe(400);
    expect((await refusal(res)).error).toBe("mandate_org_unit_invalid");
    expect(rows()).toHaveLength(0);
  });

  it("refuses a malformed or ambiguous path rather than normalising it", async () => {
    const key = await makeKeyPair();
    const { store, rows } = capturingStore();
    const app = appWith(store, key);
    const mandate = await signedMandate(key);

    for (const orgUnit of [
      "Tenant-Test/Engineering", // not lowercase
      "tenant-test/", // trailing slash
      "tenant-test//platform", // empty segment
      "tenant-test/engineering/", // trailing slash
      "tenant-test/eng_platform", // a LIKE wildcard character
      "tenant-test/engineering/../platform", // traversal
    ]) {
      const res = await app.request(
        "/v1/mandate",
        mintRequest({ envelope: mandate, org_unit: orgUnit }),
      );
      expect(res.status, orgUnit).toBe(400);
      expect((await refusal(res)).error, orgUnit).toBe("mandate_org_unit_invalid");
    }
    expect(rows()).toHaveLength(0);
  });
});

describe("the mint's constants do not drift from the read route or the pass", () => {
  it("verifies against the same URL base the pass QR carries", () => {
    const face = readFileSync(new URL("../../../packages/pass/src/face.ts", import.meta.url), "utf8");
    const match = /export const VERIFICATION_BASE = "([^"]+)";/.exec(face);
    expect(match?.[1]).toBe(MINT_VERIFICATION_BASE);
  });

  it("accepts only serials the public read also answers", () => {
    // The mint is narrower on purpose: the short code resolves but is not mintable.
    expect(MANDATE_SERIAL_RE.test("vch-7F3")).toBe(true);
    expect(MINT_SERIAL_RE.test("vch-7F3")).toBe(false);
    for (let index = 0; index < 50; index += 1) {
      const serial = generateSerial();
      expect(MINT_SERIAL_RE.test(serial)).toBe(true);
      expect(MANDATE_SERIAL_RE.test(serial)).toBe(true);
    }
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  generateSerial,
  issue,
  revoke,
  type Mandate,
  type MandateScope,
} from "@paystage/mandate";
import { createApp } from "../src/app.js";
import {
  createMemoryMandateStore,
  revokeStoredMandate,
  supabaseMandateStore,
  writeMandate,
  type MandateWriter,
  type NewMandateRow,
} from "../src/mandate-store.js";

/**
 * The mandate store (#453).
 *
 * Everything here runs without a database. The contract being pinned:
 *  - the adapter's public projection has no payee list, no spend history, no agent address;
 *  - the writer refuses what `verify` refuses, and refuses a state the signed lifetime contradicts;
 *  - revocation is an update plus a stored statement, never an edit of the envelope;
 *  - the endpoint's injected seam answers `unknown` for an unwritten serial and a real record for a
 *    written one.
 */

const baseEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
};

const SCOPE: MandateScope = {
  per_payment: "2.00",
  window_amount: "20.00",
  window_seconds: 86_400,
  allowed_payees: ["0x1111111111111111111111111111111111111111"],
};

interface KeyPair {
  privateKey: CryptoKey;
  jwk: Record<string, unknown>;
}

async function makeKeyPair(): Promise<KeyPair> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as unknown as Record<string, unknown>;
  return { privateKey: pair.privateKey, jwk };
}

async function signedMandate(key: KeyPair, overrides: { expires_at?: Date } = {}): Promise<Mandate> {
  return issue(
    {
      principal: "Northwind Ltd",
      agent: "agent-wallet-1",
      scope: SCOPE,
      serial: generateSerial(),
      issued_at: new Date(Date.now() - 60_000),
      expires_at: overrides.expires_at ?? new Date(Date.now() + 86_400_000),
    },
    { privateKey: key.privateKey },
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the Supabase adapter strips the public path", () => {
  it("returns the caps but never the payee list, agent or envelope", async () => {
    const row = {
      serial: "vch_0123456789abcdefghij_KL",
      state: "active",
      scope: SCOPE,
      expires_at: "2027-01-31T23:59:59Z",
      principal: "Northwind Ltd",
      // Deliberately present in the row and selected by nothing: a leak here would be the adapter's.
      agent: "0xagentagentagentagentagentagentagentagent",
      envelope: { serial: "vch_0123456789abcdefghij_KL" },
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify([row]), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const store = supabaseMandateStore({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    });
    expect(store).toBeDefined();
    const record = await store!.get("vch_0123456789abcdefghij_KL");

    expect(record).toEqual({
      serial: "vch_0123456789abcdefghij_KL",
      status: "active",
      per_payment: "2.00",
      window_amount: "20.00",
      window_seconds: 86_400,
      expires_at: "2027-01-31T23:59:59Z",
      principal: { display: "Northwind Ltd", assertion: "self" },
    });
    expect(record).not.toHaveProperty("agent");
    expect(record).not.toHaveProperty("allowed_payees");
    expect(record).not.toHaveProperty("envelope");
    expect(JSON.stringify(record)).not.toContain("0x1111111111111111111111111111111111111111");
    expect(JSON.stringify(record)).not.toContain("0xagentagent");

    // The column list is the rule at source: the public read never asks the wire for those fields.
    const url = String((fetchMock.mock.calls[0] as unknown as [string])[0]);
    expect(url).toContain("serial=eq.");
    for (const forbidden of ["agent", "envelope", "revocation", "tenant_id", "allowed_payees"]) {
      expect(url, forbidden).not.toContain(forbidden);
    }
  });

  it("is undefined without both Supabase bindings, so the endpoint keeps answering unknown", () => {
    expect(supabaseMandateStore({})).toBeUndefined();
    expect(supabaseMandateStore({ SUPABASE_URL: "https://example.supabase.co" })).toBeUndefined();
  });

  it("turns a store failure into a throw, so the endpoint can answer 503 rather than unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const store = supabaseMandateStore({
      SUPABASE_URL: "https://example.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "service-role",
    });
    await expect(store!.get("vch_0123456789abcdefghij_KL")).rejects.toThrow(/HTTP 500/);
  });
});

describe("the writer refuses what verify refuses", () => {
  it("refuses an unsigned envelope and writes nothing", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const unsigned = { ...mandate, signature: "" };
    const store = createMemoryMandateStore();

    await expect(
      writeMandate(store, unsigned, { tenantId: "tenant-1", verify: { jwk: key.jwk } }),
    ).rejects.toThrow(/unsigned/);
    expect(store.get(mandate.serial)).toBeNull();
  });

  it("refuses a tampered envelope and writes nothing", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const tampered: Mandate = { ...mandate, scope: { ...mandate.scope, per_payment: "200.00" } };
    const store = createMemoryMandateStore();

    await expect(
      writeMandate(store, tampered, { tenantId: "tenant-1", verify: { jwk: key.jwk } }),
    ).rejects.toThrow(/tampered/);
    expect(store.get(mandate.serial)).toBeNull();
  });

  it("refuses a state its signed lifetime contradicts", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const store = createMemoryMandateStore();

    await expect(
      writeMandate(store, mandate, { tenantId: "tenant-1", verify: { jwk: key.jwk }, state: "expired" }),
    ).rejects.toThrow(/implies active/);
    expect(store.get(mandate.serial)).toBeNull();
  });

  it("refuses an empty tenant, because RLS would have nothing to key on", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const store = createMemoryMandateStore();
    await expect(
      writeMandate(store, mandate, { tenantId: " ", verify: { jwk: key.jwk } }),
    ).rejects.toThrow(/tenantId/);
  });
});

describe("revocation is a second statement, not an envelope edit", () => {
  it("flips the stored state and stores the statement while the envelope bytes stay identical", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const inner = createMemoryMandateStore();
    const inserted: NewMandateRow[] = [];
    const writer: MandateWriter = {
      insert: async (row) => {
        inserted.push(row);
        await inner.insert(row);
      },
      revoke: (serial, statement, at) => inner.revoke(serial, statement, at),
    };

    await writeMandate(writer, mandate, { tenantId: "tenant-1", verify: { jwk: key.jwk } });
    expect(inserted[0]?.envelope).toEqual(mandate);
    expect((await inner.get(mandate.serial))?.status).toBe("active");

    const statement = await revoke(mandate, { privateKey: key.privateKey });
    await revokeStoredMandate(writer, mandate, statement, { verify: { jwk: key.jwk } });

    expect((await inner.get(mandate.serial))?.status).toBe("revoked");
    // The writer's insert happened once; revocation went through the update path, not a second insert.
    expect(inserted).toHaveLength(1);
    expect(inserted[0]?.envelope).toEqual(mandate);
  });

  it("refuses a revocation that names another serial", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const other = await signedMandate(key);
    const statement = await revoke(other, { privateKey: key.privateKey });
    const store = createMemoryMandateStore();
    await writeMandate(store, mandate, { tenantId: "tenant-1", verify: { jwk: key.jwk } });

    await expect(
      revokeStoredMandate(store, mandate, statement, { verify: { jwk: key.jwk } }),
    ).rejects.toThrow(/statement names/);
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });

  it("refuses an unverifiable revocation rather than flipping the state", async () => {
    const key = await makeKeyPair();
    const mandate = await signedMandate(key);
    const statement = { ...(await revoke(mandate, { privateKey: key.privateKey })), signature: "AAAA" };
    const store = createMemoryMandateStore();
    await writeMandate(store, mandate, { tenantId: "tenant-1", verify: { jwk: key.jwk } });

    await expect(
      revokeStoredMandate(store, mandate, statement, { verify: { jwk: key.jwk } }),
    ).rejects.toThrow(/tampered/);
    expect((await store.get(mandate.serial))?.status).toBe("active");
  });
});

describe("the endpoint's injected seam serves what the writer stored", () => {
  async function servedApp() {
    const key = await makeKeyPair();
    const store = createMemoryMandateStore();
    const written = await signedMandate(key);
    await writeMandate(store, written, { tenantId: "tenant-1", verify: { jwk: key.jwk } });
    const app = createApp(baseEnv, { protect: false, mandateSource: store });
    return { app, store, written };
  }

  it("answers unknown (HTTP 200) for a serial never written", async () => {
    const { app } = await servedApp();
    const res = await app.request(`/v1/mandate/${generateSerial()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("unknown");
    expect(body.verdict_for_seller).toBe("unknown");
    expect(body.scope).toBeNull();
    expect(body.principal).toBeNull();
  });

  it("answers a real record for a written serial, without the payee list or agent", async () => {
    const { app, written } = await servedApp();
    const res = await app.request(`/v1/mandate/${written.serial}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.serial).toBe(written.serial);
    expect(body.status).toBe("active");
    expect(body.verdict_for_seller).toBe("trust");
    expect(body.scope).toEqual({
      per_payment: "2.00",
      window_amount: "20.00",
      window_seconds: 86_400,
      expires_at: written.expires_at,
    });
    expect(body.principal).toEqual({ display: "Northwind Ltd", assertion: "self" });
    const serialised = JSON.stringify(body);
    expect(serialised).not.toContain("0x1111111111111111111111111111111111111111");
    expect(serialised).not.toContain("agent-wallet-1");
    expect(serialised).not.toContain("allowed_payees");
    expect(serialised).not.toContain("envelope");
  });
});

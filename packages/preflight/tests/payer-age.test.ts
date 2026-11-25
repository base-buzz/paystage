import { describe, expect, it } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type AcceptOption,
  type PaymentRequest,
} from "../src/evaluate.js";
import {
  createPayerFirstSeenStore,
  derivePayerKey,
  normalisePayer,
  resolvePayerAge,
  type PayerFirstSeenPersistence,
} from "../src/payer-first-seen.js";

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const BASE_SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

/** The rule under test: younger than 7 days AND amount over 0.50 USDC. */
const YOUNGER_THAN_DAYS = 7;
const AMOUNT_ABOVE = "0.50";

function policy(overrides: Partial<Policy> = {}): Policy {
  return {
    version: 1,
    max_amount: { value: "10.00", asset: "USDC", decimals: 6 },
    allowed_pay_to: [PAY_TO],
    allowed_assets: [
      {
        symbol: "USDC",
        decimals: 6,
        address: BASE_SEPOLIA_USDC,
        network: "eip155:84532",
      },
    ],
    allowed_networks: ["eip155:84532"],
    max_timeout_seconds: 300,
    unknown_payee: "review",
    payer_age: {
      younger_than_days: YOUNGER_THAN_DAYS,
      amount_above: { value: AMOUNT_ABOVE, asset: "USDC", decimals: 6 },
    },
    ...overrides,
  };
}

function accept(overrides: Partial<AcceptOption> = {}): AcceptOption {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: "250000", // 0.25 USDC, under the rule's amount threshold
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    asset: BASE_SEPOLIA_USDC,
    ...overrides,
  };
}

function request(overrides: Partial<AcceptOption> = {}): PaymentRequest {
  return { x402Version: 2, accepts: [accept(overrides)] };
}

/** A fixture for the injected persistence half of the store. No database, no client. */
class FixturePersistence implements PayerFirstSeenPersistence {
  readonly rows = new Map<string, string>();
  failGet = false;
  failInsert = false;

  async get(payerKey: string): Promise<string | null> {
    if (this.failGet) throw new Error("fixture store unavailable");
    return this.rows.get(payerKey) ?? null;
  }

  async insert(payerKey: string, firstSeenIso: string): Promise<void> {
    if (this.failInsert) throw new Error("fixture store unavailable");
    // First sighting only; an existing row must not move.
    if (!this.rows.has(payerKey)) this.rows.set(payerKey, firstSeenIso);
  }
}

describe("payer age (#409): one rule — new payer over the amount threshold is review", () => {
  it("pays a new payer within the amount limit", () => {
    const result = evaluatePayment(request(), policy(), {
      payerAge: { known: true, ageDays: 0 },
    });

    expect(result.decision).toBe("pay");
    expect(result.steps.find((s) => s.rule === "accept.payer_age")?.outcome).toBe("pass");
  });

  it("reviews a new payer over the amount limit, and names only the threshold", () => {
    const young = evaluatePayment(request({ amount: "600000" }), policy(), {
      payerAge: { known: true, ageDays: 0 },
    });

    expect(young.decision).toBe("review");
    expect(young.reasons[0]).toBe(
      "payer_age: payer first seen fewer than 7 days ago and amount 0.6 USDC exceeds payer_age.amount_above 0.50 USDC — a new payer over the threshold needs review",
    );
    expect(young.steps.find((s) => s.rule === "accept.payer_age")?.outcome).toBe("review");
    // The verdict carries the reason, not the measured age: three days and zero days produce the
    // same sentence, and the number is nowhere in the result.
    const threeDays = evaluatePayment(request({ amount: "600000" }), policy(), {
      payerAge: { known: true, ageDays: 3 },
    });
    expect(threeDays.reasons[0]).toBe(young.reasons[0]);
    expect(JSON.stringify(young)).not.toContain("ageDays");
    expect(young.reasons[0]).not.toContain("0 days");
    expect(young.packet?.rule).toBe(young.reasons[0]);
  });

  it("does not downgrade an old payer over the amount limit", () => {
    const result = evaluatePayment(request({ amount: "600000" }), policy(), {
      payerAge: { known: true, ageDays: YOUNGER_THAN_DAYS },
    });

    expect(result.decision).toBe("pay");
    const step = result.steps.find((s) => s.rule === "accept.payer_age");
    expect(step?.outcome).toBe("pass");
    expect(step?.detail).toContain("not younger than 7 days");
  });

  it("treats a payer exactly at the age boundary as old, and amount at the boundary as under", () => {
    const atAge = evaluatePayment(request({ amount: "600000" }), policy(), {
      payerAge: { known: true, ageDays: YOUNGER_THAN_DAYS },
    });
    expect(atAge.decision).toBe("pay");

    const atAmount = evaluatePayment(request({ amount: "500000" }), policy(), {
      payerAge: { known: true, ageDays: 0 },
    });
    expect(atAmount.decision).toBe("pay");
  });

  it("fails open on unknown age: missing data is not a new payer", () => {
    const unknown = evaluatePayment(request({ amount: "600000" }), policy(), {
      payerAge: { known: false },
    });
    expect(unknown.decision).toBe("pay");
    const unknownStep = unknown.steps.find((s) => s.rule === "accept.payer_age");
    expect(unknownStep?.outcome).toBe("skip");
    expect(unknownStep?.detail).toContain("fail-open");

    const absent = evaluatePayment(request({ amount: "600000" }), policy());
    expect(absent.decision).toBe("pay");
    expect(absent.steps.find((s) => s.rule === "accept.payer_age")?.outcome).toBe("skip");
  });

  it("does not run at all when the policy has no payer_age block", () => {
    const result = evaluatePayment(request({ amount: "600000" }), policy({ payer_age: undefined }), {
      payerAge: { known: true, ageDays: 0 },
    });

    expect(result.decision).toBe("pay");
    expect(result.steps.some((s) => s.rule === "accept.payer_age")).toBe(false);
  });

  it("reads the threshold in the matched asset's unit, not the spec's declared decimals", () => {
    // A policy can declare a threshold with the wrong decimals; the cap must still be read in the
    // unit of the asset the challenge matched, or 0.50 read at 18 decimals never fires.
    const result = evaluatePayment(request({ amount: "600000" }), policy({
      payer_age: {
        younger_than_days: YOUNGER_THAN_DAYS,
        amount_above: { value: "0.50", asset: "USDC", decimals: 18 },
      },
    }), { payerAge: { known: true, ageDays: 0 } });

    expect(result.decision).toBe("review");
    expect(result.reasons[0]).toContain("exceeds payer_age.amount_above 0.50 USDC");
  });
});

describe("payer first-seen (#409): salted keys, first sighting only", () => {
  const payer = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
  const salt = "fixture-salt-not-a-production-value";

  it("derives a stable salted key and never stores the address", async () => {
    const key = await derivePayerKey(payer, salt);

    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(key).toBe(await derivePayerKey(payer, salt));
    // Case-insensitive EVM address, same key.
    expect(await derivePayerKey(payer.toLowerCase(), salt)).toBe(key);
    // A different salt is a different key; the key is not the address or a plain hash of it.
    expect(await derivePayerKey(payer, `${salt}-other`)).not.toBe(key);
    expect(key).not.toContain(payer.slice(2).toLowerCase());
  });

  it("keeps Solana base58 addresses case-sensitive when normalising", () => {
    const a = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d";
    expect(normalisePayer(a)).toBe(a);
    expect(normalisePayer(a.toLowerCase())).not.toBe(a);
  });

  it("returns unseen before the first sighting and seen after it", async () => {
    const persistence = new FixturePersistence();
    const store = createPayerFirstSeenStore(persistence);
    const key = await derivePayerKey(payer, salt);

    expect(await store.lookup(key)).toEqual({ status: "unseen" });
    await store.remember(key, new Date("2026-11-20T00:00:00.000Z"));
    expect(await store.lookup(key)).toEqual({
      status: "seen",
      firstSeen: new Date("2026-11-20T00:00:00.000Z"),
    });
    // A second write does not move the first sighting.
    await store.remember(key, new Date("2026-11-25T00:00:00.000Z"));
    expect(await store.lookup(key)).toEqual({
      status: "seen",
      firstSeen: new Date("2026-11-20T00:00:00.000Z"),
    });
  });

  it("treats a throwing or malformed store as unknown, never as a new payer", async () => {
    const persistence = new FixturePersistence();
    const store = createPayerFirstSeenStore(persistence);
    const key = await derivePayerKey(payer, salt);

    persistence.failGet = true;
    expect(await store.lookup(key)).toEqual({ status: "unknown" });
    expect(await resolvePayerAge(store, key, new Date())).toEqual({ known: false });

    persistence.failGet = false;
    persistence.rows.set(key, "not-a-date");
    expect(await store.lookup(key)).toEqual({ status: "unknown" });

    expect(await store.lookup("not-a-key")).toEqual({ status: "unknown" });
  });

  it("records the first sighting when the store answers unseen, then measures from it", async () => {
    const persistence = new FixturePersistence();
    const store = createPayerFirstSeenStore(persistence);
    const key = await derivePayerKey(payer, salt);
    const first = new Date("2026-11-20T12:00:00.000Z");

    expect(await resolvePayerAge(store, key, first)).toEqual({ known: true, ageDays: 0 });
    expect(persistence.rows.get(key)).toBe(first.toISOString());

    expect(await resolvePayerAge(store, key, new Date("2026-11-23T12:00:00.000Z"))).toEqual({
      known: true,
      ageDays: 3,
    });
  });

  it("is unknown without a store, a key, or a sensible clock reading", async () => {
    const persistence = new FixturePersistence();
    const store = createPayerFirstSeenStore(persistence);
    const key = await derivePayerKey(payer, salt);

    expect(await resolvePayerAge(undefined, key, new Date())).toEqual({ known: false });
    expect(await resolvePayerAge(store, undefined, new Date())).toEqual({ known: false });

    persistence.rows.set(key, "2026-11-20T12:00:00.000Z");
    // A future first_seen is a bad row, not a negative age; read it as the youngest payer.
    expect(await resolvePayerAge(store, key, new Date("2026-11-19T12:00:00.000Z"))).toEqual({
      known: true,
      ageDays: 0,
    });
  });
});

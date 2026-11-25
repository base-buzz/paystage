import { describe, expect, it } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  challengeDigest,
  createMemoryChallengeVerdictStore,
  DEFAULT_CHALLENGE_TTL_MS,
  deriveChallengeKey,
  evaluateWithChallengeIdempotency,
  REPEAT_REASON,
} from "../src/challenge-idempotency.js";

/**
 * #444 — a retried preflight is not a second opinion.
 *
 * The failure: an agent gets `pay`, times out before signing, retries the same challenge, and gets
 * a second fresh `pay`. The tests below pin the four behaviours the row asks for — a repeat returns
 * the original verdict, a changed amount is a different key, a missing store degrades with a named
 * reason, and the digest ignores JSON key order — plus the two bounds that make the store safe
 * (TTL and entry cap) and the scope rule that stops one agent's verdict being served to another.
 */

const PAY_TO = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const OTHER_PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const policy = {
  version: 1,
  max_amount: { value: "5", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 600,
} as unknown as Policy;

/** Same challenge, but only 09:00–09:59 UTC is allowed — so a re-evaluation at noon is a refusal. */
const timeWindowPolicy = {
  ...policy,
  time_window: { allowed_hours_utc: [9, 10] },
} as unknown as Policy;

const agentPolicy = {
  ...policy,
  agents: {
    // 1,000 atomic (0.001 USDC) is inside the global cap but over this agent's 500.
    tight: { max_amount: { value: "0.0005", asset: "USDC", decimals: 6 } },
    loose: {},
  },
} as unknown as Policy;

function challenge(overrides: {
  amount?: string;
  payTo?: string;
  resourceUrl?: string;
  acceptKeyOrder?: "short" | "long";
} = {}) {
  const accept = {
    scheme: "exact",
    network: "eip155:8453",
    asset: USDC,
    amount: overrides.amount ?? "1000",
    payTo: overrides.payTo ?? PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "USD Coin", version: "2" },
  };
  const reordered =
    overrides.acceptKeyOrder === "long"
      ? {
          maxTimeoutSeconds: accept.maxTimeoutSeconds,
          extra: { version: accept.extra.version, name: accept.extra.name },
          payTo: accept.payTo,
          amount: accept.amount,
          asset: accept.asset,
          network: accept.network,
          scheme: accept.scheme,
        }
      : accept;
  return {
    x402Version: 2,
    resource: {
      url: overrides.resourceUrl ?? "https://seller.example/paid",
      description: "paid resource",
      mimeType: "application/json",
    },
    accepts: [reordered],
  } as never;
}

const t0 = new Date("2026-11-25T09:30:00.000Z");
const t0Iso = t0.toISOString();

function fixedClock(iso: string) {
  return () => new Date(iso);
}

describe("challenge digest", () => {
  it("is stable across key ordering in the challenge, including nested extra", async () => {
    const a = await challengeDigest(challenge({ acceptKeyOrder: "short" }));
    const b = await challengeDigest(challenge({ acceptKeyOrder: "long" }));
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when the amount changes, because the digest covers the whole payment", async () => {
    const a = await challengeDigest(challenge({ amount: "1000" }));
    const b = await challengeDigest(challenge({ amount: "1001" }));
    expect(a).not.toBe(b);
  });

  it("changes when the payee or the resource changes", async () => {
    const base = await challengeDigest(challenge());
    const payee = await challengeDigest(challenge({ payTo: OTHER_PAY_TO }));
    const resource = await challengeDigest(challenge({ resourceUrl: "https://other.example/paid" }));
    expect(payee).not.toBe(base);
    expect(resource).not.toBe(base);
  });
});

describe("salted keys and the bounded store", () => {
  it("derives a different stored key per salt, and never stores the repeat key itself", async () => {
    const repeatKey = "a".repeat(64);
    const one = await deriveChallengeKey(repeatKey, "salt-one");
    const two = await deriveChallengeKey(repeatKey, "salt-two");
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(one).not.toBe(two);
    expect(one).not.toBe(repeatKey);
  });

  it("refuses an unsalted (non-64-hex) store key", async () => {
    const store = createMemoryChallengeVerdictStore();
    await expect(
      store.remember("not-a-salted-key", {
        verdict: { decision: "pay" } as never,
        as_of: t0Iso,
      }),
    ).rejects.toThrow(/salted 64-hex/);
  });

  it("expires a record after its TTL instead of keeping it forever", async () => {
    let clock = new Date(t0);
    const store = createMemoryChallengeVerdictStore({
      ttlMs: 1_000,
      now: () => clock,
    });
    const options = {
      challengeStore: store,
      challengeSalt: "test-salt",
      now: t0,
    };

    const first = await evaluateWithChallengeIdempotency(challenge(), policy, options);
    expect(first.repeat_check?.reason).toBe(REPEAT_REASON.firstSight);

    clock = new Date(t0.getTime() + 1_001);
    const slowRetry = await evaluateWithChallengeIdempotency(challenge(), policy, {
      ...options,
      now: clock,
    });
    // Expiry means the slow retry is a *new* evaluation. It is still `pay` because the payment is
    // unchanged; the observable fact is that it was not recognised as a repeat.
    expect(slowRetry.repeated).toBeUndefined();
    expect(slowRetry.repeat_check?.reason).toBe(REPEAT_REASON.firstSight);
  });

  it("evicts the oldest record when the entry cap is reached", async () => {
    const store = createMemoryChallengeVerdictStore({ maxEntries: 1 });
    const options = { challengeStore: store, challengeSalt: "test-salt", now: t0 };

    const firstA = await evaluateWithChallengeIdempotency(challenge({ amount: "1000" }), policy, options);
    expect(firstA.repeat_check?.reason).toBe(REPEAT_REASON.firstSight);

    await evaluateWithChallengeIdempotency(challenge({ amount: "1001" }), policy, options);

    const againA = await evaluateWithChallengeIdempotency(challenge({ amount: "1000" }), policy, options);
    expect(againA.repeated).toBeUndefined();
    expect(againA.repeat_check?.reason).toBe(REPEAT_REASON.firstSight);
  });

  it("is declared at ten minutes, the same retry window as the identifier check", () => {
    expect(DEFAULT_CHALLENGE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

describe("a retried preflight returns the original verdict", () => {
  it("returns the same verdict, says it is a repeat, and carries the original as_of", async () => {
    const store = createMemoryChallengeVerdictStore({ now: fixedClock("2026-11-25T09:31:00.000Z") });
    const options = { challengeStore: store, challengeSalt: "test-salt", now: t0 };

    const first = await evaluateWithChallengeIdempotency(challenge(), timeWindowPolicy, options);
    expect(first.decision).toBe("pay");
    expect(first.repeat_check).toEqual({ checked: true, reason: REPEAT_REASON.firstSight });

    // Noon is outside the policy's 09:00–09:59 window. If the retry were re-evaluated it would be
    // `do_not_pay`; receiving `pay` proves the stored verdict was returned, not recomputed.
    const retry = await evaluateWithChallengeIdempotency(challenge(), timeWindowPolicy, {
      ...options,
      now: new Date("2026-11-25T12:00:00.000Z"),
    });

    expect(retry.decision).toBe(first.decision);
    expect(retry.reasons).toEqual(first.reasons);
    expect(retry.summary).toBe(first.summary);
    expect(retry.selectedAccept).toEqual(first.selectedAccept);
    expect(retry.repeated).toBe(true);
    expect(retry.as_of).toBe(t0Iso);
    expect(retry.repeat_check).toEqual({ checked: true, reason: REPEAT_REASON.repeat });
    expect(retry.challenge_digest).toBe(first.challenge_digest);
    expect(retry.steps.at(-1)?.rule).toBe("result.repeat");
    expect(retry.steps.at(-1)?.detail).toContain(t0Iso);
  });

  it("still returns the original verdict for a non-pay decision instead of re-asking", async () => {
    const store = createMemoryChallengeVerdictStore();
    const options = { challengeStore: store, challengeSalt: "test-salt", now: t0 };

    const expensive = challenge({ amount: "999999999" });
    const first = await evaluateWithChallengeIdempotency(expensive, policy, options);
    expect(first.decision).toBe("do_not_pay");

    const retry = await evaluateWithChallengeIdempotency(expensive, policy, options);
    expect(retry.decision).toBe("do_not_pay");
    expect(retry.repeated).toBe(true);
    expect(retry.as_of).toBe(t0Iso);
  });

  it("does not hand one agent's verdict to another agent", async () => {
    const store = createMemoryChallengeVerdictStore();
    const options = { challengeStore: store, challengeSalt: "test-salt", now: t0 };

    const loose = await evaluateWithChallengeIdempotency(challenge({ amount: "1000" }), agentPolicy, {
      ...options,
      agentId: "loose",
    });
    expect(loose.decision).toBe("pay");

    // Same challenge, tighter agent: 1,000 atomic is over its 500 ceiling. If the repeat key were
    // only the challenge digest, this would return `pay` from the other agent's record.
    const tight = await evaluateWithChallengeIdempotency(challenge({ amount: "1000" }), agentPolicy, {
      ...options,
      agentId: "tight",
    });
    expect(tight.decision).toBe("do_not_pay");
    expect(tight.repeated).toBeUndefined();
    expect(tight.repeat_check?.reason).toBe(REPEAT_REASON.firstSight);
  });
});

describe("a changed challenge is a new decision", () => {
  it("treats a changed amount as a different digest and evaluates it fresh", async () => {
    const store = createMemoryChallengeVerdictStore();
    const options = { challengeStore: store, challengeSalt: "test-salt", now: t0 };

    const first = await evaluateWithChallengeIdempotency(challenge({ amount: "1000" }), policy, options);
    expect(first.decision).toBe("pay");

    const changed = await evaluateWithChallengeIdempotency(challenge({ amount: "999999999" }), policy, options);
    expect(changed.decision).toBe("do_not_pay");
    expect(changed.repeated).toBeUndefined();
    expect(changed.repeat_check?.reason).toBe(REPEAT_REASON.firstSight);
    expect(changed.challenge_digest).not.toBe(first.challenge_digest);
  });

  it("treats a changed payee as a different digest and evaluates it fresh", async () => {
    const store = createMemoryChallengeVerdictStore();
    const storePolicy = {
      ...policy,
      allowed_pay_to: [PAY_TO, OTHER_PAY_TO],
    } as unknown as Policy;
    const options = { challengeStore: store, challengeSalt: "test-salt", now: t0 };

    const first = await evaluateWithChallengeIdempotency(challenge(), storePolicy, options);
    expect(first.decision).toBe("pay");

    const changed = await evaluateWithChallengeIdempotency(
      challenge({ payTo: OTHER_PAY_TO }),
      storePolicy,
      options,
    );
    expect(changed.decision).toBe("pay");
    expect(changed.repeated).toBeUndefined();
    expect(changed.challenge_digest).not.toBe(first.challenge_digest);
  });
});

describe("a missing or broken store degrades with a named reason", () => {
  it("keeps today's stateless behaviour when no store is injected, and says so", async () => {
    const first = await evaluateWithChallengeIdempotency(challenge(), policy, { now: t0 });
    const second = await evaluateWithChallengeIdempotency(challenge(), policy, { now: t0 });

    expect(first.decision).toBe("pay");
    expect(second.decision).toBe("pay");
    expect(first.repeated).toBeUndefined();
    expect(second.repeated).toBeUndefined();
    expect(first.challenge_digest).toMatch(/^[0-9a-f]{64}$/);
    expect(first.repeat_check).toEqual({
      checked: false,
      reason: REPEAT_REASON.storeAbsent,
    });
  });

  it("degrades, rather than refusing, when a store is injected without a salt", async () => {
    const store = createMemoryChallengeVerdictStore();
    const result = await evaluateWithChallengeIdempotency(challenge(), policy, {
      challengeStore: store,
      now: t0,
    });
    expect(result.decision).toBe("pay");
    expect(result.repeat_check).toEqual({
      checked: false,
      reason: REPEAT_REASON.saltMissing,
    });
  });

  it("degrades, rather than refusing, when the store throws on lookup", async () => {
    const store = {
      async lookup() {
        throw new Error("database down");
      },
      async remember() {},
    };
    const result = await evaluateWithChallengeIdempotency(challenge(), policy, {
      challengeStore: store,
      challengeSalt: "test-salt",
      now: t0,
    });
    expect(result.decision).toBe("pay");
    expect(result.repeat_check).toEqual({
      checked: false,
      reason: REPEAT_REASON.storeUnreadable,
    });
  });

  it("returns the fresh verdict and names a failed write, so the next retry is not silently trusted", async () => {
    const store = {
      async lookup() {
        return null;
      },
      async remember() {
        throw new Error("write failed");
      },
    };
    const result = await evaluateWithChallengeIdempotency(challenge(), policy, {
      challengeStore: store,
      challengeSalt: "test-salt",
      now: t0,
    });
    expect(result.decision).toBe("pay");
    expect(result.repeat_check).toEqual({
      checked: true,
      reason: REPEAT_REASON.storeWriteFailed,
    });
  });
});

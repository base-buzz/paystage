import { describe, it, expect } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import {
  CIRCLE_BLACKLISTED_ADDRESSES,
  CIRCLE_BLACKLIST_STATES,
  CIRCLE_BLACKLIST_CHAIN_ID,
  CIRCLE_BLACKLIST_COVERED_FROM_BLOCK,
} from "../src/circle-blacklist-addresses.js";
import { circleBlacklistVerdict } from "../src/circle-blacklist.js";
import { SANCTIONED_ADDRESSES } from "../src/sanctioned-addresses.js";

/**
 * #369: Circle's on-chain USDC blacklist is enforced with its own reason code.
 *
 * The two lists must not collapse into one verdict. A Circle freeze is a contract-level action by the issuer on Base;
 * an OFAC listing is a government sanctions claim. A refusal that names the wrong one is worse than a narrower list,
 * so the assertions below check the words as well as the verdict.
 *
 * The fixture address is the first `Blacklisted(address)` event in /work/ops/docs/state/circle-blacklist.json
 * (block 51,088,253, tx 0x7f32d066…8c7fc). It is in the Circle corpus and not in the OFAC list, which is what makes the
 * "do not collapse" assertion meaningful.
 */
const CIRCLE_FIXTURE = "0x0ede564e315f8e1803161a22e8404c624c35b1fb";
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const NOT_LISTED = "0x0000000000000000000000000000000000000001";
const ALLOWED = "0x1111111111111111111111111111111111111111";

const policy = (payee: string) => ({
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC_BASE, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: [payee],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
});

const challenge = (payee: string, network = "eip155:8453") => ({
  x402Version: 2,
  accepts: [
    { scheme: "exact", network, amount: "2000", asset: USDC_BASE, payTo: payee, maxTimeoutSeconds: 300 },
  ],
});

describe("Circle USDC blacklist on Base (#369)", () => {
  it("ships the on-chain list separately from OFAC, with its coverage start", () => {
    expect(CIRCLE_BLACKLISTED_ADDRESSES.size).toBeGreaterThan(50);
    expect(CIRCLE_BLACKLIST_CHAIN_ID).toBe(8453);
    expect(CIRCLE_BLACKLIST_COVERED_FROM_BLOCK).toBe(51_000_000);
    // Separate modules, separate memberships: the fixture is blacklisted by Circle and not OFAC-sanctioned.
    expect(CIRCLE_BLACKLISTED_ADDRESSES.has(CIRCLE_FIXTURE)).toBe(true);
    expect(SANCTIONED_ADDRESSES.has(CIRCLE_FIXTURE)).toBe(false);
  });

  it("refuses a fixture address from circle-blacklist.json with the Circle reason", () => {
    const result = evaluatePayment(challenge(CIRCLE_FIXTURE) as never, policy(CIRCLE_FIXTURE) as never);
    expect(result.decision).toBe("do_not_pay");
    const reason = result.reasons.join(" ");
    expect(reason).toMatch(/Circle blacklisted this address on Base/);
    expect(reason).toMatch(/eip155:8453/);
    // The legal claim is different, so the word must not appear in the refusal.
    expect(reason).not.toMatch(/sanctioned/i);
    expect(reason).not.toMatch(/OFAC SDN/);
    const step = result.steps.find((s) => s.rule === "accept.payee_blacklisted_onchain");
    expect(step?.outcome).toBe("fail");
    expect(step?.detail).toBe(reason);
  });

  it("keeps an OFAC address on the OFAC reason — the two do not collapse", () => {
    const sanctioned = [...SANCTIONED_ADDRESSES][0];
    expect(CIRCLE_BLACKLISTED_ADDRESSES.has(sanctioned)).toBe(false);
    const result = evaluatePayment(challenge(sanctioned) as never, policy(sanctioned) as never);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.join(" ")).toMatch(/sanctioned address \(OFAC SDN\)/);
    expect(result.reasons.join(" ")).not.toMatch(/Circle blacklisted/);
    expect(result.steps.find((s) => s.rule === "accept.sanctions")?.outcome).toBe("fail");
    expect(result.steps.some((s) => s.rule === "accept.payee_blacklisted_onchain")).toBe(false);
  });

  it("passes an address that is in neither list", () => {
    expect(CIRCLE_BLACKLISTED_ADDRESSES.has(NOT_LISTED)).toBe(false);
    expect(SANCTIONED_ADDRESSES.has(NOT_LISTED)).toBe(false);
    const result = evaluatePayment(challenge(NOT_LISTED) as never, policy(NOT_LISTED) as never);
    expect(result.decision).toBe("pay");
  });

  it("does not apply the Base corpus to a payee on another chain", () => {
    const p = {
      ...policy(CIRCLE_FIXTURE),
      allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC_BASE, network: "eip155:1" }],
      allowed_networks: ["eip155:1"],
    };
    const result = evaluatePayment(challenge(CIRCLE_FIXTURE, "eip155:1") as never, p as never);
    expect(result.decision).toBe("pay");
    const step = result.steps.find((s) => s.rule === "accept.payee_blacklisted_onchain");
    expect(step?.outcome).toBe("skip");
    expect(step?.detail).toMatch(/holds Base \(eip155:8453\) events/);
  });

  it("carries the coverage limit in not_checked, so absence cannot read as clearance", () => {
    // A review, because only `review` builds a packet: the payee is legitimate-looking but not allowlisted.
    const p = { ...policy(ALLOWED), unknown_payee: "review" };
    const result = evaluatePayment(challenge(NOT_LISTED) as never, p as never);
    expect(result.decision).toBe("review");
    const lines = result.packet!.not_checked.filter((line) => line.includes("Circle USDC blacklist"));
    expect(lines).toHaveLength(1);
    const line = lines[0]!;
    expect(line).toContain("51,000,000");
    expect(line).toMatch(/not covered/);
    expect(line).toMatch(/absence proves nothing/i);
    // The sentence must not promise completeness: the covered range is a limit, not the whole chain.
    expect(line).not.toMatch(/complete|entire history|chain-wide/i);
    // The positive check line names the same range, so "no match" is not read as chain-wide either.
    expect(result.packet!.checked.join(" ")).toMatch(/covered range \(blocks 51,000,000 and later\)/);
  });
});

/**
 * #370: both Circle topics, and the latest event wins.
 *
 * The fixture below is a state list, not a chain read: one address frozen, one unfrozen, one unfrozen but OFAC-listed.
 * It exercises the evaluator's rule with the states the collector would generate, including the case the done-when names
 * — an address with a later `UnBlacklisted` passes the Circle check and still fails the OFAC check when OFAC lists it.
 */
describe("Circle latest-event state (#370)", () => {
  const FROZEN = "0x00000000000000000000000000000000000000f1";
  const UNFROZEN = "0x00000000000000000000000000000000000000f2";
  const DATE = "2026-11-20T00:00:00.000Z";
  const FIXTURE_STATES = [
    { address: FROZEN, state: "blacklisted", since: "2026-11-01T00:00:00.000Z", blockNumber: 60_000_001 },
    { address: UNFROZEN, state: "unblacklisted", since: DATE, blockNumber: 60_000_002 },
  ] as const;

  it("refuses only a blacklisted state; an unfrozen address passes the Circle check", () => {
    expect(circleBlacklistVerdict(FIXTURE_STATES, FROZEN)).toMatchObject({ refused: true, state: "blacklisted" });
    expect(circleBlacklistVerdict(FIXTURE_STATES, FROZEN.toUpperCase().replace("0X", "0x"))).toMatchObject({
      refused: true,
      state: "blacklisted",
    });
    const verdict = circleBlacklistVerdict(FIXTURE_STATES, UNFROZEN);
    expect(verdict.refused).toBe(false);
    expect(verdict.state).toBe("unblacklisted");
    expect(verdict.entry?.since).toBe(DATE);
    expect(circleBlacklistVerdict(FIXTURE_STATES, NOT_LISTED).state).toBe("none");
  });

  it("an unfrozen fixture passes Circle but still fails OFAC when OFAC lists it", () => {
    // OFAC wins independently of the Circle state: this is the sentence the backlog's done-when asks for.
    const sanctioned = [...SANCTIONED_ADDRESSES][0]!;
    const fixture = [{ address: sanctioned, state: "unblacklisted", since: DATE, blockNumber: 60_000_003 }] as const;
    expect(circleBlacklistVerdict(fixture, sanctioned).refused).toBe(false);

    const result = evaluatePayment(challenge(sanctioned) as never, policy(sanctioned) as never);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.join(" ")).toMatch(/sanctioned address \(OFAC SDN\)/);
    expect(result.reasons.join(" ")).not.toMatch(/Circle blacklisted/);
    expect(result.steps.find((step) => step.rule === "accept.sanctions")?.outcome).toBe("fail");
  });

  it("keeps the generated corpus and the enforced set consistent: every blacklisted row is enforced, no unfrozen row is", () => {
    expect(CIRCLE_BLACKLIST_STATES.length).toBeGreaterThan(50);
    for (const entry of CIRCLE_BLACKLIST_STATES) {
      expect(CIRCLE_BLACKLISTED_ADDRESSES.has(entry.address)).toBe(entry.state === "blacklisted");
      expect(Number.isSafeInteger(entry.blockNumber)).toBe(true);
    }
    // The corpus carries a date for every state row; without it the page cannot show the last event.
    for (const entry of CIRCLE_BLACKLIST_STATES) {
      if (entry.state === "unblacklisted") expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });

  it("a live unfrozen address is not refused by the Circle rule, and its pass names the unfreeze", () => {
    const unfrozen = CIRCLE_BLACKLIST_STATES.find(
      (entry) => entry.state === "unblacklisted" && !SANCTIONED_ADDRESSES.has(entry.address),
    );
    // The rule must still be exercised on live data when the covered range contains a usable unfreeze; the fixture
    // above covers the shape, this covers the shipped corpus.
    if (unfrozen) {
      const result = evaluatePayment(challenge(unfrozen.address) as never, policy(unfrozen.address) as never);
      expect(result.decision).toBe("pay");
      const step = result.steps.find((s) => s.rule === "accept.payee_blacklisted_onchain");
      expect(step?.outcome).toBe("pass");
      expect(step?.detail).toMatch(/UnBlacklisted at block/);
      if (unfrozen.since) expect(step?.detail).toContain(unfrozen.since.slice(0, 10));
    }
  });
});

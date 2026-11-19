import { describe, expect, it, beforeEach } from "vitest";
import { checkAddressRisk, clearAddressRiskCache, BLOCKING_FLAGS } from "../src/address-risk.js";

/**
 * The interesting cases are the ones where the feed does not answer, because that is where a check turns into a `pay`.
 */
const ok = (result: Record<string, string>) =>
  (async () =>
    new Response(JSON.stringify({ code: 1, message: "ok", result }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as unknown as typeof fetch;

const ADDRESS = "0x2cff890f0378a11913b6129b2e97417a2c302680";

beforeEach(() => clearAddressRiskCache());

describe("address risk", () => {
  it("reports the flags that are set, and only the blocking ones", async () => {
    const risk = await checkAddressRisk(ADDRESS, {
      fetchImpl: ok({ stealing_attack: "1", sanctioned: "0", contract_address: "1" }),
    });
    expect(risk.flagged).toEqual(["stealing_attack"]);
    expect(risk.error).toBeUndefined();
  });

  it("returns no flags for a clean address", async () => {
    const risk = await checkAddressRisk(ADDRESS, { fetchImpl: ok(Object.fromEntries(BLOCKING_FLAGS.map((f) => [f, "0"]))) });
    expect(risk.flagged).toEqual([]);
  });

  it("reports an error rather than an empty flag list when the feed fails", async () => {
    const risk = await checkAddressRisk(ADDRESS, {
      fetchImpl: (async () => new Response("nope", { status: 503 })) as unknown as typeof fetch,
    });
    expect(risk.error).toMatch(/503/);
    // The distinction that matters: no flags *and* an error is not "clean".
    expect(risk.flagged).toEqual([]);
  });

  it("does not cache a failure", async () => {
    let calls = 0;
    const failing = (async () => {
      calls += 1;
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    await checkAddressRisk(ADDRESS, { fetchImpl: failing });
    await checkAddressRisk(ADDRESS, { fetchImpl: failing });
    expect(calls).toBe(2);
  });

  it("caches a success within the TTL and reports that it did", async () => {
    let calls = 0;
    const spy = (async () => {
      calls += 1;
      return new Response(JSON.stringify({ result: { cybercrime: "1" } }), { status: 200 });
    }) as unknown as typeof fetch;
    const first = await checkAddressRisk(ADDRESS, { fetchImpl: spy, now: 1_000 });
    const second = await checkAddressRisk(ADDRESS, { fetchImpl: spy, now: 2_000 });
    expect(calls).toBe(1);
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.flagged).toEqual(["cybercrime"]);
  });

  it("rejects a non-EVM address without calling the feed", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const risk = await checkAddressRisk("not-an-address", { fetchImpl: spy });
    expect(risk.error).toMatch(/EVM/);
    expect(called).toBe(false);
  });
});

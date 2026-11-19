import { describe, expect, it, beforeEach } from "vitest";
import { checkHostReputation, clearHostReputationCache, baseDomain, YOUNG_DOMAIN_DAYS } from "../src/host-reputation.js";

/**
 * Two facts matter to a caller — the registration date and the earliest certificate — and the rest of this file is about whether
 * those two can be trusted: a failure must look like a failure, and a complete answer must be cached while a partial one is not.
 */
const BOOTSTRAP = JSON.stringify({ services: [[["com", "example"], ["https://rdap.example.test/"]]] });

const rdap = (date: string) =>
  new Response(JSON.stringify({ events: [{ eventAction: "registration", eventDate: date }] }), { status: 200 });
const crt = (dates: string[]) => new Response(JSON.stringify(dates.map((d) => ({ not_before: d }))), { status: 200 });

const fetchFor = (rdapDate: string | null, certs: string[] | null) =>
  (async (url: string) => {
    if (String(url).includes("iana.org")) return new Response(BOOTSTRAP, { status: 200 });
    if (String(url).includes("rdap.example.test")) {
      if (rdapDate === null) return new Response("nope", { status: 500 });
      return rdap(rdapDate);
    }
    if (certs === null) return new Response("nope", { status: 503 });
    return crt(certs);
  }) as unknown as typeof fetch;

beforeEach(() => clearHostReputationCache());

describe("host reputation", () => {
  it("reduces a host to its registrable domain", () => {
    expect(baseDomain("api.example.com")).toBe("example.com");
    expect(baseDomain("shop.example.co.uk")).toBe("example.co.uk");
    expect(baseDomain("localhost")).toBeNull();
  });

  it("reports the registration date and the age in days", async () => {
    const now = Date.parse("2026-11-19T00:00:00Z");
    const rep = await checkHostReputation("new-seller.example.com", {
      fetchImpl: fetchFor("2026-11-01T00:00:00Z", ["2026-11-02T00:00:00Z"]),
      now,
    });
    expect(rep.registered_at).toBe("2026-11-01T00:00:00Z");
    expect(rep.domain_age_days).toBe(18);
    expect(rep.domain_age_days! < YOUNG_DOMAIN_DAYS).toBe(true);
    expect(rep.first_certificate_at).toBe("2026-11-02T00:00:00.000Z");
    expect(rep.error).toBeUndefined();
  });

  it("takes the earliest certificate, not the first row", async () => {
    const rep = await checkHostReputation("example.com", {
      fetchImpl: fetchFor("1995-09-12T00:00:00Z", ["2025-01-01T00:00:00Z", "2019-06-01T00:00:00Z"]),
    });
    expect(rep.first_certificate_at?.slice(0, 10)).toBe("2019-06-01");
  });

  it("reports an error rather than a clean answer when a source fails", async () => {
    const rep = await checkHostReputation("example.com", { fetchImpl: fetchFor(null, null) });
    expect(rep.error).toMatch(/RDAP/);
    expect(rep.registered_at).toBeNull();
  });

  it("does not cache a partial answer", async () => {
    let calls = 0;
    const failing = (async (url: string) => {
      if (String(url).includes("iana.org")) return new Response(BOOTSTRAP, { status: 200 });
      calls += 1;
      return new Response("nope", { status: 500 });
    }) as unknown as typeof fetch;
    await checkHostReputation("example.com", { fetchImpl: failing });
    const afterFirst = calls;
    await checkHostReputation("example.com", { fetchImpl: failing });
    expect(calls).toBeGreaterThan(afterFirst);
  });

  it("caches a complete answer and says so", async () => {
    const counting = (async (url: string) => {
      if (String(url).includes("iana.org")) return new Response(BOOTSTRAP, { status: 200 });
      return String(url).includes("rdap.example.test") ? rdap("2020-01-01T00:00:00Z") : crt(["2020-01-02T00:00:00Z"]);
    }) as unknown as typeof fetch;
    const first = await checkHostReputation("example.com", { fetchImpl: counting, now: 1_000 });
    const second = await checkHostReputation("example.com", { fetchImpl: counting, now: 2_000 });
    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.registered_at).toBe(first.registered_at);
  });
});

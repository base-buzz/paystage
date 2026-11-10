import { describe, expect, it } from "vitest";
import { withFallbackSupported, withStaticSupported, supportedSource } from "../src/facilitator-cache.js";

const staticOk = { kinds: [{ x402Version: 2, network: "eip155:8453", scheme: "exact" }] };

describe("withFallbackSupported", () => {
  it("uses the facilitator answer when it arrives in time", async () => {
    const wrapped = withFallbackSupported(
      { getSupported: async () => staticOk },
      { network: "eip155:8453", scheme: "exact" },
    );
    expect(await wrapped.getSupported()).toEqual(staticOk);
    expect(supportedSource()).toBe("facilitator");
  });

  it("falls back to a static answer when discovery hangs", async () => {
    const wrapped = withFallbackSupported(
      { getSupported: () => new Promise(() => {}) },
      { network: "eip155:8453", scheme: "exact", timeoutMs: 30 },
    );
    const answer = (await wrapped.getSupported()) as { kinds: Array<Record<string, unknown>> };
    expect(answer.kinds[0]).toEqual({ x402Version: 2, network: "eip155:8453", scheme: "exact" });
    expect(supportedSource()).toBe("static-fallback");
  });

  it("falls back when discovery throws", async () => {
    const wrapped = withFallbackSupported(
      { getSupported: async () => { throw new Error("facilitator down"); } },
      { network: "eip155:8453", scheme: "exact", timeoutMs: 50 },
    );
    const answer = (await wrapped.getSupported()) as { kinds: unknown[] };
    expect(answer.kinds).toHaveLength(1);
    expect(supportedSource()).toBe("static-fallback");
  });

  it("delegates other methods unchanged", () => {
    const client = {
      prefix: "x",
      getSupported: async () => staticOk,
      describe(this: { prefix: string }) {
        return `c-${this.prefix}`;
      },
    };
    const wrapped = withFallbackSupported(client, { network: "eip155:8453", scheme: "exact" });
    expect((wrapped as typeof client).describe()).toBe("c-x");
  });
});

describe("withStaticSupported", () => {
  it("answers without calling the facilitator", async () => {
    let called = 0;
    const client = {
      getSupported: async () => {
        called += 1;
        throw new Error("should not be called");
      },
      verify: async () => ({ ok: true }),
      settle: async () => ({ ok: true }),
    };
    const wrapped = withStaticSupported(client, { network: "eip155:8453", scheme: "exact" });
    const answer = (await wrapped.getSupported()) as { kinds: Array<Record<string, unknown>> };
    expect(answer.kinds[0]).toEqual({ x402Version: 2, network: "eip155:8453", scheme: "exact" });
    expect(called).toBe(0);
  });

  it("still delegates verify and settle to the real client", async () => {
    const client = {
      getSupported: async () => ({ kinds: [] }),
      verify: async () => ({ verified: true }),
      settle: async () => ({ settled: true }),
    };
    const wrapped = withStaticSupported(client, { network: "eip155:8453", scheme: "exact" });
    expect(await (wrapped as typeof client).verify()).toEqual({ verified: true });
    expect(await (wrapped as typeof client).settle()).toEqual({ settled: true });
  });
});

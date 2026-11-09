import { describe, expect, it } from "vitest";
import { withFallbackSupported, supportedSource } from "../src/facilitator-cache.js";

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

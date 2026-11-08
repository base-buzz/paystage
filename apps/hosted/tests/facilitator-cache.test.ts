import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import { withSupportedCache, supportedCacheStats } from "../src/facilitator-cache.js";

/** Minimal in-memory stand-in for `caches.default`. */
function installCache() {
  const store = new Map<string, Response>();
  const fake = {
    async match(key: string) {
      const hit = store.get(String(key));
      return hit === undefined ? undefined : hit.clone();
    },
    async put(key: string, response: Response) {
      store.set(String(key), response.clone());
    },
  };
  (globalThis as { caches?: unknown }).caches = { default: fake };
  return store;
}

describe("withSupportedCache", () => {
  beforeEach(() => {
    supportedCacheStats.hits = 0;
    supportedCacheStats.misses = 0;
    supportedCacheStats.errors = 0;
  });

  afterEach(() => {
    delete (globalThis as { caches?: unknown }).caches;
  });

  it("passes the first call through and serves the second from cache", async () => {
    installCache();
    const getSupported = vi.fn().mockResolvedValue({ kinds: [{ x402Version: 2, network: "eip155:8453" }] });
    const wrapped = withSupportedCache({ getSupported });

    const first = await wrapped.getSupported();
    const second = await wrapped.getSupported();

    expect(first).toEqual(second);
    expect(getSupported).toHaveBeenCalledTimes(1);
    expect(supportedCacheStats.misses).toBe(1);
    expect(supportedCacheStats.hits).toBe(1);
  });

  it("delegates other methods and keeps their receiver", async () => {
    installCache();
    const client = {
      prefix: "x",
      getSupported: async () => ({ kinds: [] }),
      describe(this: { prefix: string }) {
        return `client-${this.prefix}`;
      },
    };
    const wrapped = withSupportedCache(client);
    expect((wrapped as typeof client).describe()).toBe("client-x");
  });

  it("falls through to the facilitator when no cache exists", async () => {
    const getSupported = vi.fn().mockResolvedValue({ kinds: [] });
    const wrapped = withSupportedCache({ getSupported });
    await wrapped.getSupported();
    await wrapped.getSupported();
    expect(getSupported).toHaveBeenCalledTimes(2);
    expect(supportedCacheStats.hits).toBe(0);
  });

  it("never fails a request because the cache failed", async () => {
    (globalThis as { caches?: unknown }).caches = {
      default: {
        async match() {
          throw new Error("cache down");
        },
        async put() {
          throw new Error("cache down");
        },
      },
    };
    const getSupported = vi.fn().mockResolvedValue({ kinds: [{ x402Version: 2, network: "eip155:8453" }] });
    const wrapped = withSupportedCache({ getSupported });
    await expect(wrapped.getSupported()).resolves.toEqual({
      kinds: [{ x402Version: 2, network: "eip155:8453" }],
    });
    expect(supportedCacheStats.errors).toBeGreaterThan(0);
  });

  it("returns the client unchanged when it has no getSupported", () => {
    const client = { verify: async () => ({}) };
    expect(withSupportedCache(client)).toBe(client);
  });
});

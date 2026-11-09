/**
 * Cache the facilitator's `getSupported()` answer.
 *
 * Why: the x402 middleware calls `getSupported()` during initialization, which
 * happens on a cold isolate. That is a network round trip to Coinbase, measured at
 * ~220 ms, and it sits on the request path — so a burst of requests to a fresh
 * isolate either pays 0.25 s or, when the facilitator rate-limits, backs off long
 * enough that our 5 s guard turns the request into a 503 instead of a 402
 * challenge (documented in SLO.md, 2026-11-09).
 *
 * How: the Workers Cache API, which needs no binding and persists per colo across
 * isolate restarts. First request per colo still pays the round trip; the next ten
 * minutes of requests do not.
 *
 * Deliberately not KV: KV would need a namespace provisioned (an operator step),
 * and the value is small, short-lived and colo-relevant, which is exactly what the
 * Cache API is for.
 *
 * Failure behaviour: any cache problem falls through to the real facilitator. A
 * cache is an optimisation; it must never be able to fail a request.
 */

const CACHE_URL = "https://paystage.internal/x402/facilitator/supported";
const TTL_SECONDS = 600;

type CacheLike = {
  match(request: string | Request): Promise<Response | undefined>;
  put(request: string | Request, response: Response): Promise<void>;
};

function cache(): CacheLike | undefined {
  try {
    // `caches.default` exists in the Workers runtime, not in Node/vitest.
    const c = (globalThis as { caches?: { default?: CacheLike } }).caches;
    return c?.default;
  } catch {
    return undefined;
  }
}

export interface SupportedCacheStats {
  hits: number;
  misses: number;
  errors: number;
}

export const supportedCacheStats: SupportedCacheStats = { hits: 0, misses: 0, errors: 0 };

/**
 * Wrap a facilitator client so `getSupported()` is served from the edge cache when
 * possible. Every other method is passed straight through, bound to the original
 * client so `this` survives.
 */
export function withSupportedCache<T extends object>(client: T): T {
  const getSupported = (client as { getSupported?: () => Promise<unknown> }).getSupported;
  if (typeof getSupported !== "function") return client;

  const wrapped = {
    getSupported: async () => {
      const c = cache();
      if (c === undefined) return getSupported.call(client);

      try {
        const hit = await c.match(CACHE_URL);
        if (hit !== undefined) {
          supportedCacheStats.hits += 1;
          return await hit.json();
        }
      } catch {
        supportedCacheStats.errors += 1;
      }

      const value = await getSupported.call(client);
      supportedCacheStats.misses += 1;
      try {
        await c.put(
          CACHE_URL,
          new Response(JSON.stringify(value), {
            headers: { "content-type": "application/json", "cache-control": `max-age=${TTL_SECONDS}` },
          }),
        );
      } catch {
        supportedCacheStats.errors += 1;
      }
      return value;
    },
  };

  // Everything else delegates unchanged, including `this` for methods that use it.
  return new Proxy(client as object, {
    get(target, prop, receiver) {
      if (prop === "getSupported") return wrapped.getSupported;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  }) as T;
}


/**
 * Never let facilitator discovery decide whether we can serve a challenge.
 *
 * Measured 2026-11-09: the CDP facilitator stopped answering `getSupported()` in
 * under five seconds, so the 5 s request guard turned every mainnet call into
 * `503 upstream_timeout` — including unpaid challenge requests, which need no
 * facilitator at all. Sepolia, using a different facilitator, stayed at 100% 402s,
 * which isolated the cause.
 *
 * A challenge only needs the network and scheme we already know from config. So
 * discovery now races a short deadline and falls back to that static answer. If the
 * facilitator is healthy we still use its real list; if it is slow or down we serve
 * challenges and let settlement fail where it genuinely cannot proceed.
 *
 * Deliberately not a silent stub: `supportedSource()` reports which answer won, so
 * the health endpoint and the conformance kit can tell a fallback from the truth.
 */

export type SupportedSource = "facilitator" | "static-fallback" | "facilitator-cached";

let lastSource: SupportedSource | null = null;

export function supportedSource(): SupportedSource | null {
  return lastSource;
}

export interface StaticSupportedOptions {
  network: string;
  scheme: string;
  timeoutMs?: number;
}

export function withFallbackSupported<T extends object>(
  client: T,
  options: StaticSupportedOptions,
): T {
  const getSupported = (client as { getSupported?: () => Promise<unknown> }).getSupported;
  if (typeof getSupported !== "function") return client;

  const timeoutMs = options.timeoutMs ?? 2500;
  const staticAnswer = () => ({
    kinds: [{ x402Version: 2, network: options.network, scheme: options.scheme }],
  });

  const wrapped = {
    getSupported: async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), timeoutMs);
      });
      try {
        const answer = await Promise.race([getSupported.call(client) as Promise<unknown>, deadline]);
        if (answer !== null) {
          lastSource = "facilitator";
          return answer;
        }
        lastSource = "static-fallback";
        return staticAnswer();
      } catch {
        // A thrown discovery is the same situation as a slow one.
        lastSource = "static-fallback";
        return staticAnswer();
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    },
  };

  return new Proxy(client as object, {
    get(target, prop, receiver) {
      if (prop === "getSupported") return wrapped.getSupported;
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, prop, value) {
      return Reflect.set(target, prop, value, target);
    },
  }) as T;
}

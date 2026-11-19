/**
 * A second opinion on a payee, from a public address-risk feed.
 *
 * Why it is here: our own deny list is 25 curated addresses, and a wallet can be a drainer without being on it. GoPlus answers
 * without an API key with a set of boolean flags (cybercrime, phishing, money laundering, sanctioned, …) and — verified
 * 2026-11-16 — it disagrees with our list in both directions, which is the argument for composing sources rather than
 * choosing one.
 *
 * Three rules shape the implementation, each of which is a way this goes wrong:
 *
 *  - **Hosted only.** The local evaluator must work offline; adding a network call there would make a refusal depend on a
 *    third party. This module is imported by the Worker, never by `@paystage/preflight`.
 *  - **Fail closed, and say which way it failed.** An outage, a timeout or a malformed body must not turn into `pay`. The
 *    caller moves the verdict to `review` and the reason names the check that could not be completed.
 *  - **Attributed and cached.** Every refusal names the source, because "blocked by an API" is not an answer anyone can
 *    dispute, and the same address is not fetched twice within the TTL.
 */

export type AddressRisk = {
  address: string;
  /** Flags the feed set to "1", in a stable order. Empty means the feed knows nothing bad. */
  flagged: string[];
  /** Whether this answer came from the feed just now or from the cache. */
  cached: boolean;
  /** Set when the feed could not be consulted; callers must not treat that as "clean". */
  error?: string;
};

const FEED = "https://api.gopluslabs.io/api/v1/address_security";
const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 1_000;
const TIMEOUT_MS = 2_500;

/** The flags we act on. GoPlus returns ~20; these are the ones that mean "do not pay this". */
export const BLOCKING_FLAGS = [
  "sanctioned",
  "money_laundering",
  "cybercrime",
  "phishing_activities",
  "stealing_attack",
  "financial_crime",
  "blacklist_doubt",
  "darkweb_transactions",
  "blackmail_activities",
] as const;

const cache = new Map<string, { at: number; risk: AddressRisk }>();

/** Exported for tests: the cache is module state, and a test that cannot clear it is not a test. */
export function clearAddressRiskCache(): void {
  cache.clear();
}

const isAddress = (value: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(value);

export async function checkAddressRisk(
  address: string,
  options: { fetchImpl?: typeof fetch; now?: number; chainId?: string } = {},
): Promise<AddressRisk> {
  const normalised = address.toLowerCase();
  const now = options.now ?? Date.now();

  if (!isAddress(normalised)) {
    return { address: normalised, flagged: [], cached: false, error: "not an EVM address" };
  }

  const hit = cache.get(normalised);
  if (hit && now - hit.at < TTL_MS) {
    return { ...hit.risk, cached: true };
  }

  const doFetch = options.fetchImpl ?? fetch;
  const chainId = options.chainId ?? "8453";
  try {
    const res = await doFetch(`${FEED}/${normalised}?chain_id=${chainId}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = (await res.json()) as { result?: Record<string, string> };
    const result = body.result ?? {};
    const flagged = BLOCKING_FLAGS.filter((flag) => result[flag] === "1");
    const risk: AddressRisk = { address: normalised, flagged, cached: false };
    if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
    cache.set(normalised, { at: now, risk });
    return risk;
  } catch (error) {
    // Deliberately not cached: a transient failure should be retried by the next call, not remembered for ten minutes.
    return {
      address: normalised,
      flagged: [],
      cached: false,
      error: String(error).slice(0, 120),
    };
  }
}

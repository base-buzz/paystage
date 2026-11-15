import { parsePolicy } from "@paystage/policy";

/**
 * Parse each distinct policy once per isolate.
 *
 * Policy parsing is Zod validation over a document that typically arrives unchanged on every call —
 * an agent loop sends the same policy a hundred times. Workers keep no state between requests, but a
 * module-level map survives inside one isolate, which is exactly the window that matters: a burst from
 * one caller hits the same isolate.
 *
 * The key is the serialised policy itself, not a hash. Hashing costs about as much as the validation
 * we are avoiding, and a collision here would hand a caller a different policy than the one it sent —
 * the one failure this must never have.
 *
 * Bounded, because an unbounded map keyed by caller-supplied documents is a memory leak with a friendly
 * name. Beyond the cap the oldest entry is dropped; parsing again is the correct fallback.
 */
const MAX_ENTRIES = 64;
const cache = new Map<string, ReturnType<typeof parsePolicy>>();

/** Exposed for tests: how many policies are currently held. */
export function cacheSize(): number {
  return cache.size;
}

/** Exposed for tests: drop everything (an isolate restart does this naturally). */
export function cacheClear(): void {
  cache.clear();
}

export function parsePolicyCached(input: unknown) {
  let key: string;
  try {
    key = JSON.stringify(input) ?? "";
  } catch {
    // Unserialisable input cannot be cached; let the parser produce the real error.
    return parsePolicy(input as never);
  }

  const hit = cache.get(key);
  if (hit !== undefined) {
    // Refresh recency so a hot policy is not evicted by a stream of one-offs.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }

  const parsed = parsePolicy(input as never);
  cache.set(key, parsed);
  if (cache.size > MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return parsed;
}

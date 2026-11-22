/**
 * #370: the Circle on-chain state check, as a pure decision over the generated state rows.
 *
 * The corpus carries `{ address, state, since, blockNumber }` per address. The rule the evaluator applies is one line —
 * refuse only an address whose latest event is `blacklisted` — and it lives here rather than inline in `evaluate.ts` so a
 * test can run it against a fixture state list without a chain, a network call, or a rewrite of the generated file.
 *
 * `state: "unblacklisted"` is not "absent": the address was frozen and Circle later lifted it, and the refusal must stop.
 * The entry is returned so the transcript can say which event is current instead of calling it a non-match.
 */
import type { CircleBlacklistEntryState, CircleBlacklistState } from "./circle-blacklist-addresses.js";

export interface CircleBlacklistVerdict {
  /** True only for `state === "blacklisted"` — the single condition that refuses a payee. */
  refused: boolean;
  /** The latest-event row for this payee, or null when the covered range contains no event for it. */
  entry: CircleBlacklistState | null;
  state: CircleBlacklistEntryState | "none";
}

/** Case-insensitive lookup against the generated state rows; the corpus stores lowercased addresses. */
export function circleBlacklistVerdict(
  states: readonly CircleBlacklistState[],
  payee: string,
): CircleBlacklistVerdict {
  const wanted = String(payee).toLowerCase();
  const entry = states.find((row) => row.address.toLowerCase() === wanted) ?? null;
  return {
    refused: entry?.state === "blacklisted",
    entry,
    state: entry?.state ?? "none",
  };
}

/** A Map for the hot path in `evaluate.ts`; built once from the compiled-in corpus. */
export function circleBlacklistStateMap(
  states: readonly CircleBlacklistState[],
): ReadonlyMap<string, CircleBlacklistState> {
  return new Map(states.map((row) => [row.address.toLowerCase(), row]));
}

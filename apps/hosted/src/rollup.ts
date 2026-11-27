/**
 * The org-unit roll-up (#471): totals for a unit **and its descendants**, in integer minor units.
 *
 * ## What is attributable, and what is not
 *
 * `public.mandates` carries `org_unit` after the migration; `public.events` carries no mandate serial.
 * That is the central fact of this file. A settled payment row says `amount_usdc` and `payer`, but there
 * is no column that says *which mandate* authorised it, and no column that says which unit. Joining on
 * `payer`/`agent` would be a guess dressed as an allocation — the same guess #474 refused for cost
 * centres — so this roll-up does **not** make it.
 *
 * Therefore:
 *
 *  - **mandate counts and the descendant list are real**, read from `mandates.org_unit`;
 *  - when events carry no `mandate_serial`, `spend_minor` and `refusals` are `0` **with an explicit
 *    `spend_unavailable_reason` / `refusals_unavailable_reason`**. Zero is the only number that cannot
 *    be mistaken for a measured total, and the reason names the missing join;
 *  - when a future deployment adds `events.mandate_serial`, the same endpoint starts computing spend
 *    and refusals without a contract change. The store reports availability per read, so the two modes
 *    are distinguishable rather than one silently becoming the other.
 *
 * ## Exactly once
 *
 * The failure mode this endpoint must not have is double counting a child. The aggregation walks the
 * mandates **once**, maps each mandate serial to exactly one unit, and then walks the event rows **once**,
 * counting each `event.id` at most once. It never sums "the parent's direct spend" and then "each child's
 * spend" as separate queries over overlapping rows, which is where a subtree total usually doubles.
 *
 * ## Money
 *
 * `amount_usdc` is a whole-USDC decimal string (`numeric(18,6)`). It is parsed into **micro-USDC** with
 * `BigInt` and every sum is `BigInt`; a float never touches an amount. Only `settled` on Base mainnet
 * (`eip155:8453`) is spend — testnet USDC and refusals are not money. This mirrors the accrual (#474),
 * so a finance export and a division total cannot disagree about what a settled payment is.
 */

import {
  effectiveUnit,
  isInSubtree,
  tenantOfUnit,
} from "./org-unit.js";

/** The only currency the protocol settles in here. */
export const ROLLUP_CURRENCY = "USDC";
/** The only network whose settled payments are money. Base mainnet. */
export const PRODUCTION_NETWORK = "eip155:8453";
/** Six decimals, because `amount_usdc` is `numeric(18,6)`. */
export const MINOR_UNIT_SCALE = 6;
const MINOR_UNITS_PER_USDC = 1_000_000n;

/** The reason the endpoint gives instead of a spend number when events carry no mandate serial. */
export const SPEND_UNAVAILABLE_NO_MANDATE_SERIAL =
  "events carries no mandate serial: public.events has no mandate_serial column, so a settled payment cannot be joined to a mandate or to an org unit. spend_minor is 0 because it is not computable, not because no money moved.";

/** The same gap for refusals: a `do_not_pay` row cannot name the mandate or unit it protected. */
export const REFUSALS_UNAVAILABLE_NO_MANDATE_SERIAL =
  "events carries no mandate serial: public.events has no mandate_serial column, so a refusal cannot be joined to a mandate or to an org unit. refusals is 0 because it is not computable, not because the control never fired.";

export interface RollupMandateRow {
  serial: string;
  org_unit?: string | null;
  state?: string;
}

/** The event columns the roll-up uses when a deployment has the attribution column. */
export interface RollupEventRow {
  id: string;
  mandate_serial: string;
  decision: string;
  /** PostgREST is asked for `amount_usdc::text`, so this is the exact decimal string. */
  amount_usdc: string | null;
  network: string | null;
}

export type RollupEventRead =
  | { available: true; rows: RollupEventRow[] }
  | { available: false; reason: string };

export interface RollupSnapshot {
  /** The tenant's mandates, already scoped by the store. */
  mandates: RollupMandateRow[];
  /** Whether `org_unit` existed at read time; absent means every row is the tenant root. */
  orgUnitColumnPresent: boolean;
  events: RollupEventRead;
}

export interface RollupUnitTotal {
  unit: string;
  mandates: number;
  spend_minor: number;
}

export interface RollupBody {
  unit: string;
  spend_minor: number;
  spend_currency: string;
  refusals: number;
  mandates: number;
  descendants: RollupUnitTotal[];
  as_of: string;
  /** Present only when spend could not be computed; its presence is what stops the 0 being read as real. */
  spend_unavailable_reason?: string;
  /** Present only when refusals could not be attributed. */
  refusals_unavailable_reason?: string;
  /** Settled rows in the subtree with no amount. Counted, never priced as zero. */
  spend_unpriced_settled?: number;
}

/**
 * Parse a whole-USDC decimal string into micro-USDC with `BigInt`, or null when it is not a shape this
 * code will price. No float, no rounding, no exponent: `0.002` is exactly `2000n`.
 */
export function decimalToMinor(value: unknown): bigint | null {
  if (typeof value !== "string") return null;
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(value.trim());
  if (match === null) return null;
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(MINOR_UNIT_SCALE, "0");
  return whole * MINOR_UNITS_PER_USDC + BigInt(fraction === "" ? "0" : fraction);
}

/** Render micro-USDC as a decimal string, for humans. Integer division only. */
export function formatMinor(minor: number): string {
  const value = BigInt(minor);
  const whole = value / MINOR_UNITS_PER_USDC;
  const fraction = (value % MINOR_UNITS_PER_USDC).toString().padStart(MINOR_UNIT_SCALE, "0");
  return `${whole}.${fraction}`;
}

/** A number JSON can carry exactly. Above this, the endpoint refuses to emit a total rather than round it. */
function safelyRepresentable(total: bigint): number | null {
  if (total < 0n || total > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(total);
}

/**
 * Aggregate one unit's subtree.
 *
 * `unit` must already be a validated path; the tenant is its first segment, and a mandate whose
 * effective unit belongs to another tenant is ignored so a malformed row cannot leak across trees.
 */
export function buildRollup(
  unit: string,
  snapshot: RollupSnapshot,
  asOf: string = new Date().toISOString(),
): RollupBody {
  const tenantId = tenantOfUnit(unit);

  // serial -> the one unit it contributes to. One entry per mandate, built once.
  const unitBySerial = new Map<string, string>();
  const mandatesByUnit = new Map<string, number>();

  for (const mandate of snapshot.mandates) {
    const resolved = effectiveUnit(mandate.org_unit, tenantId);
    // A row outside this tenant's tree cannot happen through the mint (and the migration's constraint
    // cannot see tenant_id), but a bad row must be ignored rather than counted in the wrong tree.
    if (tenantOfUnit(resolved) !== tenantId) continue;
    if (!isInSubtree(resolved, unit)) continue;
    unitBySerial.set(mandate.serial, resolved);
    mandatesByUnit.set(resolved, (mandatesByUnit.get(resolved) ?? 0) + 1);
  }

  const spendByUnit = new Map<string, bigint>();
  const seenEventIds = new Set<string>();
  let refusals = 0;
  let spendIncomplete = false;
  let unpricedSettled = 0;

  if (snapshot.events.available) {
    for (const event of snapshot.events.rows) {
      // The store pages results; a repeated id is the same decision and must not be summed twice.
      if (seenEventIds.has(event.id)) continue;
      seenEventIds.add(event.id);

      const resolved = unitBySerial.get(event.mandate_serial);
      // An event naming a mandate outside this subtree is not part of the total. An event naming an
      // unknown serial is not attributable at all, so it is not guessed into the nearest unit.
      if (resolved === undefined || !isInSubtree(resolved, unit)) continue;

      if (event.decision === "do_not_pay") {
        refusals += 1;
        continue;
      }
      if (event.decision !== "settled") continue;
      // Testnet settlement is not spend, exactly as in the accrual.
      if (event.network !== PRODUCTION_NETWORK) continue;
      if (event.amount_usdc === null) {
        unpricedSettled += 1;
        continue;
      }
      const minor = decimalToMinor(event.amount_usdc);
      if (minor === null) {
        spendIncomplete = true;
        continue;
      }
      spendByUnit.set(resolved, (spendByUnit.get(resolved) ?? 0n) + minor);
    }
  }

  const spendTotal =
    spendByUnit.size === 0
      ? 0n
      : [...spendByUnit.values()].reduce((sum, value) => sum + value, 0n);
  const spendNumber = safelyRepresentable(spendTotal);

  const spendUsable = snapshot.events.available && spendNumber !== null && !spendIncomplete;
  const descendants: RollupUnitTotal[] = [];
  const units = new Set<string>([...mandatesByUnit.keys(), ...spendByUnit.keys()]);
  for (const child of units) {
    if (child === unit) continue;
    const childSpend = spendByUnit.get(child) ?? 0n;
    const childNumber = safelyRepresentable(childSpend) ?? 0;
    descendants.push({
      unit: child,
      mandates: mandatesByUnit.get(child) ?? 0,
      // A child total is only shown when the parent's total is a complete, attributable sum. Showing
      // per-child figures beside a parent that says "not computed" would reintroduce the number.
      spend_minor: spendUsable ? childNumber : 0,
    });
  }
  descendants.sort((a, b) => a.unit.localeCompare(b.unit));

  const body: RollupBody = {
    unit,
    spend_minor: spendUsable && spendNumber !== null ? spendNumber : 0,
    spend_currency: ROLLUP_CURRENCY,
    refusals: snapshot.events.available ? refusals : 0,
    mandates: [...mandatesByUnit.values()].reduce((sum, value) => sum + value, 0),
    descendants,
    as_of: asOf,
  };

  if (!snapshot.events.available) {
    body.spend_unavailable_reason = snapshot.events.reason;
    body.refusals_unavailable_reason = REFUSALS_UNAVAILABLE_NO_MANDATE_SERIAL;
  } else if (spendIncomplete) {
    body.spend_unavailable_reason =
      "at least one settled payment in this subtree has an amount this endpoint will not price (a negative, an exponent or more than 6 decimals). No partial total is shown.";
  } else if (spendNumber === null) {
    body.spend_unavailable_reason =
      "the subtree total exceeds the largest integer a JSON number can carry exactly. No rounded total is shown.";
  }
  if (unpricedSettled > 0) body.spend_unpriced_settled = unpricedSettled;

  return body;
}

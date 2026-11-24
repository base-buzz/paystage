import type { Policy } from "./types.js";
import {
  createSink,
  parseNode,
  PolicyParseError,
  type Field,
  type Refinement,
  type Schema,
  type SchemaSink,
} from "./guards.js";

export { PolicyParseError } from "./guards.js";
export type { PolicyIssue } from "./guards.js";

/**
 * The policy schema. These are hand-written guards (#181) — the same accepted inputs, rejected
 * inputs, unknown-key stripping and error text as the zod schemas they replace. `guards.ts`
 * explains the engine and why it exists; this file is only the shape of v1.
 *
 * The regexes are the schema: an address is an address because it matches one of them, and the
 * pattern is repeated into the error message, so changing one changes the user-facing text.
 */
const EVM_ADDRESS = /^0x[a-fA-F0-9]{40}$/;
const VM_ADDRESS = /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const NETWORK_ID = /^(eip155:\d+|solana:\*|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/;
const AMOUNT_VALUE = /^\d+(?:\.\d+)?$/;

const evmAddress: Schema = {
  kind: "string",
  pattern: EVM_ADDRESS,
  patternMessage: "Expected a 0x-prefixed Ethereum address",
};

/**
 * A payee or asset address on any chain the evaluator understands.
 *
 * Solana addresses are base58 and case-sensitive; EVM addresses are 0x-prefixed hex and are
 * compared case-insensitively. Accepting both here is what lets one policy name a Solana mint
 * and payee without a second chain module.
 */
const vmAddress: Schema = {
  kind: "string",
  pattern: VM_ADDRESS,
  patternMessage: "Expected a 0x-prefixed Ethereum address or a base58 Solana address",
};

/** CAIP-2 ids the evaluator can match: EVM chains, Solana networks, and `@x402/svm`'s wildcard. */
const networkId: Schema = {
  kind: "string",
  pattern: NETWORK_ID,
  patternMessage: "Expected a network id like eip155:8453 or solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
};

const amountSpec: Schema = {
  kind: "object",
  fields: [
    {
      key: "value",
      schema: {
        kind: "string",
        pattern: AMOUNT_VALUE,
        patternMessage: "Amount value must be a non-negative decimal string",
      },
    },
    { key: "asset", schema: { kind: "string", min: 1 } },
    { key: "decimals", schema: { kind: "number", integer: true, minimum: 0 } },
  ],
};

const asset: Schema = {
  kind: "object",
  fields: [
    { key: "symbol", schema: { kind: "string", min: 1 } },
    { key: "decimals", schema: { kind: "number", integer: true, minimum: 0 } },
    { key: "address", schema: vmAddress },
    /**
     * Optional since #37: an asset can be named by address for any allowed network.
     *
     * USDC is the same contract story on every chain a policy allows, and requiring a policy to repeat the entry per network is
     * how a stale duplicate gets missed. Omitting `network` means "this address, wherever `allowed_networks` permits" — the
     * network allow-list still decides which chains are reachable, so this widens nothing beyond what the operator already
     * listed.
     */
    { key: "network", schema: networkId, optional: true },
  ],
};

const velocityAmount: Schema = {
  kind: "object",
  fields: [
    {
      key: "value",
      schema: {
        kind: "string",
        pattern: AMOUNT_VALUE,
        patternMessage: "Amount value must be a non-negative decimal string",
      },
    },
    { key: "decimals", schema: { kind: "number", integer: true, minimum: 0 } },
    { key: "asset", schema: { kind: "string", min: 1 }, optional: true },
  ],
};

const hour: Schema = { kind: "number", integer: true, minimum: 0, maximum: 23 };
const hourRange: Schema = { kind: "tuple", items: [hour, hour] };

const timeWindow: Schema = {
  kind: "object",
  fields: [
    { key: "allowed_hours_utc", schema: hourRange, optional: true },
    { key: "blocked_hours_utc", schema: hourRange, optional: true },
  ],
  refine: (value, sink) => {
    if ((value.allowed_hours_utc === undefined) === (value.blocked_hours_utc === undefined)) {
      sink.soft({
        code: "custom",
        path: ["time_window"],
        message: "time_window needs exactly one of allowed_hours_utc or blocked_hours_utc",
      });
    }
  },
};

const velocityWindow: Schema = {
  kind: "object",
  fields: [
    {
      key: "window_seconds",
      schema: { kind: "number", integer: true, minimum: 0, minimumInclusive: false },
    },
    { key: "max_count", schema: { kind: "number", integer: true, minimum: 0 }, optional: true },
    { key: "max_amount", schema: velocityAmount, optional: true },
    /**
     * A ceiling per payee inside this window (#39).
     *
     * The aggregate ceiling does not stop one compromised seller address: every payment can be small, spread across the
     * day, and the daily total still looks normal. This bounds a single counterparty instead. Actions without a `payee`
     * are counted toward the aggregate only, because attributing them to a payee would be inventing one.
     */
    { key: "per_payee_max_amount", schema: velocityAmount, optional: true },
  ],
};

const velocity: Schema = {
  kind: "object",
  fields: [{ key: "windows", schema: { kind: "array", element: velocityWindow, min: 1 } }],
};

/**
 * Risk-based friction (#414). Shape only — the evaluator decides which threshold fires and names it.
 *
 * At least one threshold is required: a `step_up` block with no thresholds would be a rule that can never fire,
 * which reads as protection while doing nothing. `answers` is a non-empty list because a step-up answerable only
 * by a human is the outage the design constraint forbids.
 */
const stepUp: Schema = {
  kind: "object",
  fields: [
    { key: "amount_above", schema: amountSpec, optional: true },
    { key: "unknown_payee", schema: { kind: "boolean" }, optional: true },
    { key: "first_payment_from_payer", schema: { kind: "boolean" }, optional: true },
    {
      key: "answers",
      schema: {
        kind: "array",
        element: {
          kind: "enum",
          values: ["pre_signed_allowance", "second_key", "bounded_auto_approve"],
        },
        min: 1,
      },
      optional: true,
    },
  ],
  refine: (value, sink) => {
    if (
      value.amount_above === undefined &&
      value.unknown_payee !== true &&
      value.first_payment_from_payer !== true
    ) {
      sink.soft({
        code: "custom",
        path: ["step_up"],
        message:
          "step_up needs at least one threshold: amount_above, unknown_payee, or first_payment_from_payer",
      });
    }
  },
};

/**
 * Per-agent overlays. Shape is validated here; the *narrowing* rule is enforced in
 * `resolveAgentPolicy`, because it needs the surrounding policy to compare against.
 */
const agentBudget: Schema = {
  kind: "object",
  fields: [
    { key: "max_amount", schema: amountSpec, optional: true },
    { key: "daily_cap", schema: amountSpec, optional: true },
    { key: "allowed_pay_to", schema: { kind: "array", element: vmAddress }, optional: true },
    { key: "allowed_assets", schema: { kind: "array", element: asset }, optional: true },
    { key: "allowed_networks", schema: { kind: "array", element: networkId }, optional: true },
    { key: "unknown_payee", schema: { kind: "enum", values: ["review", "deny"] }, optional: true },
    { key: "require_human_above", schema: amountSpec, optional: true },
    { key: "velocity", schema: velocity, optional: true },
  ],
};

/**
 * Cross-field checks. These exist because each one was a live hole:
 *
 *  - `max_amount.decimals` disagreeing with the asset it caps silently rescales the ceiling.
 *    `{ value: "0.05", decimals: 18 }` against a 6-decimal USDC asset is a 10^12 times larger
 *    cap — a policy that looks correct judges 40,000 USDC as `pay`.
 *  - A `value` with more places than `decimals` used to pass parsing and then throw inside
 *    `evaluatePayment`, i.e. at request time rather than construction time.
 *  - An allowed asset with no cap is uncapped, which is not what "max_amount is the ceiling"
 *    says. Opting in is explicit because guessing intent about money is not our job.
 */
const POLICY_FIELDS: readonly Field[] = [
  { key: "version", schema: { kind: "literal", value: 1 } },
  { key: "max_amount", schema: amountSpec },
  { key: "daily_cap", schema: amountSpec, optional: true },
  { key: "allowed_pay_to", schema: { kind: "array", element: vmAddress, min: 1 } },
  { key: "allowed_assets", schema: { kind: "array", element: asset, min: 1 } },
  /**
   * A policy caps ONE asset by name. Allowing others without saying so is how an uncapped
   * asset slips past a reader who thinks `max_amount` is the ceiling — opt in deliberately.
   */
  { key: "allow_uncapped_assets", schema: { kind: "boolean" }, optional: true },
  { key: "allowed_networks", schema: { kind: "array", element: networkId, min: 1 } },
  {
    key: "max_timeout_seconds",
    schema: { kind: "number", integer: true, minimum: 0, minimumInclusive: false },
  },
  /**
   * When an agent may pay, in UTC.
   *
   * `allowed_hours_utc: [9, 17]` permits 09:00–17:00 UTC; `[22, 6]` wraps midnight. Half-open: [start, end), so a
   * window of [9, 9] is empty rather than all day — an ambiguous rule should refuse, not permit.
   */
  { key: "time_window", schema: timeWindow, optional: true },
  { key: "require_human_above", schema: amountSpec, optional: true },
  { key: "step_up", schema: stepUp, optional: true },
  { key: "unknown_payee", schema: { kind: "enum", values: ["review", "deny"] } },
  {
    key: "max_auth_validity_seconds",
    schema: { kind: "number", integer: true, minimum: 0, minimumInclusive: false },
    optional: true,
  },
  { key: "allowed_spenders", schema: { kind: "array", element: evmAddress }, optional: true },
  { key: "disallow_unlimited_approvals", schema: { kind: "boolean" }, optional: true },
  { key: "velocity", schema: velocity, optional: true },
  { key: "agents", schema: { kind: "record", value: agentBudget }, optional: true },
];

const policyRefine: Refinement = (value, sink: SchemaSink): void => {
  // `allow_uncapped_assets` is part of the schema but is deliberately absent from the exported
  // `Policy` interface (it only affects parsing); keep the public type unchanged.
  const policy = value as unknown as Policy & { allow_uncapped_assets?: boolean };
  const decimalPlaces = (amount: string): number => {
    const dot = amount.indexOf(".");
    return dot === -1 ? 0 : amount.length - dot - 1;
  };

  // 1. The cap's precision must fit the cap's own decimals. This used to parse fine and then
  //    throw inside evaluatePayment — a 400 on a live request instead of a construction error.
  for (const [field, spec] of [
    ["max_amount", policy.max_amount],
    ["daily_cap", policy.daily_cap],
    ["step_up.amount_above", policy.step_up?.amount_above],
  ] as const) {
    if (spec === undefined) continue;
    if (decimalPlaces(spec.value) > spec.decimals) {
      sink.soft({
        code: "custom",
        path: [...field.split("."), "value"],
        message: `${field}.value "${spec.value}" has more decimal places than ${field}.decimals (${spec.decimals})`,
      });
    }
  }

  // 2. The drain. decimals must describe the same unit as the asset the cap names: the same
  //    "0.05" with 18 decimals against a 6-decimal asset is a cap 10^12 times too large.
  const named = policy.allowed_assets.find((entry) => entry.symbol === policy.max_amount.asset);
  if (named !== undefined && named.decimals !== policy.max_amount.decimals) {
    const factor = Math.abs(policy.max_amount.decimals - named.decimals);
    sink.soft({
      code: "custom",
      path: ["max_amount", "decimals"],
      message:
        `max_amount.decimals is ${policy.max_amount.decimals} but asset "${named.symbol}" has ` +
        `${named.decimals} decimals — the cap would be 10^${factor} times ` +
        `${policy.max_amount.decimals > named.decimals ? "too large" : "too small"}`,
    });
  }

  // 3. Duplicate symbols make the checks above ambiguous: `find()` picks the first, and the
  //    uncapped filter matches by symbol, so a second entry with the same ticker and
  //    different decimals was neither capped nor caught. A policy needing two same-ticker
  //    assets can give one of them a distinct symbol.
  // Keyed on symbol AND network. USDC on mainnet and USDC on Sepolia are different assets
  // that legitimately share a ticker — a symbol-only rule rejected valid policies, which CI
  // caught because the local suite ran the previously built schema. The hole needs the same
  // ticker on the SAME chain at a different scale.
  const keys = policy.allowed_assets.map((entry) => `${entry.symbol}@${entry.network}`);
  const duplicates = keys.filter((key, index) => keys.indexOf(key) !== index);
  if (duplicates.length > 0) {
    sink.soft({
      code: "custom",
      path: ["allowed_assets"],
      message:
        `duplicate asset ${[...new Set(duplicates)].map((duplicate) => `"${duplicate}"`).join(", ")} — same ticker on the same chain; ` +
        `rename one if they are genuinely different assets`,
    });
  }

  // 4. An allowed asset with no cap is uncapped, which contradicts "max_amount is the ceiling".
  const uncapped = policy.allowed_assets.filter((entry) => entry.symbol !== policy.max_amount.asset);
  if (uncapped.length > 0 && policy.allow_uncapped_assets !== true) {
    sink.soft({
      code: "custom",
      path: ["allowed_assets"],
      message:
        `allowed_assets includes ${uncapped.map((entry) => `"${entry.symbol}"`).join(", ")}, which no cap covers — ` +
        `max_amount only caps "${policy.max_amount.asset}". Set allow_uncapped_assets: true if that is intended`,
    });
  }
};

const POLICY: Schema = { kind: "object", fields: POLICY_FIELDS, refine: policyRefine };

/**
 * The field map, keyed by name. `@paystage/payment-policy` reads the key set from `shape` to
 * refuse unknown fields; the values are this package's schema nodes and are not consumer API.
 */
export const POLICY_SHAPE: Readonly<Record<string, Schema>> = Object.freeze(
  Object.fromEntries(POLICY_FIELDS.map((field) => [field.key, field.schema])),
);

export interface PolicySchemaApi {
  readonly shape: Readonly<Record<string, Schema>>;
  parse(input: unknown): Policy;
  safeParse(input: unknown):
    | { success: true; data: Policy }
    | { success: false; error: PolicyParseError };
}

export const PolicySchema: PolicySchemaApi = {
  shape: POLICY_SHAPE,
  parse(input: unknown): Policy {
    const sink = createSink();
    const value = parseNode(POLICY, input, [], sink) as Policy;
    if (sink.issues.length > 0) throw new PolicyParseError(sink.issues);
    return value;
  },
  safeParse(input: unknown) {
    try {
      return { success: true, data: PolicySchema.parse(input) };
    } catch (error) {
      if (error instanceof PolicyParseError) return { success: false, error };
      throw error;
    }
  },
};

export type PolicyFromSchema = Policy;

export type ParsedPolicy = Policy;

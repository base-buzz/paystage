import { z } from "zod";
import type { Policy } from "./types.js";

const evmAddressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 0x-prefixed Ethereum address");

/**
 * A payee or asset address on any chain the evaluator understands.
 *
 * Solana addresses are base58 and case-sensitive; EVM addresses are 0x-prefixed hex and are
 * compared case-insensitively. Accepting both here is what lets one policy name a Solana mint
 * and payee without a second chain module.
 */
const vmAddressSchema = z
  .string()
  .regex(
    /^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$/,
    "Expected a 0x-prefixed Ethereum address or a base58 Solana address",
  );

/** CAIP-2 ids the evaluator can match: EVM chains, Solana networks, and `@x402/svm`'s wildcard. */
const networkIdSchema = z
  .string()
  .regex(
    /^(eip155:\d+|solana:\*|solana:[1-9A-HJ-NP-Za-km-z]{32,44})$/,
    "Expected a network id like eip155:8453 or solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  );

const amountSpecSchema = z.object({
  value: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/, "Amount value must be a non-negative decimal string"),
  asset: z.string().min(1),
  decimals: z.number().int().min(0)
});

const assetSchema = z.object({
  symbol: z.string().min(1),
  decimals: z.number().int().min(0),
  address: vmAddressSchema,
  /**
   * Optional since #37: an asset can be named by address for any allowed network.
   *
   * USDC is the same contract story on every chain a policy allows, and requiring a policy to repeat the entry per network is
   * how a stale duplicate gets missed. Omitting `network` means "this address, wherever `allowed_networks` permits" — the
   * network allow-list still decides which chains are reachable, so this widens nothing beyond what the operator already
   * listed.
   */
  network: networkIdSchema.optional()
});


const velocityAmountSchema = z.object({
  value: z
    .string()
    .regex(/^\d+(?:\.\d+)?$/, "Amount value must be a non-negative decimal string"),
  decimals: z.number().int().min(0),
  asset: z.string().min(1).optional(),
});

const timeWindowSchema = z
  .object({
    allowed_hours_utc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).optional(),
    blocked_hours_utc: z.tuple([z.number().int().min(0).max(23), z.number().int().min(0).max(23)]).optional(),
  })
  .refine((w) => (w.allowed_hours_utc === undefined) !== (w.blocked_hours_utc === undefined), {
    message: "time_window needs exactly one of allowed_hours_utc or blocked_hours_utc",
  });

const velocityWindowSchema = z.object({
  window_seconds: z.number().int().positive(),
  max_count: z.number().int().nonnegative().optional(),
  max_amount: velocityAmountSchema.optional(),
  /**
   * A ceiling per payee inside this window (#39).
   *
   * The aggregate ceiling does not stop one compromised seller address: every payment can be small, spread across the
   * day, and the daily total still looks normal. This bounds a single counterparty instead. Actions without a `payee`
   * are counted toward the aggregate only, because attributing them to a payee would be inventing one.
   */
  per_payee_max_amount: velocityAmountSchema.optional(),
});

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
const BasePolicySchema = z.object({
  version: z.literal(1),
  max_amount: amountSpecSchema,
  daily_cap: amountSpecSchema.optional(),
  allowed_pay_to: z.array(vmAddressSchema).min(1),
  allowed_assets: z.array(assetSchema).min(1),
  /**
   * A policy caps ONE asset by name. Allowing others without saying so is how an uncapped
   * asset slips past a reader who thinks `max_amount` is the ceiling — opt in deliberately.
   */
  allow_uncapped_assets: z.boolean().optional(),
  allowed_networks: z.array(networkIdSchema).min(1),
  max_timeout_seconds: z.number().int().positive(),
  /**
   * When an agent may pay, in UTC.
   *
   * `allowed_hours_utc: [9, 17]` permits 09:00–17:00 UTC; `[22, 6]` wraps midnight. Half-open: [start, end), so a
   * window of [9, 9] is empty rather than all day — an ambiguous rule should refuse, not permit.
   */
  time_window: timeWindowSchema.optional(),
  require_human_above: amountSpecSchema.optional(),
  unknown_payee: z.enum(["review", "deny"]),
  max_auth_validity_seconds: z.number().int().positive().optional(),
  allowed_spenders: z.array(evmAddressSchema).optional(),
  disallow_unlimited_approvals: z.boolean().optional(),
  velocity: z
    .object({ windows: z.array(velocityWindowSchema).min(1) })
    .optional(),
  /**
   * Per-agent overlays. Shape is validated here; the *narrowing* rule is enforced in
   * `resolveAgentPolicy`, because it needs the surrounding policy to compare against.
   */
  agents: z
    .record(
      z.string().min(1),
      z.object({
        max_amount: amountSpecSchema.optional(),
        daily_cap: amountSpecSchema.optional(),
        allowed_pay_to: z.array(vmAddressSchema).optional(),
        allowed_assets: z.array(assetSchema).optional(),
        allowed_networks: z.array(networkIdSchema).optional(),
        unknown_payee: z.enum(["review", "deny"]).optional(),
        require_human_above: amountSpecSchema.optional(),
        velocity: z.object({ windows: z.array(velocityWindowSchema).min(1) }).optional(),
      }),
    )
    .optional()
});


export const PolicySchema = BasePolicySchema.superRefine((p, ctx) => {
  const places = (value: string): number => {
    const dot = value.indexOf(".");
    return dot === -1 ? 0 : value.length - dot - 1;
  };

  // 1. The cap's precision must fit the cap's own decimals. This used to parse fine and then
  //    throw inside evaluatePayment — a 400 on a live request instead of a construction error.
  for (const [field, spec] of [
    ["max_amount", p.max_amount],
    ["daily_cap", p.daily_cap],
  ] as const) {
    if (spec === undefined) continue;
    if (places(spec.value) > spec.decimals) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [field, "value"],
        message: `${field}.value "${spec.value}" has more decimal places than ${field}.decimals (${spec.decimals})`,
      });
    }
  }

  // 2. The drain. decimals must describe the same unit as the asset the cap names: the same
  //    "0.05" with 18 decimals against a 6-decimal asset is a cap 10^12 times too large.
  const named = p.allowed_assets.find((a) => a.symbol === p.max_amount.asset);
  if (named !== undefined && named.decimals !== p.max_amount.decimals) {
    const factor = Math.abs(p.max_amount.decimals - named.decimals);
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["max_amount", "decimals"],
      message:
        `max_amount.decimals is ${p.max_amount.decimals} but asset "${named.symbol}" has ` +
        `${named.decimals} decimals — the cap would be 10^${factor} times ` +
        `${p.max_amount.decimals > named.decimals ? "too large" : "too small"}`,
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
  const keys = p.allowed_assets.map((a) => `${a.symbol}@${a.network}`);
  const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (dupes.length > 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowed_assets"],
      message:
        `duplicate asset ${[...new Set(dupes)].map((d) => `"${d}"`).join(", ")} — same ticker on the same chain; ` +
        `rename one if they are genuinely different assets`,
    });
  }

  // 4. An allowed asset with no cap is uncapped, which contradicts "max_amount is the ceiling".
  const uncapped = p.allowed_assets.filter((a) => a.symbol !== p.max_amount.asset);
  if (uncapped.length > 0 && p.allow_uncapped_assets !== true) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["allowed_assets"],
      message:
        `allowed_assets includes ${uncapped.map((a) => `"${a.symbol}"`).join(", ")}, which no cap covers — ` +
        `max_amount only caps "${p.max_amount.asset}". Set allow_uncapped_assets: true if that is intended`,
    });
  }
});

export type PolicyFromSchema = z.infer<typeof PolicySchema>;

export type ParsedPolicy = Policy;


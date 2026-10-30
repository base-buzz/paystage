import { z } from "zod";

const decimalString = z
  .string()
  .regex(/^-?\d+(\.\d+)?$/, "must be a decimal string");

export const TradePolicySchema = z.object({
  version: z.literal(1),
  allowed_dexes: z.array(z.string()).min(1),
  allowed_assets: z.array(z.string()).min(1),
  max_notional_usdc: decimalString,
  max_leverage: z.number().int().positive(),
  max_abs_funding: decimalString,
  require_review_above_notional_usdc: decimalString.optional(),
  unknown_asset: z.enum(["review", "do_not_trade"]).default("do_not_trade"),
});

export type TradePolicy = z.infer<typeof TradePolicySchema>;

export function parseTradePolicy(input: unknown): TradePolicy {
  return TradePolicySchema.parse(input);
}

export function safeParseTradePolicy(
  input: unknown,
):
  | { success: true; data: TradePolicy }
  | { success: false; error: z.ZodError } {
  return TradePolicySchema.safeParse(input);
}

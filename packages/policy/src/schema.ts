import { z } from "zod";
import type { Policy } from "./types.js";

const addressSchema = z
  .string()
  .regex(/^0x[a-fA-F0-9]{40}$/, "Expected a 0x-prefixed Ethereum address");

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
  address: addressSchema,
  network: z
    .string()
    .regex(/^eip155:\d+$/, "Expected a network id like eip155:8453")
});

export const PolicySchema = z.object({
  version: z.literal(1),
  max_amount: amountSpecSchema,
  daily_cap: amountSpecSchema.optional(),
  allowed_pay_to: z.array(addressSchema).min(1),
  allowed_assets: z.array(assetSchema).min(1),
  allowed_networks: z
    .array(z.string().regex(/^eip155:\d+$/))
    .min(1),
  max_timeout_seconds: z.number().int().positive(),
  require_human_above: amountSpecSchema.optional(),
  unknown_payee: z.enum(["review", "deny"])
});

export type PolicyFromSchema = z.infer<typeof PolicySchema>;

export type ParsedPolicy = Policy;

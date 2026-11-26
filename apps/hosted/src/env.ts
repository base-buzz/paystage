export interface Bindings {
  PAYSTAGE_PAYTO: string;
  PAYSTAGE_PRICE?: string;
  PAYSTAGE_NETWORK?: string;
  // Free tier: a real verdict for a caller with no payment and no account. Default on;
  // set FREE_TIER_ENABLED=false to require payment for every call.
  /** Which build produced a verdict receipt. Unset = receipts say "unknown". */
  PAYSTAGE_SERVICE_VERSION?: string;
  FREE_TIER_ENABLED?: string;
  FREE_TIER_DAILY_LIMIT?: string;
  /** Per-payer daily cap on the paid path. Generous by design: it stops a runaway agent, not a customer. */
  PAID_QUOTA_DAILY_LIMIT?: string;
  PAID_QUOTA_ENABLED?: string;
  FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  /** Testnet faucet (#92). The key is a Wrangler secret; the address is derived from it, never stored. */
  FAUCET_SEPOLIA_KEY?: string;
  SEPOLIA_RPC_URL?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  /** The receipt key set a mandate envelope is verified against (#455). Unset = minting is refused. */
  RECEIPT_SIGNING_KEY_PKCS8?: string;
  RECEIPT_SIGNING_KEY_ID?: string;
  RECEIPT_SIGNING_KEYS_RETIRED?: string;
  /** The service token that may call POST /v1/mandate (#455). Unset = every mint is refused. */
  MANDATE_MINT_TOKEN?: string;
  /** The tenant a minted mandate row belongs to (#455). Deployment config, not a request field. */
  MANDATE_TENANT_ID?: string;
}

export interface Env {
  Bindings: Bindings;
}

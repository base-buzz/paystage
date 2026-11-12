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
  FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface Env {
  Bindings: Bindings;
}

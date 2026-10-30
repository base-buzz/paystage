export interface Bindings {
  PAYSTAGE_PAYTO: string;
  PAYSTAGE_PRICE?: string;
  PAYSTAGE_NETWORK?: string;
  FACILITATOR_URL?: string;
  CDP_API_KEY_ID?: string;
  CDP_API_KEY_SECRET?: string;
}

export interface Env {
  Bindings: Bindings;
}

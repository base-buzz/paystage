export interface Bindings {
  PAYSTAGE_PAYTO: string;
  PAYSTAGE_PRICE?: string;
  PAYSTAGE_NETWORK?: string;
  FACILITATOR_URL?: string;
}

export interface Env {
  Bindings: Bindings;
}

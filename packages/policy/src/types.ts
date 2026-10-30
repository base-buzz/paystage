export type UnknownPayee = "review" | "deny";

export interface AmountSpec {
  value: string;
  asset: string;
  decimals: number;
}

export interface Asset {
  symbol: string;
  decimals: number;
  address: string;
  network: string;
}

export interface Policy {
  version: 1;
  max_amount: AmountSpec;
  daily_cap?: AmountSpec;
  allowed_pay_to: string[];
  allowed_assets: Asset[];
  allowed_networks: string[];
  max_timeout_seconds: number;
  require_human_above?: AmountSpec;
  unknown_payee: UnknownPayee;
}

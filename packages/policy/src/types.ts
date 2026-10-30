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


export interface VelocityAmountSpec {
  value: string;
  decimals: number;
  asset?: string;
}

export interface VelocityWindow {
  /** Rolling window length in seconds (e.g. 300, 1800, 18000). */
  window_seconds: number;
  /** Max number of transactions allowed in the window. */
  max_count?: number;
  /** Max aggregate amount allowed in the window. */
  max_amount?: VelocityAmountSpec;
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
  max_auth_validity_seconds?: number;
  allowed_spenders?: string[];
  disallow_unlimited_approvals?: boolean;
  /** Optional rolling-window rate and spend-pattern limits. */
  velocity?: { windows: VelocityWindow[] };
}


export type AuthKind = "erc20_allowance" | "permit2" | "eip3009";

export interface AuthItem {
  kind: AuthKind;
  token: string;
  owner: string;
  spender: string;
  amount: bigint;
  network: string;
  expirationSeconds?: number;
  nonce?: string;
  raw?: unknown;
}

export type AuthFlag =
  | "unlimited"
  | "unknown_spender"
  | "stale"
  | "expired";

export interface EvaluateAuthResult {
  item: AuthItem;
  flags: AuthFlag[];
  summary: "ok" | "review" | "revoke_recommended";
}

export interface ScanInput {
  owner: string;
  network: string;
  tokens?: string[];
  spenders?: string[];
}

import type { VelocityWindow } from "@paystage/policy";

export type { VelocityWindow };

/**
 * A single payment action considered by the velocity checker.
 * `amount_atomic` is the amount in atomic units (e.g. USDC 6 decimals).
 */
export interface VelocityAction {
  id?: string;
  timestamp_ms: number;
  amount_atomic: bigint;
  asset?: string;
}

export type VelocityDecision = "allow" | "deny";

export interface VelocityWindowResult {
  window_seconds: number;
  count: number;
  amount_atomic: bigint;
  max_count?: number;
  max_amount_atomic?: bigint;
  count_ok: boolean;
  amount_ok: boolean;
  passed: boolean;
}

export interface VelocityResult {
  decision: VelocityDecision;
  reasons: string[];
  windows_checked: VelocityWindowResult[];
}

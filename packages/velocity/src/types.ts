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
  /**
   * The address this payment goes to, when known.
   *
   * Per-payee limits are the ones that stop a single compromised seller address from draining a daily cap: the aggregate
   * ceiling never fires, because every individual payment is small and spread across the day.
   */
  payee?: string;
}

export type VelocityDecision = "allow" | "deny";

export interface VelocityWindowResult {
  window_seconds: number;
  count: number;
  amount_atomic: bigint;
  max_count?: number;
  max_amount_atomic?: bigint;
  /** Largest single payee's total inside this window, when the window sets a per-payee cap. */
  payee_amount_atomic?: bigint;
  per_payee_max_amount_atomic?: bigint;
  payee_ok?: boolean;
  count_ok: boolean;
  amount_ok: boolean;
  passed: boolean;
}

export interface VelocityResult {
  decision: VelocityDecision;
  reasons: string[];
  windows_checked: VelocityWindowResult[];
}

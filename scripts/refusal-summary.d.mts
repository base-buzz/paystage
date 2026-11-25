/**
 * Types for `refusal-summary.mjs` (#433), so the hosted vitest suite can import the pure functions
 * without turning the script into a workspace package. The implementation stays a plain `.mjs`
 * because that is how every other report script in `scripts/` runs.
 */

export interface RefusalRecord {
  at: string;
  decision: "pay" | "review" | "do_not_pay";
  rule: string;
  payee: string | null;
  amountAtomic: string | null;
  asset: string | null;
  assetSymbol: string | null;
  decimals: number | null;
  serial: string | null;
  policySha256: string | null;
  hasReceipt: boolean;
  hasPayment: boolean;
}

export interface ByRule {
  rule: string;
  count: number;
}

export interface ByPayee {
  payee: string;
  count: number;
  amount_total: string;
}

export interface RefusalReport {
  period: { from: string; to: string };
  refusals: number;
  reviews: number;
  by_rule: ByRule[];
  by_payee: ByPayee[];
  amounts: { total: string; median: string | null; asset: string | null };
  previous_period_delta: { refusals: number; pct: number | null };
  without_payment: number;
  without_receipt: number;
}

export interface RefusalArgs {
  days: number;
  serial: string | null;
  policy: string | null;
  json: boolean;
  exampleOut: string | null;
  help: boolean;
}

export class MissingField extends Error {
  readonly field: string;
  constructor(field: string, detail?: string);
}

export function parseArgs(argv: string[]): RefusalArgs;
export function windowFor(now: Date | string | number, days: number): { from: string; to: string };
export function recordFromBundle(row: unknown): RefusalRecord;
export function formatAtomic(atomic: string | bigint, decimals: number): string;
export function medianAtomic(values: Array<string | bigint>, decimals: number): string | null;
export function summarize(records: RefusalRecord[], window: { from: string; to: string }): RefusalReport;
export function redactSerial(serial: string | null): string | null;
export function humanLine(report: RefusalReport, mandateLabel?: string): string;
export function readBundles(options: {
  from: string;
  to: string;
  fetchImpl?: typeof fetch;
}): Promise<unknown[]>;
export function main(
  argv?: string[],
  options?: { now?: Date; fetchImpl?: typeof fetch },
): Promise<number>;

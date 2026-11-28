import snapshot from "./payments-incoming.generated.json";

/**
 * The committed output of `bin/payments-incoming.mjs`, read by `/pricing`.
 *
 * The page does not hold a number: it formats the snapshot. Regenerating the snapshot is the only way the
 * sentence changes, and `apps/console/tests/payments-incoming.test.ts` fails when the published counts drift
 * without the test being updated deliberately.
 */
export type Bucket = "ours" | "external" | "unknown";

export type KnownPayer = {
  address: string;
  label: string;
  role: string;
  retired?: boolean;
  source: string;
};

export type IncomingTransfer = {
  tx: string;
  block: number;
  logIndex: number;
  at: string;
  payer: string | null;
  bucket: Bucket;
  oursLabel: string | null;
  amountAtomic: string | null;
  amountUsdc: string | null;
};

export type IncomingSnapshot = {
  schema: string;
  generatedAt: string;
  network: string;
  asset: { symbol: string; address: string; decimals: number };
  payTo: string;
  window: { days: number; start: string; end: string; label: string; fromBlock: number; toBlock: number };
  counts: { transfers: number; ours: number; external: number; unknown: number; distinctPayers: number };
  totals: { amountAtomic: string; amountUsdc: string };
  lastExternal: { date: string; at: string; tx: string; payer: string | null } | null;
  knownPayers: KnownPayer[];
  knownPayersSource: string;
  payers: Array<{
    payer: string | null;
    bucket: Bucket;
    label: string | null;
    transfers: number;
    amountAtomic: string;
    amountUsdc: string;
    firstAt: string;
    lastAt: string;
  }>;
  transfers: IncomingTransfer[];
};

export const INCOMING = snapshot as unknown as IncomingSnapshot;

const BUCKETS = new Set<Bucket>(["ours", "external", "unknown"]);
const ADDRESS_RE = /^0x[0-9a-f]{40}$/i;

/** The exact sentence the pricing page publishes. One function, so the page and its test cannot drift. */
export function formatSentence(data: IncomingSnapshot = INCOMING): string {
  const count = data.counts.transfers;
  const noun = count === 1 ? "transfer" : "transfers";
  const last = data.lastExternal?.date ?? "none";
  return `${count} ${noun} to our payee in the last ${data.window.days} days: ${data.counts.ours} ours, ${data.counts.external} external, ${data.counts.unknown} unknown. Last external payment: ${last}.`;
}

/**
 * Throw if any transfer is not classified exactly once against the published list.
 *
 * `unknown` is a legitimate bucket for a transfer whose log carries no readable payer; it is not a licence to
 * leave a readable payer out. A payer on the list must be ours, a readable payer off it must be external, and a
 * payer with no readable address must be unknown.
 */
export function assertClassified(data: IncomingSnapshot = INCOMING): void {
  const ours = new Set(data.knownPayers.map((entry) => entry.address.toLowerCase()));
  if (data.counts.transfers !== data.transfers.length) {
    throw new Error(`counts.transfers ${data.counts.transfers} does not match ${data.transfers.length} rows`);
  }
  for (const [index, transfer] of data.transfers.entries()) {
    const where = `transfers[${index}] ${transfer.tx ?? "(no tx)"}`;
    if (!BUCKETS.has(transfer.bucket)) throw new Error(`${where}: unclassified bucket ${JSON.stringify(transfer.bucket)}`);
    if (transfer.payer === null) {
      if (transfer.bucket !== "unknown") throw new Error(`${where}: no payer but bucket ${transfer.bucket}`);
      continue;
    }
    if (!ADDRESS_RE.test(transfer.payer)) throw new Error(`${where}: payer is not an address: ${transfer.payer}`);
    const expected = ours.has(transfer.payer.toLowerCase()) ? "ours" : "external";
    if (transfer.bucket !== expected) throw new Error(`${where}: payer ${transfer.payer} is ${expected}, snapshot says ${transfer.bucket}`);
  }
}

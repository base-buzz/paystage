/**
 * The two demand measurements on `/lab`, each with the definition that makes it readable (#375).
 *
 * The walked number comes from our own `eth_getLogs` scan of payees: direct USDC transfers to the catalogue's payees in
 * a fixed block window. The Bazaar number comes from Bazaar's own per-resource counter, sampled over the first five
 * pages of its discovery endpoint. They measure different things over different windows, so this module never combines
 * them: no ratio, no share, no trend line. It only supplies the figures and the words each one must carry.
 *
 * The Bazaar snapshot is generated (`scripts/gen-bazaar-demand.mjs`) from the collector's state file. The collector's
 * `note` is the label, rendered from the generated JSON rather than retyped in JSX — a sampled counter without its
 * sampling rule is a guess, and a call count without "not revenue" is the claim this row exists to avoid.
 */
import generated from "@/lib/bazaar-demand.generated.json";
import { DEMAND_METHOD, formatCount, type DemandView } from "@/lib/market-demand";

export interface BazaarDemandSnapshot {
  measuredAt: string;
  sampledFrom: string;
  pagesRead: number;
  resources: number;
  withCounters: number;
  totalCalls30d: number;
  uniquePayers30d: number;
  medianCalls30d: number | null;
  /** The collector's label. The page renders this string; it must never be retyped in the component. */
  note: string;
}

/** The committed snapshot, generated from the ops collector's state file by `scripts/gen-bazaar-demand.mjs`. */
export const BAZAAR_DEMAND: BazaarDemandSnapshot = generated;

/**
 * The catalogue is ~40k entries. That size is not in the collector's JSON — the collector states it in its own header
 * and the backlog records 40,157 listed entries (#377) — so it is carried here as a description of the population, not
 * as a measurement of it. Everything that can come from the snapshot (`resources`, `pagesRead`) does.
 */
export const BAZAAR_CATALOGUE_APPROXIMATE = "~40k";

/** The counter field is a 30-day window; the name is part of the definition, not a separate claim. */
export const BAZAAR_COUNTER_WINDOW_DAYS = 30;

const PAGE_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];

function pageWord(pages: number): string {
  return Number.isInteger(pages) && pages >= 0 && pages < PAGE_WORDS.length ? PAGE_WORDS[pages]! : String(pages);
}

/**
 * The Bazaar definition: what was summed, over which sample, in whose order.
 *
 * The sample size and the page count are read from the generated snapshot, so a collector run that reads a different
 * number of pages changes this sentence with the data. The catalogue size is the one constant, labelled as approximate.
 */
export function bazaarSampleDefinition(snapshot: BazaarDemandSnapshot): string {
  return `l30DaysTotalCalls summed over a ${formatCount(snapshot.resources)}-resource sample of a ${BAZAAR_CATALOGUE_APPROXIMATE} catalogue, first ${pageWord(snapshot.pagesRead)} pages in the API's own order.`;
}

/** The walked definition: our `eth_getLogs` window and the settlement the walk cannot see. */
export function walkedDemandDefinition(snapshot: { windowBlocks: number; runDate: string }): string {
  return `Payee transfers our own eth_getLogs walk over the catalogue's payees observed in a ${formatCount(snapshot.windowBlocks)}-block window (run ${snapshot.runDate}); the walk reads ${DEMAND_METHOD}.`;
}

/**
 * What the walked side shows, including why it shows nothing.
 *
 * A failed or absent read is never a zero: it gets an explanation and an em dash, so the Bazaar counter can still
 * render beside it without the missing half looking like an empty market.
 */
export function walkedDemandFigure(view: DemandView): { value: number | null; detail: string } {
  if (view.kind === "unreadable") {
    return {
      value: null,
      detail: `The walked demand row could not be read (${view.reason}), so there is no walked number on this side — a failed read is not a zero.`,
    };
  }
  if (view.kind === "none") {
    return {
      value: null,
      detail: "No walked demand row is stored yet, so there is no walked number on this side — an absent row is not a zero.",
    };
  }
  return { value: view.snapshot.payeeTransfers, detail: walkedDemandDefinition(view.snapshot) };
}

/**
 * The sentence under the two columns. It names both windows and refuses the two joins a reader might expect.
 *
 * Returned rather than inlined so the refusal is asserted in tests: a ratio between a block-window transfer count and a
 * sampled 30-day call count is a number about nothing, and a line joining them would invent a movement neither source
 * measured.
 */
export function bazaarComparisonNotice(walkedBlocks: number | null): string {
  const walk = walkedBlocks === null ? "a walk whose window cannot be read" : `a ${formatCount(walkedBlocks)}-block walk`;
  return `These are two different measurements: ${walk} and ${BAZAAR_COUNTER_WINDOW_DAYS}-day call counters. They are shown side by side, not as a ratio or a trend, and neither is revenue.`;
}

/** A whole-number count for the counter; a non-finite value renders as an em dash, never as zero. */
export function formatBazaarCalls(value: number): string {
  return Number.isFinite(value) ? formatCount(value) : "—";
}

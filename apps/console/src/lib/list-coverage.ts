/**
 * The derivation behind `/lists` (#363): coverage against a denominator, freshness chips, source shares,
 * retrieval-growth points and the refresh strip.
 *
 * Every figure the page prints comes from `lists.generated.ts`, and this module turns those figures into the
 * shapes the page renders. It is pure on purpose — no `Date.now()`, no network, no React — so the thresholds
 * (7 days, 45 days) and the "one sample is not a line" rule are testable rather than re-implemented in JSX.
 *
 * The distinction the page must not lose: an entry count without a denominator reads as completeness, and a
 * freshness chip on a list that has no upstream feed is a fabricated signal. Both have explicit branches here,
 * including the one that says "no denominator" instead of borrowing a number.
 */

/** Green under a week, amber under the 45-day window, red at or beyond it. */
export const FRESH_DAYS = 7;
export const STALE_DAYS = 45;

export type FreshnessTone = "green" | "amber" | "red";

export interface FreshnessInput {
  /** The publisher's own last change (or last-modified) date, when this list has a feed. */
  upstreamChangedAt: string | null;
  /** Why that date is the right one; printed beside the chip so the basis is not guessed. */
  basis: "last-change" | "last-modified" | "first-fetch" | "last-event" | "collection" | "review" | "none";
  /** A curation review date, for lists with no upstream feed. */
  reviewedAt: string | null;
  /** False for curated lists (drainers, sinks) which have no publisher feed to watch. */
  hasUpstreamFeed: boolean;
}

export type FreshnessView =
  | {
      kind: "chip";
      tone: FreshnessTone;
      days: number;
      at: string;
      basis: FreshnessInput["basis"];
      label: string;
    }
  | {
      kind: "reviewed";
      reviewedAt: string | null;
      label: string;
    };

/** Whole days between two dates. Future dates clamp to zero rather than reading as negative staleness. */
export function ageInDays(at: string, now: Date | number | string): number {
  const then = Date.parse(at);
  const current = now instanceof Date ? now.getTime() : typeof now === "number" ? now : Date.parse(now);
  if (!Number.isFinite(then) || !Number.isFinite(current)) return Number.NaN;
  return Math.max(0, Math.floor((current - then) / 86_400_000));
}

/** The chip rule: `< 7` green, `< 45` amber, `>= 45` red. Exported so the page and tests share it. */
export function freshnessTone(days: number): FreshnessTone {
  if (days < FRESH_DAYS) return "green";
  if (days < STALE_DAYS) return "amber";
  return "red";
}

function shortDate(at: string): string {
  return Number.isFinite(Date.parse(at)) ? at.slice(0, 10) : at;
}

/**
 * A chip when there is a real upstream change date; otherwise the review sentence.
 *
 * A curated list has no publisher feed. Printing "20 days old" beside it would imply a feed that does not
 * exist, so the page says when it was last reviewed and that there is no upstream feed instead.
 */
export function freshnessView(list: FreshnessInput, now: Date | number | string): FreshnessView {
  if (!list.hasUpstreamFeed) {
    return {
      kind: "reviewed",
      reviewedAt: list.reviewedAt,
      label: list.reviewedAt
        ? `reviewed ${shortDate(list.reviewedAt)}, no upstream feed`
        : "no upstream feed, no review date recorded",
    };
  }

  if (!list.upstreamChangedAt) {
    return {
      kind: "reviewed",
      reviewedAt: list.reviewedAt,
      label: list.reviewedAt
        ? `reviewed ${shortDate(list.reviewedAt)}, no upstream change date`
        : "no upstream change date recorded",
    };
  }

  const days = ageInDays(list.upstreamChangedAt, now);
  if (!Number.isFinite(days)) {
    return {
      kind: "reviewed",
      reviewedAt: null,
      label: "upstream date unreadable, no chip",
    };
  }

  return {
    kind: "chip",
    tone: freshnessTone(days),
    days,
    at: list.upstreamChangedAt,
    basis: list.basis,
    label: days === 0 ? "today" : `${days}d`,
  };
}

export interface AddressList {
  id: string;
  label: string;
  addresses: readonly string[];
}

export interface ListCoverageEntry {
  id: string;
  label: string;
  /** Entries as published by this list, before cross-list deduplication. */
  count: number;
  /** Entries this list contributes that no earlier list already contributed. */
  uniqueContribution: number;
  /** Ids of earlier lists this one overlaps with. */
  overlapsWith: string[];
}

export interface Coverage {
  /** Unique addresses across every list, lowercased. The bar's numerator. */
  numerator: number;
  /** Sum of the list sizes before deduplication. */
  rawTotal: number;
  /** `rawTotal - numerator`; the number removed by cross-list dedupe. */
  duplicatesRemoved: number;
  perList: ListCoverageEntry[];
  /** Catalogue payees. Null when the catalogue row is missing — never a guessed denominator. */
  denominator: number | null;
  /** 0–1, or null with no denominator. */
  ratio: number | null;
  /** 0–100, or null with no denominator. Not rounded, so callers choose the precision. */
  percent: number | null;
  dedupedAcrossLists: boolean;
}

/**
 * Coverage numerator and denominator.
 *
 * The numerator deduplicates across lists: an address Circle froze and OFAC also published is one screened
 * address, not two. The page states that it dedupes and how many were removed, because summing the list
 * counts is the easier, flattering number.
 */
export function buildCoverage(lists: readonly AddressList[], denominator: number | null): Coverage {
  const seen = new Map<string, string>();
  const perList: ListCoverageEntry[] = [];
  let rawTotal = 0;

  for (const list of lists) {
    const unique = new Set(list.addresses.map((address) => address.toLowerCase()));
    rawTotal += unique.size;
    const overlaps = new Set<string>();
    let uniqueContribution = 0;
    for (const address of unique) {
      const owner = seen.get(address);
      if (owner) overlaps.add(owner);
      else {
        seen.set(address, list.id);
        uniqueContribution += 1;
      }
    }
    perList.push({
      id: list.id,
      label: list.label,
      count: unique.size,
      uniqueContribution,
      overlapsWith: [...overlaps],
    });
  }

  const numerator = seen.size;
  const validDenominator = denominator !== null && Number.isFinite(denominator) && denominator > 0 ? denominator : null;
  const ratio = validDenominator === null ? null : numerator / validDenominator;

  return {
    numerator,
    rawTotal,
    duplicatesRemoved: rawTotal - numerator,
    perList,
    denominator: validDenominator,
    ratio,
    percent: ratio === null ? null : ratio * 100,
    dedupedAcrossLists: true,
  };
}

export interface SourceCount {
  name: string;
  url?: string | null;
  count: number;
}

export interface SourceShare extends SourceCount {
  percent: number;
}

export interface SourceBar {
  slices: SourceShare[];
  /** Sources with a non-zero count. */
  contributing: number;
  total: number;
  singleSource: boolean;
}

/**
 * A stacked bar's shares. A single-publisher list gets one 100% slice, which is the point: it is visibly
 * single-source rather than a bar that merely happens to be one colour.
 */
export function sourceBar(sources: readonly SourceCount[]): SourceBar {
  const positive = sources.filter((source) => source.count > 0);
  const total = positive.reduce((sum, source) => sum + source.count, 0);
  return {
    slices: total === 0 ? [] : positive.map((source) => ({ ...source, percent: (source.count / total) * 100 })),
    contributing: positive.length,
    total,
    singleSource: positive.length === 1,
  };
}

export interface RetrievalSample {
  at: string;
  count: number;
}

export interface GrowthSeries {
  /** Ascending by retrieval date; a sample with an unreadable date is dropped rather than placed at zero. */
  points: RetrievalSample[];
  oneSample: boolean;
  /** The page draws a line only from two points. One point is a count, not a trend. */
  drawLine: boolean;
  first: RetrievalSample | null;
  last: RetrievalSample | null;
  delta: number | null;
}

/** Growth from retrieval dates already stored. One sample renders as a count, never as a flat line. */
export function buildGrowth(samples: readonly RetrievalSample[]): GrowthSeries {
  const points = samples
    .filter((sample) => Number.isFinite(Date.parse(sample.at)) && Number.isFinite(sample.count))
    .slice()
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const first = points[0] ?? null;
  const last = points[points.length - 1] ?? null;
  return {
    points,
    oneSample: points.length === 1,
    drawLine: points.length >= 2,
    first,
    last,
    delta: points.length >= 2 && first && last ? last.count - first.count : null,
  };
}

/** The sentence beside the sparkline, so a single sample cannot be mistaken for growth. */
export function growthLabel(series: GrowthSeries, fallbackCount: number): string {
  if (series.points.length === 0) return `${fallbackCount} entries · no retrieval sample recorded`;
  if (series.oneSample && series.last) return `${series.last.count} entries · one sample (${shortDate(series.last.at)})`;
  if (series.first && series.last && series.delta !== null) {
    const sign = series.delta >= 0 ? "+" : "";
    return `${series.last.count} entries · ${sign}${series.delta} over ${series.points.length} samples`;
  }
  return `${fallbackCount} entries`;
}

/** Normalised 0–100 points for an inline sparkline. Empty when there is nothing to draw. */
export function sparklinePoints(series: GrowthSeries, width = 100, height = 28): string {
  if (!series.drawLine || !series.first || series.last === null) return "";
  const min = Math.min(...series.points.map((point) => point.count));
  const max = Math.max(...series.points.map((point) => point.count));
  const span = max - min || 1;
  const start = Date.parse(series.first.at);
  const end = Date.parse(series.last.at) || start + 1;
  return series.points
    .map((point) => {
      const x = ((Date.parse(point.at) - start) / (end - start || 1)) * width;
      const y = height - ((point.count - min) / span) * (height - 2) - 1;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
}

export type RefreshStatus = "ok" | "failed" | "unknown";

export interface RefreshInfo {
  command: string;
  where: string;
  lastRunAt: string | null;
  status: RefreshStatus;
  lastResult: string;
}

/**
 * The refresh strip's result sentence. `failed` is explicit, and `unknown` is not silently reported as a
 * success: a state file that records only successful fetches cannot prove the last run passed.
 */
export function refreshLine(refresh: RefreshInfo): string {
  if (refresh.status === "failed") {
    return `last run failed — ${refresh.lastResult}`;
  }
  if (refresh.status === "unknown") {
    return `no last result recorded — ${refresh.lastResult}`;
  }
  return refresh.lastRunAt ? `last result (${shortDate(refresh.lastRunAt)}): ${refresh.lastResult}` : `last result: ${refresh.lastResult}`;
}

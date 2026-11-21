import { describe, expect, it } from "vitest";
import {
  DEMAND_METHOD,
  STALE_AFTER_HOURS,
  buildDemandView,
  controlNotice,
  coverageDetail,
  formatCount,
  formatCoverage,
  formatUsdc,
  selectDemandRow,
  staleNotice,
  storedMethodLabel,
  type DemandSources,
  type DemandView,
  type MarketDemandRow,
  type MarketSupplyRow,
} from "@/lib/market-demand";

/**
 * The demand panel's data selection (#320).
 *
 * These are the four ways a daily row can lie to a reader, each tested as a pure function so the page's JSX cannot
 * decide them by accident: the wrong day, a zero from a broken filter, a ratio with no denominator, and a row
 * that is no longer about today.
 */

const NOW = Date.parse("2026-11-21T19:02:15Z");
const CREATED_AT = "2026-11-21T17:45:10.754621+00:00";

const demandRow: MarketDemandRow = {
  run_date: "2026-11-21",
  window_blocks: 2000,
  chain_usdc_transfers: 16483,
  payee_transfers: 68,
  payee_transfers_value_usdc: 2.213012,
  distinct_payees_paid: 4,
  distinct_payers: 5,
  repeat_payers: 3,
  payees_listed: 1324,
  sampled_payees: 857,
  size_p50_usdc: 0.01,
  size_p90_usdc: 0.05,
  method: "direct USDC ERC-20 transfers to sampled payees; batched/channel settlement not visible",
  control_topic_filter: true,
  control_address: "0x7284d41b5b852f2bd4c99bdf95043d84452d299c",
  likely_test_payers: 5,
  created_at: CREATED_AT,
};

const supplyRow: MarketSupplyRow = { run_date: "2026-11-21", payees: 1324 };

function build(
  overrides: {
    demand?: MarketDemandRow[];
    demandFailure?: string;
    supply?: MarketSupplyRow[];
    supplyFailure?: string;
  } = {},
  now = NOW,
): DemandView {
  const sources: DemandSources = {
    demand: overrides.demandFailure
      ? { ok: false, reason: overrides.demandFailure }
      : { ok: true, rows: overrides.demand ?? [demandRow] },
    supply: overrides.supplyFailure
      ? { ok: false, reason: overrides.supplyFailure }
      : { ok: true, rows: overrides.supply ?? [supplyRow] },
  };
  return buildDemandView(sources, now);
}

function ready(view: DemandView) {
  if (view.kind !== "ready") throw new Error(`expected ready, got ${view.kind}`);
  return view;
}

describe("selectDemandRow", () => {
  it("selects the newest run_date regardless of array order", () => {
    const older = { ...demandRow, run_date: "2026-11-19" };
    const newest = { ...demandRow, run_date: "2026-11-21" };
    expect(selectDemandRow([older, newest])?.run_date).toBe("2026-11-21");
    expect(selectDemandRow([newest, older])?.run_date).toBe("2026-11-21");
  });

  it("returns nothing when no row carries a date", () => {
    expect(selectDemandRow([{ window_blocks: 2000 }])).toBeNull();
    expect(selectDemandRow([])).toBeNull();
  });
});

describe("the coverage ratio", () => {
  it("divides distinct_payees_paid by market_supply.payees for the same date", () => {
    const { snapshot } = ready(build());
    expect(snapshot.payeesListed).toBe(1324);
    expect(snapshot.coverage).toBeCloseTo(4 / 1324, 10);
    expect(formatCoverage(snapshot.coverage)).toBe("0.30%");
    expect(snapshot.runDate).toBe("2026-11-21");
  });

  it("uses the catalogue's payee count, not market_demand.payees_listed", () => {
    // The row's own copy of the denominator is deliberately wrong here: the ratio must come from the catalogue.
    const { snapshot } = ready(build({ demand: [{ ...demandRow, payees_listed: 999 }], supply: [{ run_date: "2026-11-21", payees: 1324 }] }));
    expect(snapshot.payeesListed).toBe(1324);
    expect(snapshot.coverage).toBeCloseTo(4 / 1324, 10);
  });

  it("says coverage has no denominator when the catalogue has no row for that date", () => {
    const { snapshot } = ready(build({ supply: [{ run_date: "2026-11-20", payees: 1226 }] }));
    expect(snapshot.coverage).toBeNull();
    expect(snapshot.payeesListed).toBeNull();
    expect(snapshot.coverageUnavailable).toContain("no catalogue row exists for 2026-11-21");
    expect(formatCoverage(snapshot.coverage)).toBe("—");
  });

  it("says coverage is unreadable when the catalogue read failed", () => {
    const { snapshot } = ready(build({ supplyFailure: "the database could not be reached" }));
    expect(snapshot.coverage).toBeNull();
    expect(snapshot.coverageUnavailable).toContain("could not be read");
    expect(snapshot.coverageUnavailable).toContain("no denominator");
  });

  it("prints the numerator and denominator beside the ratio, with the sample the numerator covers", () => {
    const { snapshot } = ready(build());
    expect(coverageDetail(snapshot)).toBe("4 of 1,324 listed payees paid; we watched the 857 busiest Base payees");
  });
});

describe("staleness", () => {
  it("marks a row older than 36 hours stale and reports its age", () => {
    const view = ready(build({}, Date.parse(CREATED_AT) + (STALE_AFTER_HOURS + 1) * 3_600_000));
    expect(view.stale?.ageHours).toBe(37);
    expect(view.stale?.basis).toBe("created_at");
    expect(staleNotice(view.stale!)).toContain("Stale");
    expect(staleNotice(view.stale!)).toContain("37.0 hours");
    expect(staleNotice(view.stale!)).toContain("not today's");
  });

  it("does not mark a row younger than 36 hours stale", () => {
    const view = ready(build({}, Date.parse(CREATED_AT) + (STALE_AFTER_HOURS - 1) * 3_600_000));
    expect(view.stale).toBeNull();
  });

  it("treats exactly 36 hours as current, because the threshold is older-than", () => {
    const view = ready(build({}, Date.parse(CREATED_AT) + STALE_AFTER_HOURS * 3_600_000));
    expect(view.stale).toBeNull();
  });

  it("falls back to run_date when the writer stored no created_at", () => {
    const view = ready(
      build({ demand: [{ ...demandRow, created_at: null }] }, Date.parse("2026-11-23T00:00:00Z")),
    );
    expect(view.stale?.basis).toBe("run_date");
    expect(view.stale?.ageHours).toBe(48);
    expect(staleNotice(view.stale!)).toContain("dated 2026-11-21 00:00 UTC");
  });
});

describe("the zero-versus-broken-query control", () => {
  it("renders a failed control as failed and says a zero that day means nothing", () => {
    const view = ready(build({ demand: [{ ...demandRow, control_topic_filter: false }] }));
    expect(view.snapshot.control.status).toBe("failed");
    const notice = controlNotice(view.snapshot.control, view.snapshot.chainUsdcTransfers);
    expect(notice).toContain("did not match its own control");
    expect(notice).toContain("a zero that day means nothing");
    expect(notice).toContain("16,483 USDC transfers");
  });

  it("does not treat a missing control as passed", () => {
    const view = ready(build({ demand: [{ ...demandRow, control_topic_filter: null }] }));
    expect(view.snapshot.control.status).toBe("not-run");
    expect(controlNotice(view.snapshot.control, view.snapshot.chainUsdcTransfers)).toContain(
      "cannot be told apart from a broken address filter",
    );
  });

  it("calls a passing control's zero a real zero", () => {
    const view = ready(build({ demand: [{ ...demandRow, payee_transfers: 0, distinct_payees_paid: 0 }] }));
    expect(view.snapshot.control.status).toBe("passed");
    expect(view.snapshot.payeeTransfers).toBe(0);
    expect(formatCoverage(view.snapshot.coverage)).toBe("0.00%");
    expect(controlNotice(view.snapshot.control, view.snapshot.chainUsdcTransfers)).toContain("would be a real zero");
  });
});

describe("no row and failed reads", () => {
  it("returns none rather than zeroes when no demand row exists", () => {
    expect(build({ demand: [] })).toEqual({ kind: "none" });
  });

  it("surfaces a failed read as unreadable, not as no row", () => {
    const view = build({ demandFailure: "the database could not be reached" });
    expect(view.kind).toBe("unreadable");
    if (view.kind !== "unreadable") return;
    expect(view.reason).toContain("could not be reached");
  });

  it("refuses a malformed row instead of rendering NaN", () => {
    const view = build({ demand: [{ ...demandRow, chain_usdc_transfers: null }] });
    expect(view.kind).toBe("unreadable");
    if (view.kind !== "unreadable") return;
    expect(view.reason).toContain("missing required fields");
  });
});

describe("the method line and null-safe formatting", () => {
  it("always exposes the mandated method sentence", () => {
    expect(DEMAND_METHOD).toBe("direct USDC transfers; batched or channel settlement is not visible");
  });

  it("keeps the collector's own wording beside the mandated sentence", () => {
    const { snapshot } = ready(build());
    expect(snapshot.storedMethod).toContain("sampled payees");
    expect(storedMethodLabel(snapshot.storedMethod)).toContain("sampled payees");
    expect(storedMethodLabel(DEMAND_METHOD)).toBeNull();
  });

  it("renders a missing size as unavailable, never as zero", () => {
    expect(formatUsdc(null)).toBe("—");
    expect(formatUsdc(0.01)).toBe("0.01 USDC");
    expect(formatCount(16483)).toBe("16,483");
  });
});

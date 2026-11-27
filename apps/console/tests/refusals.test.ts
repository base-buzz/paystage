import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { RefusalsView } from "@/components/RefusalsView";
import {
  buildRefusalView,
  expandReasonCodes,
  formatRange,
  REFUSAL_CONTROL_LINE,
  type RefusalRow,
} from "@/lib/refusals";

const NOW = new Date("2026-11-27T20:00:00Z");

/**
 * The fixture is the data the view reads.
 *
 * It deliberately covers every `reason_codes` shape seen in practice — array, JSON string, comma list,
 * empty — and both payer states. The assertions below are the arithmetic the page promises: the total is
 * the number of in-window rows, the rule table decomposes it, the payer table decomposes it, and neither
 * invents a label.
 */
const ROWS: RefusalRow[] = [
  {
    id: "1",
    ts: "2026-11-27T10:00:00Z",
    source: "real",
    payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
    caller_provenance: "own-loadgen",
    reason_codes: ["cap:$50", "allowlist"],
  },
  {
    id: "2",
    ts: "2026-11-26T09:00:00Z",
    source: "test",
    payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
    caller_provenance: "unknown",
    reason_codes: '["cap:$50"]',
  },
  {
    id: "3",
    ts: "2026-11-25T08:00:00Z",
    source: "real",
    payer: null,
    caller_provenance: "own-probe",
    reason_codes: "cap:$50, velocity",
  },
  {
    id: "4",
    ts: "2026-11-24T07:00:00Z",
    source: "test",
    payer: "0x73fb4a47f3afae0649f640e11a466bf89ad8def9",
    caller_provenance: "unknown",
    reason_codes: null,
  },
  // Outside the window: must not be counted.
  {
    id: "5",
    ts: "2026-11-01T00:00:00Z",
    source: "real",
    payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
    caller_provenance: "unknown",
    reason_codes: ["cap:$50"],
  },
  // Unparseable timestamp: excluded rather than assigned to the window.
  { id: "6", ts: "not-a-date", source: "real", payer: null, reason_codes: ["cap:$50"] },
];

describe("reason_codes expansion", () => {
  it("handles arrays, JSON strings, comma lists, Postgres literals and empty values", () => {
    expect(expandReasonCodes(["a", "b", "a"])).toEqual(["a", "b"]);
    expect(expandReasonCodes('["a","b"]')).toEqual(["a", "b"]);
    expect(expandReasonCodes("a, b ; c")).toEqual(["a", "b", "c"]);
    expect(expandReasonCodes("{a,b}")).toEqual(["a", "b"]);
    expect(expandReasonCodes("")).toEqual([]);
    expect(expandReasonCodes(null)).toEqual([]);
    expect(expandReasonCodes(undefined)).toEqual([]);
    expect(expandReasonCodes([["a"], '["b"]'])).toEqual(["a", "b"]);
  });
});

describe("the refusal view", () => {
  const view = buildRefusalView(ROWS, { now: NOW, days: 7 });

  it("counts exactly the rows inside the window", () => {
    expect(view.total).toBe(4);
    expect(view.windowStart).toBe("2026-11-20T20:00:00.000Z");
    expect(view.windowEnd).toBe("2026-11-27T20:00:00.000Z");
    expect(view.firstRefusal).toBe("2026-11-24T07:00:00Z");
    expect(view.lastRefusal).toBe("2026-11-27T10:00:00Z");
    expect(view.windowEnd).toBe(NOW.toISOString());
    expect(formatRange(view)).toContain("2026-11-24");
  });

  it("decomposes the total by rule without inventing one", () => {
    expect(view.rules).toEqual([
      { label: "cap:$50", count: 3 },
      { label: "allowlist", count: 1 },
      { label: "not recorded", count: 1 },
      { label: "velocity", count: 1 },
    ]);
    expect(view.ruleTotal).toBe(6); // two rules on row 1, two on row 3
    expect(view.rulesNotRecorded).toBe(1);
    expect(view.rules.reduce((sum, row) => sum + row.count, 0)).toBe(view.ruleTotal);
  });

  it("decomposes the total by payer and states the cardinality", () => {
    expect(view.distinctPayers).toBe(2);
    expect(view.payers.reduce((sum, row) => sum + row.count, 0)).toBe(view.total);
    expect(view.payers.find((row) => row.label === "not recorded")?.count).toBe(1);
    // Addresses are masked, never republished whole.
    expect(view.payers.map((row) => row.label).join(" ")).not.toContain("0xc64a71e150cd21ebc4b12695850bed6b067743bc");
    expect(view.payerCaveat).toBeNull();
  });

  it("states provenance from the columns it read", () => {
    expect(view.sources).toEqual([
      { label: "real", count: 2 },
      { label: "test", count: 2 },
    ]);
    expect(view.provenance).toEqual([
      { label: "unknown-agent", count: 2 },
      { label: "dev-loadgen", count: 1 },
      { label: "our-probe", count: 1 },
    ]);
    expect(view.sources.reduce((sum, row) => sum + row.count, 0)).toBe(view.total);
  });

  it("adds the one-payer caveat when the count is 1", () => {
    const single = buildRefusalView(ROWS.slice(0, 3), { now: NOW, days: 7 });
    expect(single.distinctPayers).toBe(1);
    expect(single.payerCaveat).toContain("One payer accounts for every refusal");
    expect(single.payerCaveat).toContain("placeholder until more payers");
  });

  it("says plainly when no payer is recorded, rather than implying a population", () => {
    const none = buildRefusalView(ROWS.slice(2, 3), { now: NOW, days: 7 });
    expect(none.distinctPayers).toBe(0);
    expect(none.payerCaveat).toContain("cannot name anyone yet");
  });

  it("says nothing was refused when the window is empty", () => {
    const empty = buildRefusalView([], { now: NOW, days: 7 });
    expect(empty.total).toBe(0);
    expect(empty.payerCaveat).toContain("No refusal in this window records a payer");
    expect(empty.ruleCaveat).toBeNull();
  });
});

describe("the refusals page", () => {
  it("server-renders the control line, both tables and provenance with no script", () => {
    const view = buildRefusalView(ROWS, { now: NOW, days: 7 });
    const html = renderToStaticMarkup(createElement(RefusalsView, { view }));
    expect(html).toContain(REFUSAL_CONTROL_LINE);
    expect(html).toContain("refusal is not a failed payment");
    expect(html).toContain("By rule");
    expect(html).toContain("By payer");
    expect(html).toContain("Provenance");
    expect(html).toContain("events.source");
    expect(html).toContain("dev-loadgen");
    expect(html).toContain("our-probe");
    expect(html).toContain("operator-agent");
    expect(html).toContain("unknown-agent");
    expect(html).toContain("not recorded");
    expect(html).toContain(String(view.total));
    expect(html).not.toContain("<script");
  });

  it("renders the cardinality caveat when one payer owns the window", () => {
    const view = buildRefusalView(ROWS.slice(0, 3), { now: NOW, days: 7 });
    const html = renderToStaticMarkup(createElement(RefusalsView, { view }));
    expect(html).toContain("One payer accounts for every refusal");
    expect(html).toContain("placeholder until more payers");
  });
});

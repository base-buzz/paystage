import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  buildDecisionCsv,
  csvCell,
  decisionExportFilename,
  decisionExportHref,
  MAX_EXPORT_DAYS,
  resolveExportRange,
  RULE_NOT_RECORDED,
  type DecisionExportRow,
} from "@/lib/decision-export";
import { buildRefusalView } from "@/lib/refusals";
import { RefusalsView } from "@/components/RefusalsView";

/**
 * #473 — the decisions export.
 *
 * The fixture includes every kind of decision the table holds, because the point of the file is that it
 * keeps all of them: a refusal, a review, a settled payment, a pay, a 402 and a failure. The arithmetic
 * asserted here is deliberately trivial — one row in, one row out — because "only successes" is a
 * filter bug, and a filter is exactly what a test should notice.
 */
const ROWS: DecisionExportRow[] = [
  {
    ts: "2026-11-27T10:00:00.000Z",
    decision: "do_not_pay",
    reason_codes: ["accept.mandate.revoked"],
    payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
    amount_usdc: 0.002,
    pay_to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    tx_hash: null,
    source: "operator-agent",
    tool: "evaluate_mcp_payment",
  },
  {
    ts: "2026-11-27T09:59:00.000Z",
    decision: "do_not_pay",
    reason_codes: null,
    payer: null,
    amount_usdc: null,
    pay_to: null,
    tx_hash: null,
    source: "unknown-agent",
    tool: "evaluate_mcp_payment",
  },
  {
    ts: "2026-11-27T09:58:00.000Z",
    decision: "settled",
    reason_codes: [],
    payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
    amount_usdc: "0.002000",
    pay_to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    tx_hash: "0xabc123",
    source: "dev-loadgen",
    tool: "evaluate_mcp_payment",
  },
  {
    ts: "2026-11-27T09:57:00.000Z",
    decision: "review",
    reason_codes: '["seller host example.test is 3 days old"]',
    payer: null,
    amount_usdc: null,
    pay_to: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    tx_hash: null,
    source: "our-probe",
    tool: "evaluate_mcp_payment",
  },
  {
    ts: "2026-11-27T09:56:00.000Z",
    decision: "402",
    reason_codes: [],
    payer: null,
    amount_usdc: null,
    pay_to: null,
    tx_hash: null,
    source: "real",
    tool: "evaluate_mcp_payment",
  },
  {
    ts: "2026-11-27T09:55:00.000Z",
    decision: "settle_failed",
    reason_codes: [],
    payer: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
    amount_usdc: null,
    pay_to: null,
    tx_hash: null,
    source: "dev-loadgen",
    tool: "evaluate_mcp_payment",
  },
];

describe("the decisions CSV", () => {
  const csv = buildDecisionCsv(ROWS);
  const lines = csv.split("\r\n").filter(Boolean);

  it("has the exact column contract and one row per decision", () => {
    expect(lines[0]).toBe(
      "ts,decision,reason_codes,payer,amount_usdc,pay_to,tx_hash,source,tool",
    );
    expect(lines).toHaveLength(ROWS.length + 1);
    for (const row of ROWS) {
      expect(csv).toContain(row.ts);
      expect(csv).toContain(`,${row.decision},`);
    }
  });

  it("writes an empty reason_codes as `not recorded`, never blank and never a guessed rule", () => {
    expect(csv).toContain(`,${RULE_NOT_RECORDED},`);
    // Four fixture rows have no rule: a do_not_pay with null, a settled with [], a 402 and a failure.
    // All four are written as `not recorded`; none is dropped.
    expect(lines.filter((line) => line.includes(RULE_NOT_RECORDED))).toHaveLength(4);
    // No invented rule text.
    expect(csv).not.toContain("unknown_rule");
  });

  it("prints the named rule when there is one", () => {
    expect(csv).toContain("accept.mandate.revoked");
    expect(csv).toContain("seller host example.test is 3 days old");
  });

  it("quotes a field with a comma, a quote or a newline", () => {
    expect(csvCell('cap:$50, allowlist')).toBe('"cap:$50, allowlist"');
    expect(csvCell('he said "no"')).toBe('"he said ""no"""');
    expect(csvCell("line\nbreak")).toBe('"line\nbreak"');
    expect(csvCell("0xabc")).toBe("0xabc");
    expect(csvCell(null)).toBe("");
  });

  it("names the date range in the filename", () => {
    expect(decisionExportFilename(new Date("2026-11-20T22:00:00Z"), new Date("2026-11-27T22:00:00Z"))).toBe(
      "paystage-decisions-2026-11-20_to_2026-11-27.csv",
    );
  });
});

describe("the export range", () => {
  it("defaults to the page's 7-day window", () => {
    const resolved = resolveExportRange(new URLSearchParams(), new Date("2026-11-27T22:00:00Z"));
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.range.fromDay).toBe("2026-11-20");
    expect(resolved.range.toDay).toBe("2026-11-27");
    expect(resolved.range.filename).toBe("paystage-decisions-2026-11-20_to_2026-11-27.csv");
  });

  it("treats a date-only `to` as the whole day, not midnight", () => {
    const resolved = resolveExportRange(
      new URLSearchParams({ from: "2026-11-01", to: "2026-11-02" }),
      new Date("2026-11-27T22:00:00Z"),
    );
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.range.to).toBe("2026-11-02T23:59:59.999Z");
  });

  it("refuses an inverted, unparseable or oversized range instead of coercing it", () => {
    expect(resolveExportRange(new URLSearchParams({ from: "2026-11-27", to: "2026-11-01" })).ok).toBe(false);
    expect(resolveExportRange(new URLSearchParams({ from: "yesterday" })).ok).toBe(false);
    const tooLong = resolveExportRange(
      new URLSearchParams({ from: "2020-01-01", to: "2026-01-01" }),
      new Date("2026-11-27T22:00:00Z"),
    );
    expect(tooLong.ok).toBe(false);
    expect(tooLong.ok ? "" : tooLong.error).toContain(String(MAX_EXPORT_DAYS));
  });

  it("builds the one-line link from the page's own window", () => {
    expect(decisionExportHref("2026-11-20T22:00:00Z", "2026-11-27T22:00:00Z")).toBe(
      "/lab/refusals/export?from=2026-11-20&to=2026-11-27",
    );
  });
});

describe("the link on the page a manager uses", () => {
  it("renders one line pointing at the export", () => {
    const view = buildRefusalView([], { now: new Date("2026-11-27T20:00:00Z"), days: 7 });
    const html = renderToStaticMarkup(createElement(RefusalsView, { view }));
    expect(html).toContain('href="/lab/refusals/export?from=2026-11-20&amp;to=2026-11-27"');
    expect(html).toContain("Download every decision in this window as CSV");
  });
});

/**
 * The route, with the database replaced by the same seam the page uses.
 *
 * `selectRowsStrict` is mocked rather than the table, so the test asserts the actual query the route
 * would send: no `decision=` filter (the whole point), the inclusive window and the column list.
 */
const { selectRowsStrict } = vi.hoisted(() => ({ selectRowsStrict: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ selectRowsStrict }));

import { GET } from "@/app/lab/refusals/export/route";

describe("GET /lab/refusals/export", () => {
  beforeEach(() => {
    selectRowsStrict.mockReset();
  });

  it("returns an attachment CSV for the range with no decision filter", async () => {
    selectRowsStrict.mockResolvedValueOnce({ ok: true, rows: ROWS });
    const res = await GET(
      new Request("http://localhost/lab/refusals/export?from=2026-11-20&to=2026-11-27"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="paystage-decisions-2026-11-20_to_2026-11-27.csv"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");

    const query = String(selectRowsStrict.mock.calls[0]?.[1]);
    expect(query).toContain(
      "select=id,ts,decision,reason_codes,payer,amount_usdc,pay_to,tx_hash,source,tool",
    );
    expect(query).toContain("order=ts.asc,id.asc");
    expect(query).not.toContain("decision=eq");
    expect(query).toContain("ts=gte.2026-11-20T00%3A00%3A00.000Z");
    expect(query).toContain("ts=lte.2026-11-27T23%3A59%3A59.999Z");
    expect(query).toContain("limit=1000");
    expect(query).toContain("offset=0");

    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe("ts,decision,reason_codes,payer,amount_usdc,pay_to,tx_hash,source,tool");
    expect(body).toContain("do_not_pay");
    expect(body).toContain("settled");
    expect(body).toContain("review");
    expect(body).toContain(RULE_NOT_RECORDED);
  });

  it("pages past PostgREST's 1,000-row cap instead of exporting only the first page", async () => {
    // The bug this pins: `limit=100001` is not a request for 100,001 rows — PostgREST answers with the
    // project's max-rows (1,000), so a one-request export silently stops at the first thousand.
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      ...ROWS[0],
      ts: `2026-11-21T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}.000Z`,
    }));
    selectRowsStrict
      .mockResolvedValueOnce({ ok: true, rows: firstPage })
      .mockResolvedValueOnce({ ok: true, rows: [ROWS[1]] });

    const res = await GET(new Request("http://localhost/lab/refusals/export?from=2026-11-20&to=2026-11-27"));
    expect(res.status).toBe(200);
    expect(selectRowsStrict).toHaveBeenCalledTimes(2);
    expect(String(selectRowsStrict.mock.calls[0]?.[1])).toContain("offset=0");
    expect(String(selectRowsStrict.mock.calls[1]?.[1])).toContain("offset=1000");

    const body = await res.text();
    expect(body.split("\r\n").filter(Boolean)).toHaveLength(1001 + 1);
  });

  it("says the read failed instead of serving an empty CSV", async () => {
    selectRowsStrict.mockResolvedValueOnce({ ok: false, reason: "forbidden", status: 403 });
    const res = await GET(new Request("http://localhost/lab/refusals/export"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body).toContain("could not be read");
    expect(body).toContain("403");
    expect(res.headers.get("content-disposition")).toBeNull();
  });

  it("refuses a bad range with a 400 and no file", async () => {
    const res = await GET(new Request("http://localhost/lab/refusals/export?from=2026-11-27&to=2026-11-01"));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.text()).toContain("`from` is after `to`");
  });
});

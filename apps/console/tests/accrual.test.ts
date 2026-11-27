import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AccrualView } from "@/components/AccrualView";
import { RefusalsView } from "@/components/RefusalsView";
import { buildRefusalView } from "@/lib/refusals";
import {
  ACCRUAL_COLUMNS,
  accrualCsvCell,
  accrualExportHref,
  accrualJsonHref,
  buildAccrual,
  buildAccrualCsv,
  costCentreFor,
  decimalToMinor,
  evidenceHash,
  formatMinor,
  MAX_ACCRUAL_DAYS,
  normalizeCostCentreMap,
  periodOf,
  resolveAccrualRange,
  vendorOf,
  VENDOR_NOT_RECORDED,
  type AccrualDecision,
} from "@/lib/accrual";

const VENDOR_A = "0x1b2272a2ca1792e8497a8d45fd3eb8665ae88fae";
const VENDOR_B = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const MAP = normalizeCostCentreMap({
  default: "unassigned",
  vendors: { [VENDOR_B.toLowerCase()]: "CC-200" },
});

/**
 * The fixture covers every case the aggregation has to answer:
 *
 *  - two months, so the period split is real;
 *  - the same vendor twice in one month, so the count is not the row count;
 *  - two vendors, one of them mapped to a cost centre;
 *  - a settled payment on another network, which must not enter money;
 *  - a settled payment with no amount, which counts and adds 0;
 *  - a refusal with no payee, which is the bucket most refusals land in;
 *  - a decision that is neither settled nor a refusal, which is not part of an accrual.
 */
const ROWS: AccrualDecision[] = [
  {
    id: "a1",
    ts: "2026-11-02T10:00:00Z",
    decision: "settled",
    amount_usdc: "0.002000",
    pay_to: VENDOR_A,
    network: "eip155:8453",
  },
  {
    id: "a2",
    ts: "2026-11-03T11:00:00Z",
    decision: "settled",
    amount_usdc: "0.002",
    pay_to: VENDOR_A.toUpperCase(),
    network: "eip155:8453",
  },
  {
    id: "a3",
    ts: "2026-11-04T12:00:00Z",
    decision: "settled",
    amount_usdc: "0.010000",
    pay_to: VENDOR_B,
    network: "eip155:8453",
  },
  {
    id: "a4",
    ts: "2026-11-05T13:00:00Z",
    decision: "settled",
    amount_usdc: "0.500000",
    pay_to: VENDOR_A,
    network: "eip155:84532",
  },
  {
    id: "a5",
    ts: "2026-11-06T14:00:00Z",
    decision: "settled",
    amount_usdc: null,
    pay_to: null,
    network: "eip155:8453",
  },
  {
    id: "a6",
    ts: "2026-11-07T15:00:00Z",
    decision: "do_not_pay",
    amount_usdc: null,
    pay_to: null,
    network: "eip155:8453",
  },
  {
    id: "a7",
    ts: "2026-12-01T09:00:00Z",
    decision: "settled",
    amount_usdc: "0.003000",
    pay_to: VENDOR_A,
    network: "eip155:8453",
  },
  {
    id: "a8",
    ts: "2026-11-08T16:00:00Z",
    decision: "402",
    amount_usdc: null,
    pay_to: null,
    network: "eip155:8453",
  },
];

describe("integer money", () => {
  it("parses a whole-USDC decimal string into micro-USDC without a float", () => {
    expect(decimalToMinor("0.002")).toBe(2000n);
    expect(decimalToMinor("0.002000")).toBe(2000n);
    expect(decimalToMinor("1")).toBe(1_000_000n);
    expect(decimalToMinor("1.234567")).toBe(1_234_567n);
    expect(decimalToMinor(0.002)).toBe(2000n);
    expect(decimalToMinor(null)).toBeNull();
    expect(decimalToMinor("")).toBeNull();
  });

  it("refuses a seventh decimal place rather than rounding it", () => {
    expect(() => decimalToMinor("0.0000001")).toThrow(/at most 6 places/);
    expect(() => decimalToMinor("1e-7")).toThrow(/at most 6 places/);
    expect(() => decimalToMinor("-0.1")).toThrow(/non-negative/);
    expect(() => decimalToMinor("abc")).toThrow(/non-negative/);
  });

  it("formats micro-USDC back to a string without dividing", () => {
    expect(formatMinor(82000n)).toBe("0.082000");
    expect(formatMinor(1n)).toBe("0.000001");
    expect(formatMinor(0)).toBe("0.000000");
  });
});

describe("vendor and cost centre", () => {
  it("derives the vendor from pay_to, and names the empty case as a bucket", () => {
    expect(vendorOf(VENDOR_B)).toBe(VENDOR_B.toLowerCase());
    expect(vendorOf("  ")).toBe(VENDOR_NOT_RECORDED);
    expect(vendorOf(null)).toBe(VENDOR_NOT_RECORDED);
  });

  it("uses the finance mapping, and `unassigned` when there is no mapping", () => {
    expect(costCentreFor(VENDOR_A, MAP)).toBe("unassigned");
    expect(costCentreFor(VENDOR_B.toLowerCase(), MAP)).toBe("CC-200");
    // The no-vendor bucket cannot be assigned an accounting code.
    expect(costCentreFor(VENDOR_NOT_RECORDED, MAP)).toBe("unassigned");
  });

  it("refuses a mapping that would invent a code or hide a typo", () => {
    expect(() => normalizeCostCentreMap({ default: "", vendors: {} })).toThrow(/non-empty `default`/);
    expect(() => normalizeCostCentreMap({ default: "unassigned", vendors: { nope: "CC-1" } })).toThrow(
      /not an address/,
    );
    expect(() =>
      normalizeCostCentreMap({ default: "unassigned", vendors: { [VENDOR_A]: " " } }),
    ).toThrow(/non-empty string/);
  });
});

describe("the accrual rows", () => {
  it("groups by period, vendor and cost centre and splits months", async () => {
    const { rows } = await buildAccrual(ROWS, MAP);
    expect(rows.map((row) => [row.period, row.vendor, row.cost_centre, row.total_minor, row.count, row.refusals])).toEqual([
      ["2026-11", VENDOR_A, "unassigned", 4000, 2, 0],
      ["2026-11", VENDOR_B.toLowerCase(), "CC-200", 10000, 1, 0],
      ["2026-11", VENDOR_NOT_RECORDED, "unassigned", 0, 1, 1],
      ["2026-12", VENDOR_A, "unassigned", 3000, 1, 0],
    ]);
  });

  it("counts a settled payment with no amount but adds 0, and refuses to guess", async () => {
    const { rows, summary } = await buildAccrual(ROWS, MAP);
    const unpriced = rows.find((row) => row.vendor === VENDOR_NOT_RECORDED);
    expect(unpriced?.count).toBe(1);
    expect(unpriced?.total_minor).toBe(0);
    expect(summary.settledUnpriced).toBe(1);
  });

  it("keeps other-network settlements out of money and counts them separately", async () => {
    const { rows, summary } = await buildAccrual(ROWS, MAP);
    expect(summary.settledOtherNetwork).toBe(1);
    const total = rows.reduce((sum, row) => sum + BigInt(row.total_minor), 0n);
    // 4000 + 10000 + 3000. The 0.5 on the other network is not spend.
    expect(total).toBe(17000n);
    expect(rows.some((row) => row.total_minor === 500_000)).toBe(false);
  });

  it("reconciles: totals, counts and refusals all sum to the source decisions", async () => {
    const { rows, summary } = await buildAccrual(ROWS, MAP);
    const mainnetSettled = ROWS.filter(
      (row) => row.decision === "settled" && row.network === "eip155:8453",
    );
    const expectedMinor = mainnetSettled.reduce(
      (sum, row) => sum + (decimalToMinor(row.amount_usdc) ?? 0n),
      0n,
    );
    const expectedRefusals = ROWS.filter((row) => row.decision === "do_not_pay").length;

    expect(rows.reduce((sum, row) => sum + BigInt(row.total_minor), 0n)).toBe(expectedMinor);
    expect(rows.reduce((sum, row) => sum + row.count, 0)).toBe(mainnetSettled.length);
    expect(rows.reduce((sum, row) => sum + row.refusals, 0)).toBe(expectedRefusals);
    expect(summary.settledProduction).toBe(mainnetSettled.length);
    expect(summary.refusals).toBe(expectedRefusals);
    expect(summary.settledResolvedToTenant).toBe(0);
    expect(summary.settledWithoutTenant).toBe(mainnetSettled.length);
  });

  it("hashes the sorted ids with the documented recipe", async () => {
    expect(await evidenceHash(["a2", "a1"])).toBe(
      "65454a5200a827c042e1379e1f2698d151699e4d76466a3b0e4ebd348f4f131b",
    );
    const { rows } = await buildAccrual(ROWS, MAP);
    expect(rows[0]?.evidence_hash).toBe(
      "65454a5200a827c042e1379e1f2698d151699e4d76466a3b0e4ebd348f4f131b",
    );
    expect(rows[2]?.evidence_hash).toBe(
      "58c59d9a1c3b5e6154917c2292ab2ea74f30035c3f1f51a053c8b73691933db4",
    );
  });

  it("refuses a duplicate decision id instead of double counting it", async () => {
    await expect(buildAccrual([...ROWS, ROWS[0]!], MAP)).rejects.toThrow(/appears twice/);
  });

  it("refuses an unparseable timestamp rather than dropping the row", () => {
    expect(() => periodOf("not-a-date")).toThrow(/not parseable/);
  });
});

describe("the CSV contract", () => {
  it("uses the exact column order and one row per accrual row", async () => {
    const { rows } = await buildAccrual(ROWS, MAP);
    const csv = buildAccrualCsv(rows);
    const lines = csv.split("\r\n").filter(Boolean);
    expect(lines[0]).toBe(
      "period,vendor,cost_centre,currency,total_minor,count,refusals,first_ts,last_ts,evidence_hash",
    );
    expect(lines).toHaveLength(rows.length + 1);
    expect(ACCRUAL_COLUMNS.join(",")).toBe(lines[0]);
    expect(csv).toContain(",USDC,4000,2,0,");
    expect(csv).toContain(VENDOR_NOT_RECORDED);
  });

  it("quotes a field with a comma or a quote, as RFC 4180 requires", () => {
    expect(accrualCsvCell("CC-1,2")).toBe('"CC-1,2"');
    expect(accrualCsvCell('a "b"')).toBe('"a ""b"""');
    expect(accrualCsvCell(4000)).toBe("4000");
  });
});

describe("the export range", () => {
  const NOW = new Date("2026-11-27T22:00:00Z");

  it("defaults to the current UTC month to date", () => {
    const resolved = resolveAccrualRange(new URLSearchParams(), NOW);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.range.fromDay).toBe("2026-11-01");
    expect(resolved.range.toDay).toBe("2026-11-27");
    expect(resolved.range.filename).toBe("paystage-accrual-2026-11-01_to_2026-11-27.csv");
  });

  it("treats a date-only end as the whole day", () => {
    const resolved = resolveAccrualRange(new URLSearchParams({ from: "2026-11-01", to: "2026-11-30" }), NOW);
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.range.to).toBe("2026-11-30T23:59:59.999Z");
    expect(resolved.range.filename).toBe("paystage-accrual-2026-11-01_to_2026-11-30.csv");
  });

  it("refuses an inverted, unparseable or oversized range", () => {
    expect(resolveAccrualRange(new URLSearchParams({ from: "2026-11-27", to: "2026-11-01" })).ok).toBe(false);
    expect(resolveAccrualRange(new URLSearchParams({ from: "yesterday" })).ok).toBe(false);
    const tooLong = resolveAccrualRange(
      new URLSearchParams({ from: "2020-01-01", to: "2026-01-01" }),
      NOW,
    );
    expect(tooLong.ok).toBe(false);
    expect(tooLong.ok ? "" : tooLong.error).toContain(String(MAX_ACCRUAL_DAYS));
  });

  it("builds the CSV and JSON links for the same days", () => {
    expect(accrualExportHref("2026-11-01T00:00:00Z", "2026-11-27T23:59:59.999Z")).toBe(
      "/lab/accrual/export?from=2026-11-01&to=2026-11-27",
    );
    expect(accrualJsonHref("2026-11-01T00:00:00Z", "2026-11-27T23:59:59.999Z")).toBe(
      "/lab/accrual.json?from=2026-11-01&to=2026-11-27",
    );
  });
});

describe("the page a manager reads", () => {
  it("server-renders one line, the cost-centre definition and the row hash", async () => {
    const { rows, summary } = await buildAccrual(ROWS, MAP);
    const range = {
      from: "2026-11-01T00:00:00.000Z",
      to: "2026-11-27T23:59:59.999Z",
      fromDay: "2026-11-01",
      toDay: "2026-11-27",
      filename: "paystage-accrual-2026-11-01_to_2026-11-27.csv",
    };
    const html = renderToStaticMarkup(createElement(AccrualView, { range, rows, summary }));
    expect(html).toContain('href="/lab/accrual/export?from=2026-11-01&amp;to=2026-11-27"');
    expect(html).toContain('href="/lab/accrual.json?from=2026-11-01&amp;to=2026-11-27"');
    expect(html).toContain("Download this range as CSV");
    expect(html).toContain("cost centre");
    expect(html).toContain("unassigned");
    expect(html).toContain("has not coded");
    expect(html).toContain("vendor_not_recorded");
    expect(html).toContain("<strong>0</strong> of 5 settled payments resolve to a tenant");
    expect(html).toContain("65454a5200a827c042e1379e1f2698d151699e4d76466a3b0e4ebd348f4f131b");
  });

  it("links the finance view from the refusals page a manager already uses", () => {
    const view = buildRefusalView([], { now: new Date("2026-11-27T20:00:00Z"), days: 7 });
    const html = renderToStaticMarkup(createElement(RefusalsView, { view }));
    expect(html).toContain('href="/lab/accrual"');
    expect(html).toContain("accrual export");
  });
});

/**
 * The routes, with the database replaced by the same seam the page uses.
 */
const { selectRowsStrict } = vi.hoisted(() => ({ selectRowsStrict: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", () => ({ selectRowsStrict }));

import { GET as getCsv } from "@/app/lab/accrual/export/route";
import { GET as getJson } from "@/app/lab/accrual.json/route";

describe("GET /lab/accrual/export and /lab/accrual.json", () => {
  beforeEach(() => {
    selectRowsStrict.mockReset();
  });

  it("returns the CSV with the range in the filename and the exact header", async () => {
    selectRowsStrict.mockResolvedValueOnce({ ok: true, rows: ROWS });
    const res = await getCsv(
      new Request("http://localhost/lab/accrual/export?from=2026-11-01&to=2026-12-31"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="paystage-accrual-2026-11-01_to_2026-12-31.csv"',
    );
    expect(res.headers.get("cache-control")).toBe("no-store");

    const query = String(selectRowsStrict.mock.calls[0]?.[1]);
    expect(query).toContain("select=id,ts,decision,amount_usdc::text,pay_to,network");
    expect(query).toContain("decision=in.(settled,do_not_pay)");
    expect(query).toContain("order=ts.asc,id.asc");
    expect(query).toContain("ts=gte.2026-11-01T00%3A00%3A00.000Z");
    expect(query).toContain("ts=lte.2026-12-31T23%3A59%3A59.999Z");
    expect(query).toContain("limit=1000");
    expect(query).toContain("offset=0");

    const body = await res.text();
    expect(body.split("\r\n")[0]).toBe(ACCRUAL_COLUMNS.join(","));
    expect(body).toContain(VENDOR_NOT_RECORDED);
    expect(body).toContain("4000");
  });

  it("returns the same rows as JSON, with the same field names", async () => {
    selectRowsStrict.mockResolvedValueOnce({ ok: true, rows: ROWS });
    const res = await getJson(
      new Request("http://localhost/lab/accrual.json?from=2026-11-01&to=2026-12-31"),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/json; charset=utf-8");
    const body = (await res.json()) as Array<Record<string, unknown>>;
    expect(body).toHaveLength(4);
    expect(Object.keys(body[0] ?? {})).toEqual([...ACCRUAL_COLUMNS]);
    const csv = await (async () => {
      selectRowsStrict.mockResolvedValueOnce({ ok: true, rows: ROWS });
      const csvRes = await getCsv(
        new Request("http://localhost/lab/accrual/export?from=2026-11-01&to=2026-12-31"),
      );
      return csvRes.text();
    })();
    expect(csv).toContain(String(body[0]?.total_minor));
    expect(csv).toContain(String(body[0]?.evidence_hash));
  });

  it("pages past PostgREST's 1,000-row cap", async () => {
    const firstPage = Array.from({ length: 1000 }, (_, index) => ({
      ...ROWS[0]!,
      id: `p${index}`,
      ts: `2026-11-02T${String(Math.floor(index / 60) % 24).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00Z`,
    }));
    selectRowsStrict
      .mockResolvedValueOnce({ ok: true, rows: firstPage })
      .mockResolvedValueOnce({ ok: true, rows: [ROWS[1]!] });
    const res = await getCsv(
      new Request("http://localhost/lab/accrual/export?from=2026-11-01&to=2026-11-30"),
    );
    expect(res.status).toBe(200);
    expect(selectRowsStrict).toHaveBeenCalledTimes(2);
    expect(String(selectRowsStrict.mock.calls[1]?.[1])).toContain("offset=1000");
  });

  it("says the read failed instead of serving an empty file", async () => {
    selectRowsStrict.mockResolvedValueOnce({ ok: false, reason: "forbidden", status: 403 });
    const res = await getCsv(new Request("http://localhost/lab/accrual/export"));
    expect(res.status).toBe(503);
    expect(res.headers.get("content-disposition")).toBeNull();
    const body = await res.text();
    expect(body).toContain("could not be read");
    expect(body).toContain("403");
  });

  it("refuses a bad range with a 400 and no file", async () => {
    const res = await getCsv(
      new Request("http://localhost/lab/accrual/export?from=2026-11-27&to=2026-11-01"),
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-disposition")).toBeNull();
    expect(await res.text()).toContain("`from` is after `to`");
  });
});

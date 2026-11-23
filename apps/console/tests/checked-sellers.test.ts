import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CheckedSellersPanel } from "@/components/CheckedSellersPanel";
import {
  CHECKED_SELLERS,
  checkedSellerView,
  checkedSellersMethod,
  hasVerification,
  type CheckedSellerRow,
  type CheckedSellersSnapshot,
} from "@/lib/checked-sellers";

/**
 * The checked-seller table (#372).
 *
 * The tests pin four things and none of them is "a number appears":
 *
 * 1. the page names the verification date and the method, and the words come from the record (mutating the record
 *    changes the page);
 * 2. a row with no verification date, or no method, is withheld with a visible count rather than rendered undated;
 * 3. the committed record carries a date and a method on every row;
 * 4. `gen-checked-sellers.mjs --check` fails when the committed copy drifts, and the generator refuses to emit rows
 *    when the record has lost its date or method.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GENERATOR = join(ROOT, "scripts/gen-checked-sellers.mjs");
const FIXTURE = join(ROOT, "apps/console/tests/fixtures/checked-sellers.md");

function tempOut(): string {
  return join(mkdtempSync(join(tmpdir(), "checked-sellers-")), "checked-sellers.generated.json");
}

function runGenerator(args: string[], source: string, out: string) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: "utf8",
    env: { ...process.env, PAYSTAGE_CHECKED_SELLERS: source, PAYSTAGE_CHECKED_SELLERS_OUT: out },
  });
}

const baseRow: CheckedSellerRow = {
  host: "console.ax1.vc",
  calls30d: 1_687_627,
  endpointsChecked: 1,
  endpointsCorrect: 1,
  challengeCorrect: true,
  verifiedOn: "2026-11-23",
  method: "GET probe, POST retry once on an error status",
  priceMatched: null,
  screening: null,
};

function snapshot(rows: CheckedSellerRow[] = [baseRow]): CheckedSellersSnapshot {
  return {
    ...CHECKED_SELLERS,
    rows,
    rowsNamed: rows.length,
    entriesCoveredByName: rows.reduce((total, row) => total + row.endpointsChecked, 0),
  };
}

function render(value: CheckedSellersSnapshot): string {
  return renderToStaticMarkup(createElement(CheckedSellersPanel, { snapshot: value }));
}

describe("the page names its verification date and method", () => {
  it("renders the date, the method paragraph and the honest limit from the record", () => {
    const html = render(CHECKED_SELLERS);
    expect(html).toContain("2026-11-23");
    expect(html).toContain("NZDT");
    expect(html).toContain("Method.");
    expect(html).toContain("50 pages × 100 entries = 5,000");
    expect(html).toContain("175 requests in all, inside the 200 cap");
    expect(html).toContain("33 hosts carry all 100 entries");
    expect(html).toContain("about 26% of listed MCP servers never answer");
    expect(html).toContain("differentiates at the top and says nothing about the tail");
    expect(html).toContain("not a ranking of quality and not an endorsement");
  });

  it("builds the method paragraph from the record's figures, not from typed numbers", () => {
    const changed = snapshot();
    changed.aggregate.result.hostsCarryingTopEntries = 3;
    changed.aggregate.result.mcpNonResponsivePercent = 47;
    const paragraph = checkedSellersMethod(changed);
    expect(paragraph).toContain("3 hosts carry all 100 entries");
    expect(paragraph).toContain("about 47%");
    expect(paragraph).not.toContain("34 hosts");
    expect(paragraph).not.toContain("26%");
  });

  it("renders the run-level summaries from the record, so a changed figure changes the page", () => {
    const changed = snapshot();
    changed.aggregate.result.correct402 = 42;
    const html = render(changed);
    expect(html).toContain("42 of 100 endpoints answered a correct 402");
    expect(html).not.toContain("97 of 100 endpoints answered a correct 402");
  });

  it("does not present the per-row price and screening gaps as facts", () => {
    const html = render(CHECKED_SELLERS);
    expect(html).toContain("not recorded per host");
    expect(html).toContain("not recorded per row");
    expect(html).toContain("does not carry a per-host price comparison or the payTo");
    expect(html).toContain("verified-payee registry (#133)");
  });
});

describe("a row without a verification date is withheld", () => {
  it("drops a dated-looking row whose verifiedOn is missing, and says how many were withheld", () => {
    const undated: CheckedSellerRow = { ...baseRow, host: "undated.example", verifiedOn: null };
    const html = render(snapshot([baseRow, undated]));
    expect(html).toContain("console.ax1.vc");
    expect(html).not.toContain("undated.example");
    expect(html).toContain("1 row is withheld");
    expect(html).toContain("no verification date or no method");
  });

  it("drops a row whose method is missing for the same reason", () => {
    const methodless: CheckedSellerRow = { ...baseRow, host: "methodless.example", method: "" };
    const html = render(snapshot([methodless]));
    expect(html).not.toContain("methodless.example");
    expect(html).toContain("1 row is withheld");
  });

  it("filters at the view level, so a caller cannot render an undated row by accident", () => {
    const view = checkedSellerView(snapshot([baseRow, { ...baseRow, host: "undated.example", verifiedOn: null }]));
    expect(view.rows.map((row) => row.host)).toEqual(["console.ax1.vc"]);
    expect(view.withheld).toBe(1);
    expect(hasVerification(baseRow)).toBe(true);
  });

  it("renders no withheld note when every row is dated", () => {
    const html = render(snapshot());
    expect(html).not.toContain("withheld");
  });
});

describe("the committed record carries a date and a method on every row", () => {
  it("has rows, and every row names both the verification date and the method", () => {
    expect(CHECKED_SELLERS.rows.length).toBeGreaterThan(0);
    for (const row of CHECKED_SELLERS.rows) {
      expect(row.verifiedOn).toBe(CHECKED_SELLERS.verifiedOn);
      expect(typeof row.method).toBe("string");
      expect((row.method ?? "").length).toBeGreaterThan(0);
      expect(hasVerification(row)).toBe(true);
      expect(row.challengeCorrect).toBe(row.endpointsCorrect === row.endpointsChecked);
    }
  });

  it("names fewer hosts than the top 100 and says so, rather than implying the table is the whole sample", () => {
    expect(CHECKED_SELLERS.rowsNamed).toBe(CHECKED_SELLERS.rows.length);
    expect(CHECKED_SELLERS.entriesCoveredByName).toBeLessThanOrEqual(CHECKED_SELLERS.aggregate.topEntries);
    const covered = CHECKED_SELLERS.entriesCoveredByName.toLocaleString("en-US");
    const top = CHECKED_SELLERS.aggregate.topEntries.toLocaleString("en-US");
    expect(render(CHECKED_SELLERS)).toContain(`together they cover ${covered} of the ${top} probed entries`);
  });

  it("is the dated probe run, not the build date", () => {
    expect(CHECKED_SELLERS.verifiedOn).toBe("2026-11-23");
    expect(CHECKED_SELLERS.timeZone).toBe("NZDT");
  });
});

describe("the generator and its --check", () => {
  it("writes a copy and then reports it current", () => {
    const out = tempOut();
    const write = runGenerator([], FIXTURE, out);
    expect(write.status).toBe(0);
    const check = runGenerator(["--check"], FIXTURE, out);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("current");
  });

  it("fails --check when the committed copy drifts", () => {
    const out = tempOut();
    expect(runGenerator([], FIXTURE, out).status).toBe(0);
    const drifted = JSON.parse(readFileSync(out, "utf8"));
    drifted.rows[0].calls30d += 1;
    writeFileSync(out, `${JSON.stringify(drifted, null, 2)}\n`);
    const check = runGenerator(["--check"], FIXTURE, out);
    expect(check.status).toBe(1);
    expect(check.stderr).toContain("out of date");
  });

  it("refuses to emit a row when the record has no verification date", () => {
    const out = tempOut();
    const source = readFileSync(FIXTURE, "utf8").replace(/Verification run,[^\n]*\n/, "");
    const withoutDate = join(mkdtempSync(join(tmpdir(), "checked-sellers-src-")), "record.md");
    writeFileSync(withoutDate, source);
    const result = runGenerator([], withoutDate, out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("verification date");
  });

  it("refuses to emit a row when the record no longer states the method", () => {
    const out = tempOut();
    const source = readFileSync(FIXTURE, "utf8").replace(/100 GET probes[\s\S]*?inside the 200 cap\.\n/, "");
    const withoutMethod = join(mkdtempSync(join(tmpdir(), "checked-sellers-src-")), "record.md");
    writeFileSync(withoutMethod, source);
    const result = runGenerator([], withoutMethod, out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no method");
  });

  it("exits 2, not 0, when the research record is not mounted", () => {
    const out = tempOut();
    const result = runGenerator(["--check"], join(tmpdir(), "checked-sellers-does-not-exist.md"), out);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no verification record");
  });

  it("emits the fixture's rows with date and method, and with the per-row gaps as null", () => {
    const out = tempOut();
    expect(runGenerator([], FIXTURE, out).status).toBe(0);
    const emitted = JSON.parse(readFileSync(out, "utf8"));
    expect(emitted.rows).toHaveLength(2);
    for (const row of emitted.rows) {
      expect(row.verifiedOn).toBe("2026-11-23");
      expect(row.method).toContain("GET probe");
      expect(row.priceMatched).toBeNull();
      expect(row.screening).toBeNull();
    }
  });
});

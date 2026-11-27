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
  checkedSellersOversize,
  checkedSellersDenominators,
  checkedSellersDialects,
  CHECKED_SELLERS,
  checkedSellerView,
  checkedSellersMethod,
  checkedSellersMethodSplit,
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
const JSON_FIXTURE = join(ROOT, "apps/console/tests/fixtures/checked-sellers-probe.json");

function tempOut(): string {
  return join(mkdtempSync(join(tmpdir(), "checked-sellers-")), "checked-sellers.generated.json");
}

function runGenerator(args: string[], source: string | null, out: string, env: Record<string, string> = {}) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...(source === null ? {} : { PAYSTAGE_CHECKED_SELLERS: source }),
      PAYSTAGE_CHECKED_SELLERS_OUT: out,
      ...env,
    },
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
    expect(html).toContain("2026-11-27");
    expect(html).toContain("(UTC)");
    expect(html).toContain("Method.");
    expect(html).toContain("50 pages × 100 entries = 5,000");
    expect(html).toContain("125 requests in all, inside the 200 cap");
    expect(html).toContain("33 hosts carry all 100 entries");
    expect(html).toContain("about 26% of listed MCP servers never answer");
    expect(html).toContain("differentiates at the top and says nothing about the tail");
    expect(html).toContain("not a ranking of quality and not an endorsement");
  });

  it("publishes the POST-only split and its GET statuses from the record, not typed counts (#466)", () => {
    const html = render(CHECKED_SELLERS);
    const split = CHECKED_SELLERS.methodSplit!;
    const statuses = split.postOnlyFirstStatus;
    expect(html).toContain(
      `${split.post} of ${split.answered} resources answer only on POST — ${statuses["405"]} with 405 and ${statuses["404"]} with 404 for a GET; either way a GET-only client gets no price.`,
    );
    // The real count the 2026-11-27 census supports: 22 of the 96 that answered a 402, 6 at 405 and 16 at 404.
    expect(split).toEqual({ get: 74, post: 22, answered: 96, postOnlyFirstStatus: { "404": 16, "405": 6 } });
    expect(html).toContain("22 of 96 resources answer only on POST");
  });

  it("a changed method split changes the sentence, and an unrecorded split is not invented", () => {
    const changed = snapshot();
    changed.methodSplit = { get: 80, post: 7, answered: 87, postOnlyFirstStatus: { "405": 7 } };
    expect(checkedSellersMethodSplit(changed)).toBe(
      "7 of 87 resources answer only on POST — 7 with 405 for a GET; either way a GET-only client gets no price.",
    );
    changed.methodSplit = null;
    expect(checkedSellersMethodSplit(changed)).toContain("was not recorded");
    expect(render(changed)).not.toContain("answer only on POST");
  });

  it("renders a host whose price is unknown rather than omitting the row (§466)", () => {
    const unknownPrice: CheckedSellerRow = { ...baseRow, host: "no-price.example", priceMatched: null };
    const html = render(snapshot([unknownPrice]));
    expect(html).toContain("no-price.example");
    expect(html).toContain("unknown — not recorded per host");
    expect(html).not.toContain("no-price.example</td><td>0</td>");
  });

  it("states the price's JSON path and that an unknown shape is not $0", () => {
    const html = render(CHECKED_SELLERS);
    expect(html).toContain("accepts[].amount");
    expect(html).toContain("unknown");
    expect(html).toContain("not");
    expect(html).toContain("$0");
    expect(html).toContain("left out of the price comparison");
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
    expect(html).not.toContain("96 of 100 endpoints answered a correct 402");
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
    expect(CHECKED_SELLERS.verifiedOn).toBe("2026-11-27");
    expect(CHECKED_SELLERS.timeZone).toBe("UTC");
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

  it("renders from the probe JSON, with no regex over the research prose", () => {
    const out = tempOut();
    const result = runGenerator([], null, out, { PAYSTAGE_CHECKED_SELLERS_JSON: JSON_FIXTURE });
    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain("falling back");
    expect(result.stdout).toContain("method: GET, one POST retry on error status");
    const emitted = JSON.parse(readFileSync(out, "utf8"));
    expect(emitted.rows).toHaveLength(2);
    expect(emitted.aggregate.result.correct402).toBe(2);
    expect(emitted.aggregate.result.priceMatched).toBe(2);
    expect(emitted.aggregate.result.hostsCarryingTopEntries).toBe(34);
    expect(emitted.rows[0].host).toBe("console.ax1.vc");
    expect(emitted.rows[0].method).toContain("GET, one POST retry on error status");
    expect(emitted.rows[0].priceMatched).toBeNull();
    expect(emitted.rows[0].screening).toBeNull();
  });

  it("refuses a probe JSON whose aggregate lost a published number (#387)", () => {
    const out = tempOut();
    const drifted = JSON.parse(readFileSync(JSON_FIXTURE, "utf8"));
    delete drifted.aggregate.result.correct402;
    const source = join(mkdtempSync(join(tmpdir(), "checked-sellers-json-")), "probe.json");
    writeFileSync(source, `${JSON.stringify(drifted, null, 2)}\n`);
    const result = runGenerator([], null, out, { PAYSTAGE_CHECKED_SELLERS_JSON: source });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("correct-402 count");
    expect(result.stderr).toContain("refuses");
  });

  it("falls back loudly to the markdown record when the probe JSON is absent", () => {
    const out = tempOut();
    const result = runGenerator([], FIXTURE, out, {
      PAYSTAGE_CHECKED_SELLERS_JSON: join(tmpdir(), "checked-sellers-probe-does-not-exist.json"),
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("ERROR: no probe JSON");
    expect(result.stderr).toContain("falling back");
    expect(JSON.parse(readFileSync(out, "utf8")).rows).toHaveLength(2);
  });

  it("fails --check when the probe JSON drifts", () => {
    const out = tempOut();
    expect(runGenerator([], null, out, { PAYSTAGE_CHECKED_SELLERS_JSON: JSON_FIXTURE }).status).toBe(0);
    expect(runGenerator(["--check"], null, out, { PAYSTAGE_CHECKED_SELLERS_JSON: JSON_FIXTURE }).status).toBe(0);
    const drifted = JSON.parse(readFileSync(out, "utf8"));
    drifted.rows[0].calls30d += 1;
    writeFileSync(out, `${JSON.stringify(drifted, null, 2)}\n`);
    expect(runGenerator(["--check"], null, out, { PAYSTAGE_CHECKED_SELLERS_JSON: JSON_FIXTURE }).status).toBe(1);
  });

  it("emits the markdown fixture's rows with date and method, and with the per-row gaps as null", () => {
    const out = tempOut();
    expect(runGenerator([], FIXTURE, out).status).toBe(0);
    const emitted = JSON.parse(readFileSync(out, "utf8"));
    expect(emitted.rows).toHaveLength(2);
    for (const row of emitted.rows) {
      expect(row.verifiedOn).toBe("2026-11-23");
      expect(row.method).toContain("GET, one POST retry on error status");
      expect(row.priceMatched).toBeNull();
      expect(row.screening).toBeNull();
    }
  });
});

/**
 * The challenge composition (#495). The page said how many resources answer only on POST and never which dialect they speak, so a
 * reader could not tell whether the ecosystem had settled on v2 or was split. These assertions pin the numbers to the committed
 * record — and the four hosts that answered nothing are named, because "4 did not" is uncheckable without them.
 */
describe("challenge dialects", () => {
  it("publishes the measured composition", () => {
    const split = CHECKED_SELLERS.dialectSplit;
    expect(split).not.toBeNull();
    expect(split!.v2).toBe(96);
    expect(split!.legacy).toBe(0);
    expect(split!.both).toBe(0);
    expect(split!.none).toBe(4);
    expect(split!.v2 + split!.legacy + split!.both + split!.none).toBe(split!.total);
  });

  it("names every resource that answered no challenge, with its status", () => {
    const none = CHECKED_SELLERS.dialectSplit!.noChallenge;
    expect(none).toHaveLength(4);
    for (const row of none) {
      expect(row.host.length).toBeGreaterThan(0);
      expect(row.status === null && row.firstStatus === null).toBe(false);
    }
    const sentence = checkedSellersDialects(CHECKED_SELLERS);
    for (const row of none) expect(sentence).toContain(row.host);
    expect(sentence).toContain("none used the legacy header");
  });

  it("says the dialects are not recorded rather than inventing a split", () => {
    const sentence = checkedSellersDialects({ ...CHECKED_SELLERS, dialectSplit: null });
    expect(sentence).toContain("not recorded");
    expect(sentence).not.toContain("0 of");
  });
});

/**
 * Both denominators (#499). The page's headlines count resources and a reader reads them as services; one host carries 29 of the
 * 100 resources, so "7 of 96 exceed 8 KB" is also "5 of 34 hosts". The assertion pins both numbers and the carrier, so the sentence
 * cannot quietly start describing one population with the other's words.
 */
describe("two denominators", () => {
  it("publishes resources and hosts together", () => {
    const d = CHECKED_SELLERS.denominators;
    expect(d).not.toBeNull();
    expect(d!.resources).toBe(100);
    expect(d!.hosts).toBe(34);
    expect(d!.resourcesOver8kb).toBe(7);
    expect(d!.hostsOver8kb).toBe(5);
    expect(d!.largestHost?.[0]).toBe("agent.pocket.network");
    expect(d!.largestHost?.[1]).toBe(29);
  });

  it("says which denominator a count uses, and warns when it is not recorded", () => {
    const sentence = checkedSellersDenominators(CHECKED_SELLERS);
    expect(sentence).toContain("100 resources across 34 hosts");
    expect(sentence).toContain("per resource, not per host");
    expect(checkedSellersDenominators({ ...CHECKED_SELLERS, denominators: null })).toContain("not recorded");
  });
});

/**
 * Header sizes (#494). Seven of 96 challenges exceed the 8,192-byte line many proxies allow for the whole header block; the biggest is
 * 10,164. The test pins the count, the extremes and the offender, because a sentence that drifts from the data would still read fine.
 */
describe("oversize challenges", () => {
  it("pins the measured range and the offenders", () => {
    const h = CHECKED_SELLERS.headerBytes;
    expect(h).not.toBeNull();
    expect(h!.measured).toBe(96);
    expect(h!.min).toBe(1216);
    expect(h!.median).toBe(3142);
    expect(h!.max).toBe(10164);
    expect(h!.limit).toBe(8192);
    expect(h!.oversize).toHaveLength(7);
    expect(h!.oversize[0].bytes).toBe(10164);
    expect(h!.oversize[0].host).toBe("agent402.tools");
    for (const row of h!.oversize) expect(row.bytes).toBeGreaterThan(h!.limit);
  });

  it("names them, counts them, and says so when nothing was recorded", () => {
    const sentence = checkedSellersOversize(CHECKED_SELLERS);
    expect(sentence).toContain("8,192");
    expect(sentence).toContain("10,164");
    expect(sentence).toContain("agent402.tools");
    expect(sentence).toContain("under 2 KB");
    expect(checkedSellersOversize({ ...CHECKED_SELLERS, headerBytes: null })).toContain("not recorded");
  });
});

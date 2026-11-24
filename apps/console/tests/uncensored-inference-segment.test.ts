import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UncensoredInferenceSegmentPanel } from "@/components/UncensoredInferenceSegmentPanel";
import {
  CHECKED_SELLERS_SEGMENT,
  segmentKillCriterion,
  segmentMethod,
  segmentSelfDescription,
  type SegmentSnapshot,
} from "@/lib/checked-sellers-segment";

/**
 * The "uncensored inference" class segment (#398).
 *
 * The tests pin the three things that make this segment different from a list of names:
 *
 * 1. membership is **self-description** and the page says so, with the payment-safety limit in the same sentence;
 * 2. the method sentence carries the denominator, the date and the method — and every row carries a verdict and a date;
 * 3. the generator refuses a record that lost a verdict or a date, so 55/55 cannot be faked by omission.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const GENERATOR = join(ROOT, "scripts/gen-checked-sellers-segment.mjs");
const RECORD = join(ROOT, "apps/console/src/lib/checked-sellers-segment.generated.json");

function tempOut(): string {
  return join(mkdtempSync(join(tmpdir(), "checked-sellers-segment-")), "segment.generated.json");
}

function runGenerator(args: string[], source: string, out: string) {
  return spawnSync(process.execPath, [GENERATOR, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      PAYSTAGE_CHECKED_SELLERS_SEGMENT: source,
      PAYSTAGE_CHECKED_SELLERS_SEGMENT_OUT: out,
    },
  });
}

function render(value: SegmentSnapshot): string {
  return renderToStaticMarkup(createElement(UncensoredInferenceSegmentPanel, { snapshot: value }));
}

describe("the segment says membership is self-description, not behaviour", () => {
  it("renders the self-description sentence and the payment-safety limit", () => {
    const html = render(CHECKED_SELLERS_SEGMENT);
    expect(html).toContain("Membership of this segment is self-description");
    expect(html).toContain("in its own listing text");
    expect(html).toContain("measures payment safety");
    expect(html).toContain("not content policy, censorship resistance, or what any provider will serve");
    expect(html).toContain("keywords — uncensored");
  });

  it("builds the sentence from the record, so a changed class definition changes the copy", () => {
    const changed = { ...CHECKED_SELLERS_SEGMENT, classDefinition: { ...CHECKED_SELLERS_SEGMENT.classDefinition, keywords: ["venice", "chutes"] } };
    const sentence = segmentSelfDescription(changed);
    expect(sentence).toContain("venice, chutes");
    expect(sentence).not.toContain("morpheus");
    expect(sentence).toContain("self-description");
  });

  it("does not call the class uncensored in the page heading", () => {
    const html = render(CHECKED_SELLERS_SEGMENT);
    expect(html).toContain("&quot;uncensored inference&quot; class");
    expect(html).toContain("self-description");
  });
});

describe("the method sentence carries the denominator, the date and the method", () => {
  it("names all three in one sentence", () => {
    const sentence = segmentMethod(CHECKED_SELLERS_SEGMENT);
    expect(sentence).toContain("On 2026-11-24");
    expect(sentence).toContain("55 hosts");
    expect(sentence).toContain("one GET and one POST retry on an error status");
    expect(sentence).toContain("isCorrectChallenge");
  });

  it("renders the method, the date and the three result cards", () => {
    const html = render(CHECKED_SELLERS_SEGMENT);
    expect(html).toContain("2026-11-24");
    expect(html).toContain("51 of 55 hosts answered a correct 402");
    expect(html).toContain("45 of 51 advertised prices matched the price asked");
    expect(html).toContain("clear of the OFAC and known-drainer lists");
  });

  it("states the kill criterion with its result, and it did not fire", () => {
    const sentence = segmentKillCriterion(CHECKED_SELLERS_SEGMENT);
    expect(sentence).toContain("did not fire");
    expect(sentence).toContain("fewer than half");
    expect(sentence).toContain("51");
  });
});

describe("every one of the 55 hosts carries a verdict and a date", () => {
  it("has one row per host with a boolean 402 verdict, a date and a method", () => {
    expect(CHECKED_SELLERS_SEGMENT.rows).toHaveLength(55);
    expect(CHECKED_SELLERS_SEGMENT.denominator.hosts).toBe(55);
    for (const row of CHECKED_SELLERS_SEGMENT.rows) {
      expect(typeof row.host).toBe("string");
      expect(row.host.length).toBeGreaterThan(0);
      expect(typeof row.correct402).toBe("boolean");
      expect(row.verifiedOn).toBe("2026-11-24");
      expect(row.method).toContain("GET");
      expect(typeof row.screening).toBe("string");
      expect(row.screening.length).toBeGreaterThan(0);
    }
  });

  it("counts its own rows rather than repeating an aggregate", () => {
    const correct = CHECKED_SELLERS_SEGMENT.rows.filter((row) => row.correct402).length;
    const matched = CHECKED_SELLERS_SEGMENT.rows.filter((row) => row.priceMatched).length;
    expect(correct).toBe(CHECKED_SELLERS_SEGMENT.result.correct402);
    expect(matched).toBe(CHECKED_SELLERS_SEGMENT.result.priceMatched);
  });

  it("keeps the same six columns as the checked-seller table", () => {
    const html = render(CHECKED_SELLERS_SEGMENT);
    for (const heading of ["Host", "Calls / 30d", "Verified", "Correct 402", "Advertised price", "Screening"]) {
      expect(html).toContain(`<th>${heading}</th>`);
    }
    expect(html).not.toContain("<th>Asked price</th>");
    expect(html).not.toContain("<th>Payee</th>");
  });
});

describe("the generator and its --check", () => {
  it("writes a copy and then reports it current", () => {
    const out = tempOut();
    expect(runGenerator([], RECORD, out).status).toBe(0);
    const check = runGenerator(["--check"], RECORD, out);
    expect(check.status).toBe(0);
    expect(check.stdout).toContain("current");
  });

  it("fails --check when the committed copy drifts", () => {
    const out = tempOut();
    expect(runGenerator([], RECORD, out).status).toBe(0);
    const drifted = JSON.parse(readFileSync(out, "utf8"));
    drifted.rows[0].calls30d += 1;
    writeFileSync(out, `${JSON.stringify(drifted, null, 2)}\n`);
    expect(runGenerator(["--check"], RECORD, out).status).toBe(1);
  });

  it("refuses a record where a row has no 402 verdict", () => {
    const out = tempOut();
    const drifted = JSON.parse(readFileSync(RECORD, "utf8"));
    delete drifted.rows[3].correct402;
    const source = join(mkdtempSync(join(tmpdir(), "checked-sellers-segment-src-")), "record.json");
    writeFileSync(source, `${JSON.stringify(drifted, null, 2)}\n`);
    const result = runGenerator([], source, out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no boolean 402 verdict");
    expect(result.stderr).toContain("55/55 verdicts");
  });

  it("refuses a record where a row lost its date", () => {
    const out = tempOut();
    const drifted = JSON.parse(readFileSync(RECORD, "utf8"));
    delete drifted.rows[0].verifiedOn;
    const source = join(mkdtempSync(join(tmpdir(), "checked-sellers-segment-src-")), "record.json");
    writeFileSync(source, `${JSON.stringify(drifted, null, 2)}\n`);
    const result = runGenerator([], source, out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no readable verdict date");
  });

  it("refuses a partial segment", () => {
    const out = tempOut();
    const drifted = JSON.parse(readFileSync(RECORD, "utf8"));
    drifted.rows.pop();
    const source = join(mkdtempSync(join(tmpdir(), "checked-sellers-segment-src-")), "record.json");
    writeFileSync(source, `${JSON.stringify(drifted, null, 2)}\n`);
    const result = runGenerator([], source, out);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("partial segment");
  });

  it("exits 2, not 0, when the record is not mounted", () => {
    const out = tempOut();
    const result = runGenerator(["--check"], join(tmpdir(), "checked-sellers-segment-does-not-exist.json"), out);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("no measurement record");
  });
});

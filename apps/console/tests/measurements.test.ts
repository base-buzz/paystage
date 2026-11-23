import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The measurement registry (#388).
 *
 * Four properties, and the first one is the row's whole point: a number is only publishable if its population, n, date and
 * reproducing command are written beside it. The other three are the guard, shown failing rather than assumed to fail:
 * a stale entry is red, a rendered number with no entry is red, and today's real registry is green.
 */

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const CHECK = join(ROOT, "scripts/check-claims.mjs");
const REGISTRY = join(ROOT, "docs/state/measurements.json");
const TODAY = "2026-11-23T18:00:00Z";

interface Entry {
  name: string;
  value: number;
  population: string;
  n: number;
  measured_at: string;
  command: string;
  refresh_days: number;
  source?: string;
  json_path?: string;
  page?: string;
}

interface Registry {
  version: number;
  surfaces: { file: string; roots: string[]; page: string }[];
  entries: Entry[];
}

const registry = (): Registry => JSON.parse(readFileSync(REGISTRY, "utf8")) as Registry;

function tempRegistry(mutate: (value: Registry) => void): string {
  const value = registry();
  mutate(value);
  const file = join(mkdtempSync(join(tmpdir(), "measurements-")), "measurements.json");
  writeFileSync(file, JSON.stringify(value, null, 2));
  return file;
}

function run(file?: string, research?: string) {
  return spawnSync(process.execPath, [CHECK, "--measurements"], {
    encoding: "utf8",
    env: {
      ...process.env,
      PAYSTAGE_MEASUREMENTS_ASOF: TODAY,
      ...(file ? { PAYSTAGE_MEASUREMENTS: file } : {}),
      ...(research ? { PAYSTAGE_RESEARCH_FILES: research } : {}),
    },
    timeout: 60_000,
  });
}

describe("the registry carries a population with every number", () => {
  it("parses, and every entry has name, value, population, n, measured_at, command and refresh_days", () => {
    const value = registry();
    expect(value.version).toBe(1);
    expect(Array.isArray(value.entries)).toBe(true);
    expect(value.entries.length).toBeGreaterThan(0);
    const names = new Set<string>();
    for (const entry of value.entries) {
      expect(entry.name, JSON.stringify(entry)).toBeTruthy();
      expect(Number.isFinite(entry.value), entry.name).toBe(true);
      expect(entry.population?.trim().length, entry.name).toBeGreaterThan(0);
      expect(Number.isInteger(entry.n) && entry.n > 0, entry.name).toBe(true);
      expect(Number.isNaN(Date.parse(entry.measured_at)), entry.name).toBe(false);
      expect(entry.command?.trim().length, entry.name).toBeGreaterThan(0);
      expect(entry.refresh_days > 0, entry.name).toBe(true);
      expect(names.has(entry.name), `duplicate ${entry.name}`).toBe(false);
      names.add(entry.name);
    }
  });

  it("declares the surfaces that feed the pages it polices", () => {
    const value = registry();
    expect(value.surfaces.length).toBeGreaterThanOrEqual(3);
    for (const surface of value.surfaces) {
      expect(surface.roots.length).toBeGreaterThan(0);
      expect(surface.page).toMatch(/^apps\/console\/src\//);
    }
  });
});

describe("the checker fails where the registry would rot", () => {
  it("passes on today's real registry and page data", () => {
    const result = run();
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("0 stale");
    expect(result.status).toBe(0);
  });

  it("fails on an entry older than its refresh_days, naming the entry", () => {
    const file = tempRegistry((value) => {
      value.entries.find((e) => e.name === "checked-sellers.result.correct402")!.measured_at = "2026-01-01";
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain('measurement "checked-sellers.result.correct402" is stale');
    expect(result.stdout).toContain("refresh_days 30");
    expect(result.stdout).toContain("node scripts/gen-checked-sellers.mjs");
  });

  it("fails on a page number with no registry entry, naming the page and the value", () => {
    const file = tempRegistry((value) => {
      value.entries = value.entries.filter((e) => e.name !== "checked-sellers.result.correct402");
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("page apps/console/src/lib/checked-sellers.ts renders aggregate.result.correct402 = 97");
    expect(result.stdout).toContain("has no entry for it");
  });

  it("fails when a declared page surface is missing its number entirely", () => {
    const file = tempRegistry((value) => {
      value.entries = value.entries.filter((e) => e.name !== "bazaar-demand.totalCalls30d");
    });
    const result = run(file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("DemandSourcesPanel.tsx renders totalCalls30d = 1114606");
  });
});

describe("research files need a registry entry for every table/bold figure", () => {
  const researchFile = (body: string): string => {
    const file = join(mkdtempSync(join(tmpdir(), "research-")), "notes.md");
    writeFileSync(file, body);
    return file;
  };

  it("fails on a bolded number with no entry, naming the file and the number", () => {
    const file = researchFile("# Notes\n\nA **9,876** endpoint sample.\n");
    const result = run(undefined, file);
    expect(result.status).toBe(1);
    expect(result.stdout).toContain("notes.md");
    expect(result.stdout).toContain("bold span number 9,876 (9876)");
    expect(result.stdout).toContain("no registry entry");
  });

  it("passes when the table/bold number has a registry entry", () => {
    const file = researchFile("| Figure | Value |\n|---|---|\n| Base-USDC resources | **37,316** |\n");
    const result = run(undefined, file);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("research numbers covered (1 table/bold figures");
  });

  it("allowlists years, HTTP status codes, row/line numbers and addresses", () => {
    const file = researchFile(
      [
        "| Kind | Value |",
        "|---|---|",
        "| Year | **2026** |",
        "| Status | **404** |",
        "| Row | row 1,234 |",
        "| Address | `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` |",
      ].join("\n") + "\n",
    );
    const result = run(undefined, file);
    expect(result.status).toBe(0);
    expect(result.stdout).not.toContain("no registry entry");
  });
});

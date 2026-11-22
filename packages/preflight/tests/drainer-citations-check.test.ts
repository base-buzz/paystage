import { describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

/**
 * `check-drainer-citations.mjs` (#362 A3) must fail a citation that is missing, not https, or stale — otherwise
 * the per-entry citation is a field the page prints and nothing checks.
 *
 * The check reads the TypeScript source as text (the same way the page generator does), so each case is a tiny
 * fixture with one entry rather than a mutated copy of the real list.
 */
const SCRIPT = fileURLToPath(new URL("../../../scripts/check-drainer-citations.mjs", import.meta.url));
const ADDRESS = "0x09750ad360fdb7a2ee23669c4503c974d86d8694";

function run(entry: string, extraArgs: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), "drainer-citations-"));
  const file = join(dir, "known-drainers.ts");
  writeFileSync(
    file,
    `export const DRAINER_ENTRIES: readonly KnownDrainerCitation[] = Object.freeze([\n${entry}\n]);\n`,
  );
  try {
    return spawnSync(process.execPath, [SCRIPT, "--file", file, ...extraArgs], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const entry = (fields: string): string => `  {\n${fields}\n  },`;

describe("check-drainer-citations", () => {
  it("passes a dated https citation", () => {
    const result = run(entry(`    address: "${ADDRESS}",\n    source: "https://example.com/incident",\n    readDate: "2026-11-22",`));
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 attributed");
  });

  it("fails an entry with no source", () => {
    const result = run(entry(`    address: "${ADDRESS}",\n    readDate: "2026-11-22",`));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/no source/);
  });

  it("fails a source that is not https", () => {
    const result = run(entry(`    address: "${ADDRESS}",\n    source: "http://example.com/incident",\n    readDate: "2026-11-22",`));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/not an https:\/\//);
  });

  it("fails a citation read more than 180 days ago", () => {
    const result = run(entry(`    address: "${ADDRESS}",\n    source: "https://example.com/incident",\n    readDate: "2020-01-01",`));
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/180-day window/);
  });

  it("allows an explicit unattributed entry, and reports it", () => {
    const result = run(
      entry(`    address: "${ADDRESS}",\n    source: "unattributed",\n    readDate: null,\n    note: "no public source found",`),
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("1 unattributed");
  });

  it("can refuse unattributed entries for a release with --strict-unattributed", () => {
    const result = run(
      entry(`    address: "${ADDRESS}",\n    source: "unattributed",\n    readDate: null,`),
      ["--strict-unattributed"],
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/explicitly unattributed/);
  });
});

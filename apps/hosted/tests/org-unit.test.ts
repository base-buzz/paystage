/**
 * The migrations are no longer tracked (operator decision, 2026-11-28), so this file is present in a developer's checkout and absent in CI.
 * Reading it unconditionally would make the whole suite red on every clean checkout for a reason that is not a defect, so the tests that
 * need the SQL skip with a named reason instead.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ORG_UNIT_RE,
  effectiveUnit,
  isInSubtree,
  parseOrgUnit,
  parseOrgUnitForTenant,
  tenantOfUnit,
} from "../src/org-unit.js";

/**
 * The org-unit convention (#471).
 *
 * The prefix rules are tested here rather than only through the database because they are what the
 * roll-up's correctness rests on: `eng` must not match `engineering`, and a unit must not escape its
 * tenant. The migration's SQL check is asserted as text beside these, the same way #453's policies are.
 */

/**
 * The migrations are no longer tracked (operator decision, 2026-11-28): the file exists in a developer's checkout and is absent in CI.
 * An eager read would make every clean checkout red for a reason that is not a defect, so the suites below skip when it is missing and say
 * why — a skipped test with a named reason is honest; a red one is noise.
 */
const SQL_PATH = join(import.meta.dirname, "../../../supabase/migrations/20261127120000_mandate_org_unit.sql");
const SQL = existsSync(SQL_PATH) ? readFileSync(SQL_PATH, "utf8") : null;
const MIGRATION_SKIP = SQL === null ? "schema migrations are not published in this repository (docs/specs/supabase-ops.md)" : false;
describe.skipIf(MIGRATION_SKIP)("the org-unit path convention", () => {
  it("accepts a tenant root and nested paths", () => {
    for (const unit of [
      "paystage",
      "paystage/engineering",
      "paystage/engineering/platform",
      "acme2/a-b/c-d/e/f/g/h", // 8 segments is the maximum
    ]) {
      expect(parseOrgUnit(unit), unit).toEqual({ ok: true, value: unit });
    }
  });

  it("refuses the shapes that would turn a prefix into a wildcard or a traversal", () => {
    for (const unit of [
      "",
      "/paystage",
      "paystage/",
      "paystage//engineering",
      "paystage/eng_platform",
      "paystage/eng%platform",
      "paystage/engineering/.",
      "paystage/engineering/..",
      "PayStage/Engineering",
      "paystage/engineering platform",
      "paystage/engineering\n",
      "a".repeat(201),
      "paystage/a/b/c/d/e/f/g/h", // 9 segments
      "paystage/-engineering",
      "paystage/engineering-",
    ]) {
      expect(parseOrgUnit(unit).ok, JSON.stringify(unit)).toBe(false);
    }
  });

  it("keeps the same shape in SQL as in the TypeScript parser", () => {
    // A text assertion cannot prove Postgres accepts the file; it does pin that the DB refuses the
    // same class of path the API refuses, rather than shipping a narrower check on one side.
    expect(SQL).toMatch(/add column if not exists org_unit text default null/i);
    expect(SQL).toMatch(/mandates_org_unit_path/);
    expect(SQL).toMatch(/org_unit is null/i);
    expect(SQL).toMatch(/\[a-z0-9\]/);
    expect(SQL).toMatch(/length\(org_unit\) <= 200/i);
    // Not applied by this repo's test path, and the column is optional by design.
    expect(SQL).not.toMatch(/\bnot null\b/i);
  });

  it("requires the first segment to be the tenant, on whole segments", () => {
    expect(parseOrgUnitForTenant("paystage", "paystage").ok).toBe(true);
    expect(parseOrgUnitForTenant("paystage/engineering", "paystage").ok).toBe(true);
    // A shared string prefix is a different tenant, not a child.
    expect(parseOrgUnitForTenant("paystage-other/engineering", "paystage").ok).toBe(false);
    expect(parseOrgUnitForTenant("other/engineering", "paystage").ok).toBe(false);
    expect(parseOrgUnitForTenant(null, "paystage").ok).toBe(false);
  });
});

describe.skipIf(MIGRATION_SKIP)("subtree membership", () => {
  it("matches the unit itself and whole-segment descendants", () => {
    expect(isInSubtree("paystage", "paystage")).toBe(true);
    expect(isInSubtree("paystage/engineering", "paystage")).toBe(true);
    expect(isInSubtree("paystage/engineering/platform", "paystage")).toBe(true);
    expect(isInSubtree("paystage/engineering/platform", "paystage/engineering")).toBe(true);
  });

  it("does not collide when one unit path is a prefix of another", () => {
    // The exact failure the row names: `eng` must not total `engineering`'s spend.
    expect(isInSubtree("paystage/engineering", "paystage/eng")).toBe(false);
    expect(isInSubtree("paystage/engineering/platform", "paystage/eng")).toBe(false);
    expect(isInSubtree("paystage/engineering", "paystage/engineering")).toBe(true);
    expect(isInSubtree("paystage/engineering-ops", "paystage/engineering")).toBe(false);
  });

  it("treats a null unit as the tenant root, not as unallocated", () => {
    expect(effectiveUnit(null, "paystage")).toBe("paystage");
    expect(effectiveUnit(undefined, "paystage")).toBe("paystage");
    expect(effectiveUnit("paystage/engineering", "paystage")).toBe("paystage/engineering");
    expect(tenantOfUnit("paystage/engineering/platform")).toBe("paystage");
    expect(tenantOfUnit("paystage")).toBe("paystage");
  });
});

describe.skipIf(MIGRATION_SKIP)("the org-unit path grammar", () => {
  it("is exported as the single source both halves read", () => {
    expect(ORG_UNIT_RE.test("paystage/engineering")).toBe(true);
    expect(ORG_UNIT_RE.test("paystage/engineering/")).toBe(false);
  });
});

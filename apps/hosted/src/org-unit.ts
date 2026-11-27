/**
 * Org-unit paths (#471): the allocation convention a mandate may carry and a roll-up sums over.
 *
 * A unit is a lowercase slash-separated path, one segment per level, e.g.
 *
 *     paystage/engineering/platform
 *
 * The first segment is the `tenant_id`. That is not decoration: the roll-up scopes its query by the
 * first segment, so a path that starts anywhere else would either be invisible or, worse, appear in
 * another tenant's tree. The mint refuses it, and the migration's check constraint refuses the same
 * shape for any other writer.
 *
 * The rules are intentionally narrow because a path is a **prefix** used in a query:
 *
 *  - lowercase `[a-z0-9-]`, 1-63 characters per segment, starting and ending alphanumeric;
 *  - no empty segment, leading/trailing slash, `.`/`..`, space, colon or wildcard character;
 *  - at most 8 segments and 200 characters.
 *
 * Narrowing the alphabet means a unit can be put in a URL path, a `LIKE` pattern and a log line
 * without escaping, and it removes the two characters (`%`, `_`) that would turn a prefix match into
 * a wildcard.
 *
 * A NULL unit is legal and meaningful: a single-person install has no tree, so its mandates sit at the
 * tenant root. The roll-up treats `NULL` as the tenant id, not as "uncategorised".
 */

/** A segment: 1-63 chars, alphanumeric ends, hyphens allowed inside. */
const SEGMENT = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";

/** The whole path. Same source as the SQL constraint in `20261127120000_mandate_org_unit.sql`. */
export const ORG_UNIT_RE = new RegExp(`^${SEGMENT}(?:/${SEGMENT}){0,7}$`);

export const ORG_UNIT_MAX_LENGTH = 200;

export type OrgUnitParse =
  | { ok: true; value: string }
  | { ok: false; reason: string };

/**
 * Parse a path without a tenant. Used for the `unit` query parameter, where the first segment is read
 * as the tenant. The mint uses `parseOrgUnitForTenant` instead, which also checks that prefix.
 */
export function parseOrgUnit(value: unknown): OrgUnitParse {
  if (typeof value !== "string") return { ok: false, reason: "the unit must be a string" };
  if (value.length === 0) return { ok: false, reason: "the unit must not be empty" };
  if (value.length > ORG_UNIT_MAX_LENGTH) {
    return { ok: false, reason: `the unit must be at most ${ORG_UNIT_MAX_LENGTH} characters` };
  }
  if (!ORG_UNIT_RE.test(value)) {
    return {
      ok: false,
      reason:
        "the unit must be lowercase slash-separated segments (1-63 chars of a-z, 0-9 and '-', each " +
        "starting and ending alphanumeric), e.g. paystage/engineering/platform",
    };
  }
  return { ok: true, value };
}

/**
 * Parse and check that the path belongs to `tenantId`.
 *
 * A path may equal the tenant (the root) or start with `${tenantId}/`. It may not merely share a string
 * prefix: `paystage-other` is a different tenant, not a child of `paystage`, so the check compares whole
 * segments rather than `startsWith(tenantId)`.
 */
export function parseOrgUnitForTenant(value: unknown, tenantId: string): OrgUnitParse {
  const parsed = parseOrgUnit(value);
  if (!parsed.ok) return parsed;
  if (parsed.value !== tenantId && !parsed.value.startsWith(`${tenantId}/`)) {
    return {
      ok: false,
      reason: `the unit must be the tenant root (${tenantId}) or start with ${tenantId}/; a mandate cannot be allocated outside its tenant`,
    };
  }
  return parsed;
}

/** The tenant a unit path belongs to: its first segment. The path is assumed already validated. */
export function tenantOfUnit(unit: string): string {
  const slash = unit.indexOf("/");
  return slash === -1 ? unit : unit.slice(0, slash);
}

/**
 * Is `candidate` inside `unit`'s subtree?
 *
 * Exact match or whole-segment prefix only. `eng` is not a prefix of `engineering`, and `paystage/eng`
 * is not a prefix of `paystage/engineering` — the slash after the unit is what makes the difference.
 */
export function isInSubtree(candidate: string, unit: string): boolean {
  return candidate === unit || candidate.startsWith(`${unit}/`);
}

/**
 * The unit a row contributes to. A NULL (or missing, on a deployment that has not applied the
 * migration) `org_unit` is the tenant root, because that is what "no tree" means.
 */
export function effectiveUnit(orgUnit: string | null | undefined, tenantId: string): string {
  return orgUnit === null || orgUnit === undefined || orgUnit === "" ? tenantId : orgUnit;
}

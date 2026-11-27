import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { buildRollup, formatMinor, type RollupSnapshot } from "../src/rollup.js";
import { createMemoryRollupStore, type RollupStore } from "../src/rollup-store.js";

/**
 * The org-unit roll-up (#471).
 *
 * The property the row names is **exactly once**: a child's spend must appear in its parent's total
 * once, not once for the parent query and once for the child query. Every test here builds the tree as
 * data and asserts the total, so the arithmetic is pinned independently of PostgREST.
 *
 * The second property is honesty about the missing join: `events` has no mandate serial today, so the
 * endpoint must answer 0 **with the reason**, never a 0 that reads as "no money moved".
 */

const NOW = new Date("2026-11-27T12:00:00.000Z");

function snapshot(overrides: Partial<RollupSnapshot> = {}): RollupSnapshot {
  return {
    mandates: [],
    orgUnitColumnPresent: true,
    events: { available: true, rows: [] },
    ...overrides,
  };
}

function settled(id: string, serial: string, amount: string, network = "eip155:8453") {
  return { id, mandate_serial: serial, decision: "settled", amount_usdc: amount, network };
}

function refused(id: string, serial: string) {
  return { id, mandate_serial: serial, decision: "do_not_pay", amount_usdc: null, network: "eip155:8453" };
}

describe("buildRollup — subtree totals, exactly once", () => {
  it("counts a child's spend exactly once when a mandate sits at the parent and children have their own", () => {
    // department (root) has its own mandate, and two children have theirs. A naive
    // "sum the parent + sum each child" implementation would count the child spend twice at the root.
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [
          { serial: "m-root", org_unit: "paystage" },
          { serial: "m-eng", org_unit: "paystage/engineering" },
          { serial: "m-eng-platform", org_unit: "paystage/engineering/platform" },
        ],
        events: {
          available: true,
          rows: [
            settled("e-root", "m-root", "0.250000"),
            settled("e-eng", "m-eng", "0.300000"),
            settled("e-platform", "m-eng-platform", "1.000000"),
          ],
        },
      }),
      NOW.toISOString(),
    );

    expect(body.mandates).toBe(3);
    // 0.25 + 0.30 + 1.00 = 1.55 USDC = 1,550,000 micro-USDC, each event once.
    expect(body.spend_minor).toBe(1_550_000);
    expect(body.spend_currency).toBe("USDC");
    expect(body.descendants.map((child) => [child.unit, child.mandates, child.spend_minor])).toEqual([
      ["paystage/engineering", 1, 300_000],
      ["paystage/engineering/platform", 1, 1_000_000],
    ]);

    // The same rows at the middle unit: the root's 0.25 is not a descendant and must not appear.
    const middle = buildRollup(
      "paystage/engineering",
      snapshot({
        mandates: [
          { serial: "m-root", org_unit: "paystage" },
          { serial: "m-eng", org_unit: "paystage/engineering" },
          { serial: "m-eng-platform", org_unit: "paystage/engineering/platform" },
        ],
        events: {
          available: true,
          rows: [
            settled("e-root", "m-root", "0.250000"),
            settled("e-eng", "m-eng", "0.300000"),
            settled("e-platform", "m-eng-platform", "1.000000"),
          ],
        },
      }),
      NOW.toISOString(),
    );
    expect(middle.spend_minor).toBe(1_300_000);
    expect(middle.mandates).toBe(2);
  });

  it("does not collide when one unit path is a prefix of another (eng vs engineering)", () => {
    const body = buildRollup(
      "paystage/eng",
      snapshot({
        mandates: [
          { serial: "m-eng", org_unit: "paystage/eng" },
          { serial: "m-engineering", org_unit: "paystage/engineering" },
        ],
        events: {
          available: true,
          rows: [
            settled("e-eng", "m-eng", "0.100000"),
            settled("e-engineering", "m-engineering", "0.900000"),
          ],
        },
      }),
      NOW.toISOString(),
    );

    expect(body.spend_minor).toBe(100_000);
    expect(body.mandates).toBe(1);
    expect(body.descendants).toEqual([]);
  });

  it("counts a repeated event id once even when a page overlaps", () => {
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage/engineering" }],
        events: {
          available: true,
          rows: [
            settled("e-1", "m-1", "0.500000"),
            settled("e-1", "m-1", "0.500000"),
            settled("e-2", "m-1", "0.500000"),
          ],
        },
      }),
      NOW.toISOString(),
    );
    expect(body.spend_minor).toBe(1_000_000);
  });

  it("excludes testnet settlement and counts an unpriced settled row instead of pricing it at zero", () => {
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage" }],
        events: {
          available: true,
          rows: [
            settled("e-main", "m-1", "0.200000"),
            settled("e-test", "m-1", "5.000000", "eip155:84532"),
            {
              id: "e-unpriced",
              mandate_serial: "m-1",
              decision: "settled",
              amount_usdc: null,
              network: "eip155:8453",
            },
          ],
        },
      }),
      NOW.toISOString(),
    );
    expect(body.spend_minor).toBe(200_000);
    // The unpriced row is counted, not priced at zero and not printed as if the total were complete.
    expect(body.spend_unpriced_settled).toBe(1);
    expect(body.spend_unavailable_reason).toBeUndefined();
  });

  it("refuses a partial total when a settled amount cannot be parsed", () => {
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage" }],
        events: {
          available: true,
          rows: [settled("e-bad", "m-1", "0.0000001")],
        },
      }),
      NOW.toISOString(),
    );
    expect(body.spend_minor).toBe(0);
    expect(body.spend_unavailable_reason).toContain("will not price");
  });

  it("counts refusals in every network, but never in the spend total", () => {
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage" }],
        events: {
          available: true,
          rows: [refused("e-1", "m-1"), settled("e-2", "m-1", "0.100000")],
        },
      }),
      NOW.toISOString(),
    );
    expect(body.refusals).toBe(1);
    expect(body.spend_minor).toBe(100_000);
  });

  it("does not guess an unknown mandate serial into the nearest unit", () => {
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage" }],
        events: {
          available: true,
          rows: [settled("e-unknown", "m-not-stored", "9.000000"), settled("e-1", "m-1", "0.100000")],
        },
      }),
      NOW.toISOString(),
    );
    expect(body.spend_minor).toBe(100_000);
  });

  it("answers 0 with the absent-join reason when events carry no mandate serial", () => {
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage" }],
        events: {
          available: false,
          reason:
            "events carries no mandate serial: public.events has no mandate_serial column, so a settled payment cannot be joined to a mandate or to an org unit.",
        },
      }),
      NOW.toISOString(),
    );
    expect(body.spend_minor).toBe(0);
    expect(body.refusals).toBe(0);
    expect(body.mandates).toBe(1);
    expect(body.spend_unavailable_reason).toContain("no mandate_serial");
    expect(body.refusals_unavailable_reason).toContain("no mandate_serial");
  });

  it("renders minor units as an exact decimal string, never through a float", () => {
    expect(formatMinor(0)).toBe("0.000000");
    expect(formatMinor(2)).toBe("0.000002");
    expect(formatMinor(1_550_000)).toBe("1.550000");
    // A value that a float would round: 0.1 + 0.2 is exactly 300000 here.
    const body = buildRollup(
      "paystage",
      snapshot({
        mandates: [{ serial: "m-1", org_unit: "paystage" }],
        events: {
          available: true,
          rows: [settled("e-1", "m-1", "0.100000"), settled("e-2", "m-1", "0.200000")],
        },
      }),
    );
    expect(body.spend_minor).toBe(300_000);
  });
});

describe("GET /v1/public/rollup", () => {
  const env = { PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD" };

  function appWith(store: RollupStore | undefined) {
    return createApp(env, { protect: false, rollupStore: store });
  }

  it("returns the unit, its descendants and a no-store read from the store", async () => {
    const app = appWith(
      createMemoryRollupStore({
        mandates: [
          { serial: "m-root", org_unit: null },
          { serial: "m-eng", org_unit: "paystage/engineering" },
        ],
        events: [
          settled("e-root", "m-root", "0.250000"),
          settled("e-eng", "m-eng", "0.300000"),
        ],
      }),
    );

    const res = await app.request("/v1/public/rollup?unit=paystage");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(
      expect.arrayContaining([
        "as_of",
        "descendants",
        "mandates",
        "refusals",
        "spend_currency",
        "spend_minor",
        "unit",
      ]),
    );
    expect(body.unit).toBe("paystage");
    expect(body.mandates).toBe(2);
    expect(body.spend_minor).toBe(550_000);
    expect(body.refusals).toBe(0);
    expect(body.descendants).toEqual([
      { unit: "paystage/engineering", mandates: 1, spend_minor: 300_000 },
    ]);
  });

  it("treats a pre-migration table (no org_unit column) as one tenant-root row", async () => {
    // This is the production shape today: the migration is not applied, the store reports the column
    // absent, and the single real mandate is the tenant root.
    const app = appWith(
      createMemoryRollupStore({
        orgUnitColumnPresent: false,
        mandates: [{ serial: "vch_gTKNWbbue_J3AI0UNvoKow" }],
        eventsUnavailableReason:
          "events carries no mandate serial: public.events has no mandate_serial column, so a settled payment cannot be joined to a mandate or to an org unit.",
      }),
    );

    const res = await app.request("/v1/public/rollup?unit=paystage");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.unit).toBe("paystage");
    expect(body.mandates).toBe(1);
    expect(body.spend_minor).toBe(0);
    expect(body.spend_unavailable_reason).toContain("no mandate_serial");
    expect(body.refusals_unavailable_reason).toContain("no mandate_serial");
    expect(body.descendants).toEqual([]);
  });

  it("answers 400 for a missing or malformed unit rather than an empty total", async () => {
    const app = appWith(createMemoryRollupStore());

    const missing = await app.request("/v1/public/rollup");
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as Record<string, unknown>).error).toBe("rollup_unit_required");

    for (const unit of ["PayStage", "paystage/", "paystage//eng", "paystage/eng_platform"]) {
      const res = await app.request(`/v1/public/rollup?unit=${encodeURIComponent(unit)}`);
      expect(res.status, unit).toBe(400);
      expect(((await res.json()) as Record<string, unknown>).error).toBe("rollup_invalid_unit");
    }
  });

  it("answers 503, never zeros, when no store is configured", async () => {
    const app = createApp(env, { protect: false, rollupStore: undefined });
    // `undefined` falls back to the Supabase store; with no env bindings that store is itself undefined,
    // so this asserts the deployment-shaped case: no storage, no invented total.
    const res = await app.request("/v1/public/rollup?unit=paystage");
    expect(res.status).toBe(503);
    expect(((await res.json()) as Record<string, unknown>).error).toBe("rollup_source_unavailable");
  });
});

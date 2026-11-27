import { describe, expect, it, vi, afterEach } from "vitest";
import { supabaseRollupStore } from "../src/rollup-store.js";

/**
 * The Supabase read behind the roll-up (#471), without a database.
 *
 * The two behaviours that matter are schema-shape ones, not SQL: a missing `mandates.org_unit` falls
 * back to root rows, and a missing `events.mandate_serial` is reported as attribution being impossible
 * rather than as an empty list. Both are what the live project looks like before the operator applies
 * the migration, so they are pinned against the PostgREST error shape (`code: "42703"`).
 */

const env = { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "test-service-key" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("supabaseRollupStore", () => {
  it("treats a missing org_unit column as the tenant root and a missing mandate serial as unattributable", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/mandates?")) {
        if (url.includes("org_unit")) {
          return jsonResponse({ code: "42703", message: "column mandates.org_unit does not exist" }, 400);
        }
        return jsonResponse([{ serial: "vch_gTKNWbbue_J3AI0UNvoKow", state: "active" }]);
      }
      if (url.includes("/events?")) {
        return jsonResponse(
          { code: "42703", message: "column events.mandate_serial does not exist" },
          400,
        );
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const store = supabaseRollupStore(env);
    expect(store).toBeDefined();
    const snapshot = await store!.read("paystage");

    expect(snapshot.orgUnitColumnPresent).toBe(false);
    expect(snapshot.mandates).toEqual([
      { serial: "vch_gTKNWbbue_J3AI0UNvoKow", org_unit: null, state: "active" },
    ]);
    expect(snapshot.events.available).toBe(false);
    if (!snapshot.events.available) {
      expect(snapshot.events.reason).toContain("no mandate_serial column");
    }
    // The retry drops the column rather than inventing a unit for every row.
    expect(calls.some((url) => url.includes("select=serial,org_unit,state"))).toBe(true);
    expect(calls.some((url) => url.includes("select=serial,state"))).toBe(true);
    // Tenant scoping is in the query, not in memory.
    expect(
      calls
        .filter((url) => url.includes("/mandates?"))
        .every((url) => url.includes("tenant_id=eq.paystage")),
    ).toBe(true);
  });

  it("reads the attributed rows with the amount as text, so no float reaches the sum", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/mandates?")) {
        return jsonResponse([{ serial: "m-1", org_unit: "paystage/engineering", state: "active" }]);
      }
      if (url.includes("/events?")) {
        return jsonResponse([
          {
            id: "e-1",
            mandate_serial: "m-1",
            decision: "settled",
            amount_usdc: "0.250000",
            network: "eip155:8453",
          },
        ]);
      }
      throw new Error(`unexpected URL ${url}`);
    });

    const snapshot = await supabaseRollupStore(env)!.read("paystage");
    expect(snapshot.events).toEqual({
      available: true,
      rows: [
        {
          id: "e-1",
          mandate_serial: "m-1",
          decision: "settled",
          amount_usdc: "0.250000",
          network: "eip155:8453",
        },
      ],
    });
    const eventsCall = calls.find((url) => url.includes("/events?")) ?? "";
    expect(eventsCall).toContain("amount_usdc::text");
    expect(eventsCall).toContain("mandate_serial=not.is.null");
  });

  it("returns undefined when the deployment has no Supabase bindings", () => {
    expect(supabaseRollupStore({})).toBeUndefined();
  });
});

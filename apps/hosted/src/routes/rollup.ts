/**
 * `GET /v1/public/rollup?unit=…` (#471) — a unit's totals including every descendant.
 *
 * **Public and read-only, mounted before the payment gate.** The row says explicitly that there is no
 * permission model: reading a roll-up is a read, not a new paid judgement. Who may *see* a tree is a
 * later session's problem; this route does not pretend to have solved it. The unit path is scoped to one
 * tenant by its first segment, so the read cannot cross tenants.
 *
 * **Subtree, not parents.** The store returns the tenant's mandates; `buildRollup` matches `unit` and
 * `unit/…` by whole segment. `paystage/eng` never includes `paystage/engineering`.
 *
 * **Zero is not a total when attribution is absent.** `events` has no mandate serial today, so
 * `buildRollup` answers `spend_minor: 0` *with* `spend_unavailable_reason` naming the missing join.
 * The same rule applies to refusals. A surface that prints 0 without the reason is the bug this
 * contract exists to prevent.
 */

import { Hono } from "hono";
import { PROBLEMS } from "../problem.js";
import { parseOrgUnit, tenantOfUnit } from "../org-unit.js";
import { buildRollup } from "../rollup.js";
import type { RollupStore } from "../rollup-store.js";

const CACHE = { "cache-control": "no-store, max-age=0" };

function nonEmpty(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0;
}

export interface RollupRouteOptions {
  /** `undefined` means this deployment has no store; the route answers 503 rather than zeros. */
  store: RollupStore | undefined;
  now?: () => Date;
}

export function createRollupRoutes(options: RollupRouteOptions): Hono {
  const routes = new Hono();

  routes.get("/v1/public/rollup", async (c) => {
    const rawUnit = c.req.query("unit");
    if (!nonEmpty(rawUnit)) {
      return c.json(PROBLEMS.rollupUnitRequired(), 400, CACHE);
    }

    const parsed = parseOrgUnit(rawUnit);
    if (!parsed.ok) {
      return c.json(PROBLEMS.rollupInvalidUnit(parsed.reason), 400, CACHE);
    }

    if (options.store === undefined) {
      return c.json(PROBLEMS.rollupSourceUnavailable(), 503, CACHE);
    }

    const asOf = (options.now?.() ?? new Date()).toISOString();
    try {
      const snapshot = await options.store.read(tenantOfUnit(parsed.value));
      return c.json(buildRollup(parsed.value, snapshot, asOf), 200, CACHE);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "rollup_read_failed",
          unit: parsed.value,
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.rollupSourceUnavailable(), 503, CACHE);
    }
  });

  return routes;
}

/**
 * `GET /wallets/:address` — what named sources observed about one payee (#310).
 *
 * The response is the classifier's output, unchanged: labels, observations and disagreements. There is no
 * score, no trust level and no aggregated verdict, because every one of those would be a judgement the
 * observations cannot support. A label carries the source and read date it came from; a field two sources
 * disagree about stays in `disagreements` with both values.
 *
 * Empty is a real answer: an address with no rows returns empty arrays, which the page renders as
 * "no observations recorded for this address". A store that is missing or failed is a 503, never an empty
 * 200 — "we could not look" and "we looked and found nothing" are different facts.
 */

import { Hono } from "hono";
import {
  categorise,
  InvalidPayeeObservationError,
  type PayeeObservation,
} from "@paystage/policy";
import { PROBLEMS } from "../problem.js";
import {
  EVM_ADDRESS_RE,
  type PayeeObservationStore,
} from "../payee-observation-store.js";

export const PAYEE_CATEGORIES_SCHEMA = "paystage.payee-categories.v1";

export function createWalletsRoutes(store: PayeeObservationStore | undefined): Hono {
  const routes = new Hono();

  routes.get("/wallets/:address", async (c) => {
    const requested = c.req.param("address");
    if (!EVM_ADDRESS_RE.test(requested.toLowerCase())) {
      return c.json(PROBLEMS.invalidAddress(), 400);
    }

    if (store === undefined) {
      return c.json(PROBLEMS.payeeStorageNotConfigured(), 503);
    }

    const address = requested.toLowerCase();
    let rows;
    try {
      rows = await store.list(address);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          msg: "payee_observation_read_failed",
          error: error instanceof Error ? error.message : String(error),
        }),
      );
      return c.json(PROBLEMS.payeeStorageUnavailable(), 503);
    }

    let categories;
    try {
      const observations: PayeeObservation[] = rows.map((row) => ({
        source: row.source,
        observed_at: row.observed_at,
        field: row.field,
        value: row.value,
      })) as unknown as PayeeObservation[];
      categories = categorise(observations);
    } catch (error) {
      // A corrupt row is an outage, not an unobserved field. Dropping it would quietly turn a fact into
      // an absence, which is the failure this whole module is built to prevent.
      console.log(
        JSON.stringify({
          level: "error",
          msg: "payee_observation_corrupt",
          error:
            error instanceof InvalidPayeeObservationError
              ? error.message
              : error instanceof Error
                ? error.message
                : String(error),
        }),
      );
      return c.json(PROBLEMS.payeeStoreCorrupt(), 503);
    }

    return c.json(
      {
        schema: PAYEE_CATEGORIES_SCHEMA,
        address,
        labels: categories.labels,
        observations: categories.observations,
        disagreements: categories.disagreements,
      },
      200,
      {
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "x-paystage-observation-count": String(categories.observations.length),
      },
    );
  });

  return routes;
}

/**
 * The store behind `GET /v1/public/rollup` (#471).
 *
 * Two reads, both server-side with the service role:
 *
 *  1. every mandate for the tenant, with `org_unit` when the migration is applied;
 *  2. the event rows that carry a mandate attribution, when such a column exists.
 *
 * The second read is the honest part. `public.events` has no `mandate_serial` today, so the select is
 * attempted and a `42703` (undefined column) becomes `{ available: false, reason }` rather than an empty
 * list. An empty list would mean "no settled payments carried an attribution"; an absent column means
 * "attribution is impossible", and the endpoint's `spend_unavailable_reason` says which one happened.
 *
 * The same tolerance covers `mandates.org_unit` before the operator applies the migration: the read is
 * retried without the column and every row is treated as the tenant root. That makes the endpoint
 * usable — and its zeroes explained — in the window between deploying the code and applying SQL.
 *
 * Reads are paged. PostgREST's max-rows would otherwise truncate a busy tenant's rows and turn a page
 * limit into a wrong total.
 */

import {
  SPEND_UNAVAILABLE_NO_MANDATE_SERIAL,
  type RollupEventRead,
  type RollupEventRow,
  type RollupMandateRow,
  type RollupSnapshot,
} from "./rollup.js";

export interface RollupStorageEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export interface RollupStore {
  /** Read one tenant's mandates and attribution-capable events. Throws only for an outage. */
  read(tenantId: string): Promise<RollupSnapshot>;
}

function nonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    Accept: "application/json",
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** PostgREST's "column does not exist". The body is read only to classify, never logged. */
async function isUndefinedColumn(res: Response): Promise<boolean> {
  if (res.status !== 400) return false;
  try {
    const body: unknown = await res.json();
    return isRecord(body) && body.code === "42703";
  } catch {
    return false;
  }
}

const PAGE_SIZE = 1000;
/** A roll-up is a read; this bounds a runaway tenant rather than returning a partial total. */
const MAX_EVENT_ROWS = 100_000;

/**
 * One page of attributed events, plus whether the column exists.
 *
 * A missing column is a property of the schema, not of this request, so the first page decides it and
 * the caller stops there.
 */
async function readEvents(endpoint: string, key: string): Promise<RollupEventRead> {
  const rows: RollupEventRow[] = [];

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const query =
      "?select=id,mandate_serial,amount_usdc::text,decision,network" +
      "&decision=in.(settled,do_not_pay)" +
      "&mandate_serial=not.is.null" +
      // `id` breaks ties so offset pagination cannot repeat or skip a row.
      "&order=id.asc" +
      `&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(`${endpoint}/events${query}`, { headers: headers(key) });

    if (!res.ok) {
      if (await isUndefinedColumn(res)) {
        return { available: false, reason: SPEND_UNAVAILABLE_NO_MANDATE_SERIAL };
      }
      throw new Error(`rollup event read failed (HTTP ${res.status})`);
    }

    const page = (await res.json()) as unknown;
    if (!Array.isArray(page)) throw new Error("rollup event read returned a non-array body");
    for (const raw of page) {
      if (!isRecord(raw)) throw new Error("rollup event row is not an object");
      if (typeof raw.id !== "string" || raw.id === "") throw new Error("rollup event row has no id");
      if (typeof raw.mandate_serial !== "string" || raw.mandate_serial === "") {
        // The filter should make this impossible; a null serial is not an attribution.
        continue;
      }
      if (typeof raw.decision !== "string") throw new Error("rollup event row has no decision");
      const amount = raw.amount_usdc;
      if (amount !== null && typeof amount !== "string" && typeof amount !== "number") {
        throw new Error("rollup event row has a non-text amount_usdc");
      }
      rows.push({
        id: raw.id,
        mandate_serial: raw.mandate_serial,
        decision: raw.decision,
        // `amount_usdc::text` is a string, but tolerate a number by stringifying it exactly; it never
        // reaches a float sum because `decimalToMinor` parses the text.
        amount_usdc: amount === null || amount === undefined ? null : String(amount),
        network: typeof raw.network === "string" ? raw.network : null,
      });
    }
    if (rows.length > MAX_EVENT_ROWS) {
      throw new Error(`rollup event read exceeds ${MAX_EVENT_ROWS} rows`);
    }
    if (page.length < PAGE_SIZE) return { available: true, rows };
  }
}

async function readMandates(
  endpoint: string,
  key: string,
  tenantId: string,
): Promise<{ rows: RollupMandateRow[]; orgUnitColumnPresent: boolean }> {
  const tenant = `tenant_id=eq.${encodeURIComponent(tenantId)}`;
  const withColumn = `?${tenant}&select=serial,org_unit,state&order=serial.asc&limit=${PAGE_SIZE}`;

  let orgUnitColumnPresent = true;
  let res = await fetch(`${endpoint}/mandates${withColumn}`, { headers: headers(key) });

  if (!res.ok) {
    if (!(await isUndefinedColumn(res))) throw new Error(`rollup mandate read failed (HTTP ${res.status})`);
    // The migration has not been applied. Read what exists and treat every row as the tenant root.
    orgUnitColumnPresent = false;
    const withoutColumn = `?${tenant}&select=serial,state&order=serial.asc&limit=${PAGE_SIZE}`;
    res = await fetch(`${endpoint}/mandates${withoutColumn}`, { headers: headers(key) });
    if (!res.ok) throw new Error(`rollup mandate read failed (HTTP ${res.status})`);
  }

  const rows: RollupMandateRow[] = [];
  const select = orgUnitColumnPresent ? "serial,org_unit,state" : "serial,state";

  // Page until a short page. PostgREST's max-rows would otherwise cap the count at the project setting
  // and make a truncation look like a complete division.
  for (let offset = 0; ; offset += PAGE_SIZE) {
    if (offset > 0) {
      const query = `?${tenant}&select=${select}&order=serial.asc&limit=${PAGE_SIZE}&offset=${offset}`;
      res = await fetch(`${endpoint}/mandates${query}`, { headers: headers(key) });
      if (!res.ok) throw new Error(`rollup mandate read failed (HTTP ${res.status})`);
    }

    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) throw new Error("rollup mandate read returned a non-array body");
    for (const raw of body) {
      if (!isRecord(raw)) throw new Error("rollup mandate row is not an object");
      if (typeof raw.serial !== "string" || raw.serial === "") {
        throw new Error("rollup mandate row has no serial");
      }
      rows.push({
        serial: raw.serial,
        org_unit: typeof raw.org_unit === "string" && raw.org_unit !== "" ? raw.org_unit : null,
        state: typeof raw.state === "string" ? raw.state : undefined,
      });
    }
    if (body.length < PAGE_SIZE) break;
  }
  return { rows, orgUnitColumnPresent };
}

/** A Supabase REST-backed store, or undefined when this deployment has no storage configured. */
export function supabaseRollupStore(env: RollupStorageEnv): RollupStore | undefined {
  const rawUrl = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!nonEmpty(rawUrl) || !nonEmpty(key)) return undefined;
  const endpoint = `${rawUrl.replace(/\/+$/, "")}/rest/v1`;

  return {
    async read(tenantId: string): Promise<RollupSnapshot> {
      // Both reads are independent; a slow events read must not make the mandate count later.
      const [mandates, events] = await Promise.all([
        readMandates(endpoint, key, tenantId),
        readEvents(endpoint, key),
      ]);
      return {
        mandates: mandates.rows,
        orgUnitColumnPresent: mandates.orgUnitColumnPresent,
        events,
      };
    },
  };
}

/**
 * In-memory store for tests and local wiring checks. It exercises the same aggregation as the route;
 * the only thing it does not prove is PostgREST's column detection, which `rollup-store.test.ts`
 * pins separately against the query text and the `42703` shape.
 */
export function createMemoryRollupStore(input: {
  mandates?: RollupMandateRow[];
  events?: RollupEventRow[];
  eventsUnavailableReason?: string | null;
  orgUnitColumnPresent?: boolean;
} = {}): RollupStore {
  return {
    async read(): Promise<RollupSnapshot> {
      return {
        mandates: input.mandates ?? [],
        orgUnitColumnPresent: input.orgUnitColumnPresent ?? true,
        events:
          input.eventsUnavailableReason === null || input.eventsUnavailableReason === undefined
            ? { available: true, rows: input.events ?? [] }
            : {
                available: false,
                reason: input.eventsUnavailableReason || SPEND_UNAVAILABLE_NO_MANDATE_SERIAL,
              },
      };
    },
  };
}

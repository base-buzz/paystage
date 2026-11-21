/**
 * Read side for payee observations (#310).
 *
 * The classifier in `@paystage/policy` is pure and takes observations; this module is the only place
 * that knows where stored observations live. It is deliberately read-only: collecting a wallet's code,
 * age, activity, holdings and flags is a separate job (recorded as a follow-up), and putting a collector
 * inside the route would make the endpoint fetch the network and invent freshness it does not have.
 *
 * A row is one source's observation of one field at one time. `value` is JSON because the fields are
 * deliberately different types (booleans, counts, dates, an asset name), and flattening them into a
 * single number is exactly the aggregate this item forbids.
 *
 * Storage is server-side only: `payee_observations` has RLS enabled with no policy, like probe_runs.
 */

export interface PayeeObservationRow {
  /** Which source said it, e.g. "base-rpc eth_getCode" or "GoPlus address_security". */
  source: string;
  /** When the source was read. ISO 8601 from the collector. */
  observed_at: string;
  /** One of the fields the classifier recognises. */
  field: string;
  /** The observed value, in the shape that field defines. */
  value: unknown;
}

export interface PayeeObservationStore {
  /** Rows for one canonical (lowercase) address. An empty array is a real answer; a throw is not. */
  list(address: string): Promise<PayeeObservationRow[]>;
}

export interface PayeeObservationStorageEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

/** CAIP-agnostic EVM address. The route validates too; this is the store's last guard before a query. */
export const EVM_ADDRESS_RE = /^0x[0-9a-f]{40}$/;

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

/** A Supabase REST-backed read store, or undefined when this deployment has no storage configured. */
export function supabasePayeeObservationStore(
  env: PayeeObservationStorageEnv,
): PayeeObservationStore | undefined {
  const rawUrl = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!nonEmpty(rawUrl) || !nonEmpty(key)) return undefined;
  const endpoint = `${rawUrl.replace(/\/+$/, "")}/rest/v1/payee_observations`;

  return {
    async list(address: string): Promise<PayeeObservationRow[]> {
      const normalised = address.toLowerCase();
      if (!EVM_ADDRESS_RE.test(normalised)) return [];
      const query =
        `?address=eq.${encodeURIComponent(normalised)}` +
        "&select=source,observed_at,field,value" +
        "&order=observed_at.asc,source.asc,field.asc" +
        "&limit=1000";
      const res = await fetch(`${endpoint}${query}`, {
        headers: { ...headers(key), Prefer: "count=none" },
      });
      if (!res.ok) {
        // Status only: a PostgREST error body can echo row values, and this route is public.
        throw new Error(`payee observation read failed (HTTP ${res.status})`);
      }
      const rows = (await res.json()) as unknown;
      if (!Array.isArray(rows)) {
        throw new Error("payee observation read returned a non-array body");
      }
      return rows as PayeeObservationRow[];
    },
  };
}

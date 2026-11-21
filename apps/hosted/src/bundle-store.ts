/**
 * Persistence for evidence bundles (#308).
 *
 * The bundle is built in memory from the evaluator's own result; this module only stores
 * and retrieves the four artefacts. It is deliberately thin: no ORM, no client SDK, one
 * table named in a committed migration. If the table or the credentials are absent, the
 * read route says so instead of returning an empty bundle.
 *
 * Storage is server-side only. `evidence_bundles` has RLS enabled with no policy, like
 * `probe_runs`: the anon key reads zero rows, the service role is the only reader and
 * writer. A bundle contains a caller's policy and payment terms, which are not public.
 */

export interface BundleRecord {
  id: string;
  decision: string;
  events: string;
  proof: string;
  receipt: string | null;
  summary: string;
}

export interface StoredBundle extends BundleRecord {
  created_at?: string;
}

export interface BundleStore {
  put(bundle: BundleRecord): Promise<void>;
  /** Null means "no row with this id"; a thrown error means storage failed. */
  get(id: string): Promise<StoredBundle | null>;
}

export interface BundleStorageEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

export const BUNDLE_ID_RE = /^[0-9a-f]{64}$/;

/**
 * Hono context key for the injected store.
 *
 * A named constant rather than a literal at each call site: `scripts/check-route-docs.mjs`
 * scans every `.get("<string>")` in a route file and treats it as a path, and a context
 * read that looks like a route makes the route inventory lie.
 */
export const BUNDLE_STORE_VAR = "bundleStore";

function nonEmpty(value: string | undefined | null): value is string {
  return typeof value === "string" && value.length > 0;
}

function headers(key: string): Record<string, string> {
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

/** A Supabase REST-backed store, or undefined when this deployment has no storage configured. */
export function supabaseBundleStore(env: BundleStorageEnv): BundleStore | undefined {
  const rawUrl = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!nonEmpty(rawUrl) || !nonEmpty(key)) return undefined;
  const base = rawUrl.replace(/\/+$/, "");
  const endpoint = `${base}/rest/v1/evidence_bundles`;

  return {
    async put(bundle: BundleRecord): Promise<void> {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { ...headers(key), Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          id: bundle.id,
          decision: bundle.decision,
          events: bundle.events,
          proof: bundle.proof,
          receipt: bundle.receipt,
          summary: bundle.summary,
        }),
      });
      if (!res.ok) {
        // Status only: a PostgREST error body can echo column names and values from the
        // row, and this one contains a caller's policy.
        throw new Error(`evidence bundle write failed (HTTP ${res.status})`);
      }
    },

    async get(id: string): Promise<StoredBundle | null> {
      if (!BUNDLE_ID_RE.test(id)) return null;
      const query =
        `?id=eq.${id}` +
        "&select=id,decision,events,proof,receipt,summary,created_at&limit=1";
      const res = await fetch(`${endpoint}${query}`, {
        headers: { ...headers(key), Prefer: "count=none" },
      });
      if (!res.ok) {
        throw new Error(`evidence bundle read failed (HTTP ${res.status})`);
      }
      const rows = (await res.json()) as StoredBundle[];
      return Array.isArray(rows) && rows.length > 0 ? (rows[0] as StoredBundle) : null;
    },
  };
}

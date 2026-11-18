import "server-only";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

export function isSupabaseConfigured(): boolean {
  return Boolean(SUPABASE_URL && (SERVICE_KEY || ANON_KEY));
}

function authKey(): string {
  return SERVICE_KEY || ANON_KEY;
}

/**
 * Minimal PostgREST select helper. Returns null when Supabase is not
 * configured or the request fails, so callers can render empty states.
 */
export async function selectRows<T>(
  table: string,
  query: string,
): Promise<T[] | null> {
  if (!isSupabaseConfigured()) return null;
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  try {
    const res = await fetch(url, {
      headers: {
        apikey: authKey(),
        Authorization: `Bearer ${authKey()}`,
        Accept: "application/json",
      },
      cache: "no-store",
    });
    if (!res.ok) return null;
    return (await res.json()) as T[];
  } catch {
    return null;
  }
}

/**
 * A select that says **why** it could not read, for surfaces where "no rows" and "no permission" are different facts.
 *
 * `selectRows` collapses every failure to `null`, which is right for a preferences panel — it falls back to defaults.
 * It is wrong for `/lab`: `probe_runs` has RLS on with no policy, so a read with the anon key returns zero rows and the
 * page would render "Never run" — a truthful-looking lie about a probe that may have run every day for a month.
 *
 * The failure mode this exists for is silent: `authKey()` prefers the service key but falls back to the anon key, so an
 * environment missing the service key reads as "no data" rather than "misconfigured" unless something distinguishes
 * them. This does.
 */
export type SelectResult<T> =
  | { ok: true; rows: T[] }
  | { ok: false; reason: "not_configured" | "no_service_key" | "forbidden" | "unreachable"; status?: number };

export async function selectRowsStrict<T>(table: string, query: string): Promise<SelectResult<T>> {
  if (!SUPABASE_URL) return { ok: false, reason: "not_configured" };
  // Refuse the anon-key fallback rather than silently reading zero rows from an RLS-protected table.
  if (!SERVICE_KEY) return { ok: false, reason: "no_service_key" };

  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?${query}`;
  try {
    const res = await fetch(url, {
      headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: "application/json" },
      cache: "no-store",
    });
    if (res.status === 401 || res.status === 403) return { ok: false, reason: "forbidden", status: res.status };
    if (!res.ok) return { ok: false, reason: "unreachable", status: res.status };
    return { ok: true, rows: (await res.json()) as T[] };
  } catch {
    return { ok: false, reason: "unreachable" };
  }
}

/**
 * Upsert one row, keyed by `conflictColumn`./**
 * Upsert one row, keyed by `conflictColumn`. Used by preferences (#173), the only table this site writes
 * on a human's behalf — and only after they signed in for it.
 */
export async function upsertRow<T>(
  table: string,
  row: Record<string, unknown>,
  conflictColumn: string,
): Promise<T | null> {
  if (!isSupabaseConfigured() || !SERVICE_KEY) return null;
  const url = `${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/${table}?on_conflict=${conflictColumn}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(row),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as T[];
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

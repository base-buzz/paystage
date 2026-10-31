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

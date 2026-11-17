import { NextResponse } from "next/server";
import { SIWE_SESSION_COOKIE, open } from "@/lib/siwe/session";
import { isSupabaseConfigured, selectRows, upsertRow } from "@/lib/supabase";
import { parsePrefs, type Prefs } from "@/lib/prefs";

/**
 * Optional preference sync (#173). Read and write one row, for the wallet that signed in.
 *
 * The address comes **only** from the SIWE session cookie — never from the request body, which is how
 * every "sync my settings" endpoint gets compromised. Sign-in is never required to use the site; if a
 * caller has no session this answers 401 and the page carries on with localStorage, which is the whole
 * feature for most people.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "cache-control": "no-store" } as const;

interface PrefRow {
  address: string;
  theme: Prefs["theme"];
  language: Prefs["language"];
  updated_at: string;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get("cookie");
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    if (key === name) return decodeURIComponent(part.slice(idx + 1).trim());
  }
  return undefined;
}

async function sessionAddress(req: Request): Promise<string | null> {
  const token = readCookie(req, SIWE_SESSION_COOKIE);
  if (!token) return null;
  const opened = await open(token);
  if (!opened) return null;
  const address = opened.payload;
  return /^0x[0-9a-fA-F]{40}$/.test(address) ? address.toLowerCase() : null;
}

export async function GET(req: Request) {
  const address = await sessionAddress(req);
  if (!address) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (!isSupabaseConfigured()) {
    // Configured-ness is a deployment fact, not a user error: say so instead of pretending there is no row.
    return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });
  }

  const rows = await selectRows<PrefRow>(
    "preferences",
    `select=theme,language,updated_at&address=eq.${encodeURIComponent(address)}&limit=1`,
  );
  if (rows === null) return NextResponse.json({ error: "unreadable" }, { status: 503, headers: NO_STORE });
  if (rows.length === 0) return NextResponse.json({ prefs: null }, { headers: NO_STORE });

  const row = rows[0]!;
  return NextResponse.json(
    { prefs: { theme: row.theme, language: row.language }, updated_at: row.updated_at },
    { headers: NO_STORE },
  );
}

export async function PUT(req: Request) {
  const address = await sessionAddress(req);
  if (!address) return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  if (!isSupabaseConfigured()) return NextResponse.json({ error: "not_configured" }, { status: 503, headers: NO_STORE });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400, headers: NO_STORE });
  }

  const prefs = parsePrefs(body);
  if (!prefs) {
    // A rejected body is a 400, never a coerced default — "your settings were saved" must mean saved.
    return NextResponse.json({ error: "invalid_prefs" }, { status: 400, headers: NO_STORE });
  }

  const saved = await upsertRow<PrefRow>(
    "preferences",
    { address, theme: prefs.theme, language: prefs.language, updated_at: new Date().toISOString() },
    "address",
  );
  if (!saved) return NextResponse.json({ error: "unwritable" }, { status: 503, headers: NO_STORE });

  return NextResponse.json(
    { prefs: { theme: saved.theme, language: saved.language }, updated_at: saved.updated_at },
    { headers: NO_STORE },
  );
}

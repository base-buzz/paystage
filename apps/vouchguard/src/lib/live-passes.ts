/**
 * Real mandate records, read live (#456).
 *
 * The dashboard used to render two hard-coded fixtures while a real minted mandate existed elsewhere — two answers to
 * the same question. This reads `GET /v1/mandate/:serial` for the serials the operator configured, at request time.
 *
 * Three rules, each learned the hard way elsewhere in this project:
 *   1. **never fall back to a fixture.** A demo that silently shows a prettier past is worse than one that says it could
 *      not read. Unreachable → a named error state, not the old data.
 *   2. **no scanning.** The serials come from config, not from listing the table: a dashboard that discovers tenants is a
 *      dashboard that leaks them.
 *   3. **the fetch time is part of the answer.** "active" without "as of when" is a claim about the past dressed as the
 *      present.
 */
import brand from "../../../../brand.json";

export type LiveStatus = "active" | "revoked" | "expired" | "unknown";

export interface LivePass {
  serial: string;
  status: LiveStatus;
  principal: string | null;
  perPayment: string | null;
  windowAmount: string | null;
  windowLabel: string;
  expiresAt: string | null;
  verdictForSeller: string | null;
}

export interface LivePassesResult {
  passes: LivePass[];
  /** When the API answered, ISO. Present even when `error` is set — the failure has a time too. */
  fetchedAt: string;
  /** A named failure, in the words the page will show. `null` when every fetch answered. */
  error: string | null;
}

const API_BASE = (brand as { apiBase?: string }).apiBase ?? "https://api.paystage.xyz";
const SERIALS = ((brand as { demoSerials?: string[] }).demoSerials ?? []).filter(Boolean);

/** Seconds, because a dashboard may be open all day and a mandate's state can change under it. */
const REVALIDATE = 30;

function windowLabel(seconds: number): string {
  if (seconds % 86400 === 0) return `per ${seconds / 86400}d`;
  if (seconds % 3600 === 0) return `per ${seconds / 3600}h`;
  return `per ${seconds}s`;
}

async function one(serial: string): Promise<LivePass | { serial: string; error: string }> {
  try {
    const res = await fetch(`${API_BASE}/v1/mandate/${encodeURIComponent(serial)}`, {
      next: { revalidate: REVALIDATE },
      headers: { accept: "application/json" },
    });
    if (!res.ok) return { serial, error: `the API answered ${res.status}` };
    const body = (await res.json()) as {
      status?: LiveStatus;
      principal?: { display?: string } | null;
      scope?: { per_payment?: string; window_amount?: string; window_seconds?: number; expires_at?: string } | null;
      verdict_for_seller?: string | null;
    };
    return {
      serial,
      status: body.status ?? "unknown",
      principal: body.principal?.display ?? null,
      perPayment: body.scope?.per_payment ?? null,
      windowAmount: body.scope?.window_amount ?? null,
      windowLabel: body.scope?.window_seconds ? windowLabel(body.scope.window_seconds) : "",
      expiresAt: body.scope?.expires_at ?? null,
      verdictForSeller: body.verdict_for_seller ?? null,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message.split("\n")[0] : "unknown error";
    return { serial, error: `could not reach the API (${reason})` };
  }
}

export async function getLivePasses(): Promise<LivePassesResult> {
  const fetchedAt = new Date().toISOString();
  if (SERIALS.length === 0) {
    return { passes: [], fetchedAt, error: "no serials are configured for this dashboard (brand.json → demoSerials)" };
  }
  const results = await Promise.all(SERIALS.map(one));
  const failures = results.filter((r): r is { serial: string; error: string } => "error" in r);
  if (failures.length > 0) {
    return {
      passes: [],
      fetchedAt,
      error: `${failures.length} of ${results.length} could not be read — ${failures.map((f) => `${f.serial}: ${f.error}`).join("; ")}`,
    };
  }
  return { passes: results as LivePass[], fetchedAt, error: null };
}

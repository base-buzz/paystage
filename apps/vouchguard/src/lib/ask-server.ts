/**
 * The counted question on the brand site (#511) — the server half.
 *
 * Only this module touches a Supabase key. It is imported by the route and the page, never by the
 * client component, so the anon key is not swept into the browser bundle by `NEXT_PUBLIC_*` inlining.
 *
 * Two rules shape it:
 *
 *  1. **A count is only ever the one the database returned.** Every failure path returns `stored: false`
 *     with a reason and no count. The page can then say the counter is not connected rather than render
 *     a plausible `0` that nobody measured.
 *  2. **The answer is write-only.** The route calls one security-definer function (`ask_answer`) with the
 *     anon key; it never selects from the table, and the table has no anon grant. The IP address exists
 *     only for the length of a hash: the route sends a salted SHA-256, and the unique (ip_hash, day) index
 *     is what enforces one answer per address per day.
 */

import { ASK_ANSWERS, NOT_CONNECTED, QUESTION_OPENED } from "./ask-survey.ts";
import type { AskAnswer, AskSnapshot } from "./ask-survey.ts";

const MAX_TEXT = 500;
const HASH_PATTERN = /^[0-9a-f]{64}$/;

export interface AskEnv {
  [name: string]: string | undefined;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, MAX_TEXT);
}

function isAnswer(value: unknown): value is AskAnswer {
  return typeof value === "string" && (ASK_ANSWERS as readonly string[]).includes(value);
}

/** Only a JSON number the database returned; a string or an error body is not a count. */
function positiveInt(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

/**
 * The Worker's environment.
 *
 * `process.env` is populated from bindings on the Cloudflare runtime with `nodejs_compat`, and it is
 * where a local `next start` gets its `.env`. Reading the OpenNext context as well makes this work even
 * when a binding is not mirrored into `process.env`; outside the Worker (tests, a plain node process)
 * the call throws and the `process.env` values stand. No key is ever logged or sent to a client.
 */
async function runtimeEnv(): Promise<AskEnv> {
  const merged: AskEnv = { ...process.env };
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    for (const [name, value] of Object.entries(env as unknown as Record<string, unknown>)) {
      if (typeof value === "string") merged[name] = value;
    }
  } catch {
    // Plain Node, a unit test, or a build-time render: process.env is all there is.
  }
  return merged;
}

/** `SUPABASE_URL` plus a publishable key. `SURVEY_*` wins so the brand site's settings are explicit. */
function supabaseConfig(env: AskEnv): { url: string; key: string } | null {
  const url = (env.SURVEY_SUPABASE_URL ?? env.SUPABASE_URL ?? env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  const key =
    env.SURVEY_SUPABASE_ANON_KEY ?? env.SUPABASE_ANON_KEY ?? env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
  return url && key ? { url, key } : null;
}

/**
 * A service-role key must never be used on a public Worker path. The anon key is safe here because the
 * table has no anon grant and the write goes through a security-definer function, but a service-role
 * key would make every one of those barriers irrelevant. Refuse it by name of the role it carries.
 */
function isServiceRoleKey(key: string): boolean {
  const parts = key.split(".");
  if (parts.length !== 3) return false;
  try {
    const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
    const payload = JSON.parse(atob(padded)) as { role?: unknown };
    return payload.role === "service_role";
  } catch {
    return false;
  }
}

/** The salt is required: an unsalted hash of an address is reversible by enumeration. */
function ipSalt(env: AskEnv): string | null {
  const salt = env.SURVEY_IP_SALT ?? "";
  return salt.length > 0 ? salt : null;
}

/** Lower-case SHA-256 over `salt:address`. The address itself never leaves this function. */
export async function hashIp(ip: string, salt: string, cryptoImpl: Crypto = globalThis.crypto): Promise<string> {
  if (!ip) throw new Error("hashIp: an address is required");
  if (!salt) throw new Error("hashIp: a salt is required");
  const bytes = new TextEncoder().encode(`${salt}:${ip}`);
  const digest = await cryptoImpl.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The address as the edge saw it. Cloudflare sets `cf-connecting-ip`; the rest are a local fallback. */
export function clientAddress(request: Request, explicit?: string | null): string | null {
  if (explicit) return explicit.trim() || null;
  const cf = request.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = request.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || null;
}

function reasonFromRpcFailure(status: number, payload: unknown): string {
  const body = payload as { code?: string; message?: string } | null;
  if (
    status === 404 ||
    body?.code === "PGRST202" ||
    /could not find the function|does not exist|schema cache/i.test(body?.message ?? "")
  ) {
    return NOT_CONNECTED;
  }
  return `the counter answered ${status}`;
}

async function callRpc(
  config: { url: string; key: string },
  fn: string,
  body: unknown,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; status: number; rows: unknown }> {
  try {
    const response = await fetchImpl(`${config.url}/rest/v1/rpc/${fn}`, {
      method: "POST",
      headers: {
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    const payload = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, rows: payload };
  } catch {
    return { ok: false, status: 0, rows: null };
  }
}

function firstRow(payload: unknown): Record<string, unknown> | null {
  if (Array.isArray(payload)) return (payload[0] as Record<string, unknown> | undefined) ?? null;
  if (payload && typeof payload === "object") return payload as Record<string, unknown>;
  return null;
}

/**
 * Handle `POST /api/ask`.
 *
 * Contract:
 *   body    { answer: "yes" | "no" | "already", page?: string, referrer?: string }
 *   200     { stored: true, count: number, openedOn: string | null }
 *   200     { stored: false, reason: string }        (missing table/function, missing config, repeat, no address)
 *   400     { stored: false, reason: string }        (invalid JSON or answer)
 *
 * A 200 with `stored: false` is deliberate for infrastructure absences: the page can say so plainly, and a
 * caller that retries after the operator applies the migration does not need a code change.
 */
export async function handleAsk(
  request: Request,
  options: {
    env?: AskEnv;
    fetchImpl?: FetchLike;
    cryptoImpl?: Crypto;
    clientIp?: string | null;
  } = {},
): Promise<Response> {
  const env = options.env ?? (await runtimeEnv());
  const fetchImpl = options.fetchImpl ?? fetch;

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body || typeof body !== "object") {
    return json({ stored: false, reason: "the request body is not a JSON object" }, 400);
  }

  const answer = body.answer;
  if (!isAnswer(answer)) {
    return json({ stored: false, reason: "answer must be yes, no or already" }, 400);
  }

  const config = supabaseConfig(env);
  if (!config) {
    return json({ stored: false, reason: NOT_CONNECTED });
  }
  if (isServiceRoleKey(config.key)) {
    return json({ stored: false, reason: "the configured key is a service-role key; refusing to use it" });
  }

  const salt = ipSalt(env);
  if (!salt) {
    return json({ stored: false, reason: "the IP hashing secret is not configured" });
  }

  const address = clientAddress(request, options.clientIp);
  if (!address) {
    return json({ stored: false, reason: "the request carried no client address" });
  }

  let ipHash: string;
  try {
    ipHash = await hashIp(address, salt, options.cryptoImpl);
  } catch {
    return json({ stored: false, reason: "the client address could not be hashed" });
  }
  if (!HASH_PATTERN.test(ipHash)) {
    return json({ stored: false, reason: "the client address could not be hashed" });
  }

  const page = cleanText(body.page) ?? "/ask";
  const referrer = cleanText(body.referrer) ?? cleanText(request.headers.get("referer"));

  const result = await callRpc(
    config,
    "ask_answer",
    { p_answer: answer, p_page: page, p_referrer: referrer, p_ip_hash: ipHash },
    fetchImpl,
  );

  if (!result.ok) {
    const reason = reasonFromRpcFailure(result.status, result.rows);
    return json({ stored: false, reason });
  }

  const row = firstRow(result.rows);
  if (!row || typeof row.stored !== "boolean") {
    return json({ stored: false, reason: "the counter returned an unrecognised answer" });
  }

  if (!row.stored) {
    return json({ stored: false, reason: "one answer per address per day" });
  }

  // The only place a count is put in a success response: the value read back from the database.
  const count = positiveInt(row.response_count);
  if (count === null) {
    return json({ stored: false, reason: "the counter did not return a count" });
  }

  return json({ stored: true, count, openedOn: typeof row.opened_on === "string" ? row.opened_on : null });
}

/** Read the count for the first render. Never invents a count when ask_count() is missing or unreachable. */
export async function readAskSnapshot(
  options: { env?: AskEnv; fetchImpl?: FetchLike } = {},
): Promise<AskSnapshot> {
  const env = options.env ?? (await runtimeEnv());
  const fetchImpl = options.fetchImpl ?? fetch;
  const fallback: AskSnapshot = {
    connected: false,
    count: null,
    openedOn: QUESTION_OPENED,
    reason: NOT_CONNECTED,
  };

  const config = supabaseConfig(env);
  if (!config) return fallback;
  if (isServiceRoleKey(config.key)) {
    return { ...fallback, reason: "the configured key is a service-role key; refusing to use it" };
  }

  const result = await callRpc(config, "ask_count", {}, fetchImpl);
  if (!result.ok) return fallback;

  const row = firstRow(result.rows);
  const count = positiveInt(row?.response_count);
  if (count === null) return fallback;

  return {
    connected: true,
    count,
    openedOn: typeof row?.opened_on === "string" ? row.opened_on : QUESTION_OPENED,
    reason: null,
  };
}

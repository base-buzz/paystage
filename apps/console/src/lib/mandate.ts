/**
 * Read-side model for `/m/:serial` (#436) — the HTML page a phone camera opens from the QR.
 *
 * The page renders the hosted `GET /v1/mandate/:serial` answer; it does not keep its own copy of a
 * mandate. One endpoint, one truth: if the endpoint says `unknown`, the page says `unknown` and not an
 * error, because no mandate store exists yet and "not on record" is a complete, actionable answer.
 *
 * The boundary this file protects is the one the proposal names in §7: **only what the endpoint
 * returns goes on the page.** No payee list, no spend history, no agent address, no refusals. The
 * parser below drops unknown fields rather than passing them through, so a future endpoint addition
 * cannot leak onto a counterparty's screen by accident.
 */

/** Same width as `apps/hosted/src/routes/mandate.ts`, deliberately: the page must refuse exactly the
 * serials the endpoint refuses. `vch-` is the three-character short code the pass face carries; the
 * full serial is `vch_` plus at least 22 URL-safe characters (128 bits). A mirror that drifts is a
 * page that fetches a URL the endpoint rejects with 400, so a test reads the hosted source and
 * compares the two patterns. */
export const MANDATE_SERIAL_RE = /^(?:vch-[A-Za-z0-9]{3}|vch_[A-Za-z0-9_-]{22,64})$/;

export type MandateStatus = "active" | "revoked" | "expired" | "unknown";

export interface MandateScope {
  per_payment: string;
  window_amount: string;
  window_seconds: number;
  expires_at: string;
}

export interface MandatePrincipal {
  display: string;
  assertion: "self";
}

/** The subset of the endpoint's body this page renders. Extra response fields are not represented. */
export interface MandatePayload {
  serial: string;
  status: MandateStatus;
  scope: MandateScope | null;
  principal: MandatePrincipal | null;
  as_of: string;
}

/**
 * What the status word means to someone deciding whether to trust a stranger's phone.
 *
 * These are the four states the endpoint can answer. The wording is the page's whole safety story:
 * every non-active state says "do not trust" in the same breath as the state.
 */
export const STATUS_COPY: Record<MandateStatus, { word: string; meaning: string }> = {
  active: { word: "active", meaning: "in force" },
  revoked: { word: "revoked", meaning: "ended — do not trust" },
  expired: { word: "expired", meaning: "out of date — do not trust" },
  unknown: { word: "unknown", meaning: "not on record — do not trust this pass" },
};

/** The answer to an unreadable record. Never rendered as `unknown`: "could not check" is not "no such mandate". */
export type MandateRead =
  | { kind: "record"; payload: MandatePayload; apiBase: string }
  | { kind: "unreadable"; serial: string; reason: string; apiBase: string };

/** Default hosted API. Public, read-only, and no credential is ever sent here. */
export const DEFAULT_MANDATE_API = "https://api.paystage.xyz";

export function mandateApiBase(env: NodeJS.ProcessEnv = process.env): string {
  return (env.PAYSTAGE_API || DEFAULT_MANDATE_API).replace(/\/+$/, "");
}

/** The JSON representation a machine should fetch. The HTML page links to it; the QR does not point at it. */
export function mandateJsonUrl(serial: string, apiBase: string = DEFAULT_MANDATE_API): string {
  return `${apiBase.replace(/\/+$/, "")}/v1/mandate/${encodeURIComponent(serial)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStatus(value: unknown): value is MandateStatus {
  return value === "active" || value === "revoked" || value === "expired" || value === "unknown";
}

function parseScope(value: unknown): MandateScope | null {
  if (!isRecord(value)) return null;
  const { per_payment, window_amount, window_seconds, expires_at } = value;
  if (typeof per_payment !== "string" || per_payment.trim() === "") return null;
  if (typeof window_amount !== "string" || window_amount.trim() === "") return null;
  if (typeof window_seconds !== "number" || !Number.isFinite(window_seconds) || window_seconds <= 0) return null;
  if (typeof expires_at !== "string" || !Number.isFinite(Date.parse(expires_at))) return null;
  return { per_payment, window_amount, window_seconds, expires_at };
}

function parsePrincipal(value: unknown): MandatePrincipal | null {
  if (!isRecord(value)) return null;
  if (typeof value.display !== "string" || value.display.trim() === "") return null;
  if (value.assertion !== "self") return null;
  return { display: value.display, assertion: "self" };
}

/**
 * Validate the fields the page renders and drop everything else.
 *
 * A known state without a scope is refused rather than rendered half-blank: the page's job is to show
 * the caps a pass is claimed to carry, and a page that cannot show them must not wear an `active`
 * chip. A malformed `as_of` is refused for the same reason — the record's age is part of the claim.
 */
export function parseMandatePayload(raw: unknown): MandatePayload | null {
  if (!isRecord(raw)) return null;
  if (typeof raw.serial !== "string" || raw.serial.trim() === "") return null;
  if (!isStatus(raw.status)) return null;
  if (typeof raw.as_of !== "string" || !Number.isFinite(Date.parse(raw.as_of))) return null;

  const status = raw.status;
  const scope = parseScope(raw.scope);
  const principal = parsePrincipal(raw.principal);

  if (status === "unknown") {
    return { serial: raw.serial, status, scope: null, principal: null, as_of: raw.as_of };
  }
  if (scope === null || principal === null) return null;

  return { serial: raw.serial, status, scope, principal, as_of: raw.as_of };
}

/**
 * Read one mandate.
 *
 * `cache: "no-store"` is not a performance choice: a cached `active` would outlive a revocation, and
 * instant server-side revocation is why the QR exists. The same reason makes this route
 * `force-dynamic` in `page.tsx`.
 *
 * A transport failure, a non-2xx answer, invalid JSON or a body missing a field the page needs all
 * become `unreadable` — never `unknown`. A rate-limited or failed answer must not look like a
 * revoked one.
 */
export async function fetchMandate(
  serial: string,
  options: { apiBase?: string; fetchImpl?: typeof fetch } = {},
): Promise<MandateRead> {
  const apiBase = (options.apiBase ?? mandateApiBase()).replace(/\/+$/, "");
  const doFetch = options.fetchImpl ?? fetch;

  let response: Response;
  try {
    response = await doFetch(`${apiBase}/v1/mandate/${encodeURIComponent(serial)}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
  } catch {
    return { kind: "unreadable", serial, reason: "the record service could not be reached", apiBase };
  }

  if (!response.ok) {
    return {
      kind: "unreadable",
      serial,
      reason: `the record service answered ${response.status}`,
      apiBase,
    };
  }

  let raw: unknown;
  try {
    raw = await response.json();
  } catch {
    return { kind: "unreadable", serial, reason: "the record was not readable JSON", apiBase };
  }

  const payload = parseMandatePayload(raw);
  if (payload === null) {
    return { kind: "unreadable", serial, reason: "the record was missing a field this page needs", apiBase };
  }

  return { kind: "record", payload, apiBase };
}

/** `20.00 USDC per 24h` — the window as one phrase, with the unit explicit because the scope carries no asset. */
export function formatWindowAmount(amount: string, seconds: number): string {
  return `${amount} USDC per ${formatWindow(seconds)}`;
}

export function formatWindow(seconds: number): string {
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}

const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** The expiry and the read time are instants; render them in UTC and say so rather than imply local time. */
export function formatInstant(iso: string): string {
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return iso;
  return `${DATE_TIME.format(parsed)} UTC`;
}

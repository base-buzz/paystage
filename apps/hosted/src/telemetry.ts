// PayStage telemetry — fire-and-forget event recording to Supabase REST.
//
// Design constraints:
//   * No @supabase/supabase-js (edge bundle size).
//   * Never throw to caller; all failures are logged and swallowed.
//   * Never log secrets (URL/key) — only reason codes.

// `free-tier` is a real caller who did not pay: labelled separately so the free funnel can
// be measured without ever inflating the count of paying customers.
export type TelemetrySource = "real" | "synthetic" | "test" | "free-tier";

export interface TelemetryEvent {
  source: TelemetrySource;
  tool: string;
  decision: string;
  reason_codes: string[];
  network: string;
  latency_ms?: number | null;
  amount_usdc?: number | null;
  pay_to?: string | null;
  tx_hash?: string | null;
  /** The address that paid, lowercased. Null when the settlement receipt did not carry one. */
  payer?: string | null;
  request_id?: string | null;
  facilitator_status?: string | null;
  error_class?: string | null;
}

export interface TelemetryEnv {
  SUPABASE_URL?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
}

function nonEmpty(v: string | undefined | null): v is string {
  return typeof v === "string" && v.length > 0;
}

function isValidSource(v: string | null | undefined): v is TelemetrySource {
  return v === "real" || v === "synthetic" || v === "test" || v === "free-tier";
}

/**
 * Determine telemetry source from request headers.
 * Header `x-paystage-source` wins if it is one of the valid values,
 * otherwise defaults to `real`.
 */
export function sourceFromHeaders(req: {
  header(name: string): string | undefined;
}): TelemetrySource {
  const raw = req.header("x-paystage-source");
  if (isValidSource(raw)) return raw;
  return "real";
}

/**
 * Record a telemetry event. Non-blocking: schedules a fetch POST to
 * Supabase REST and returns immediately. Never throws.
 */
export function recordEvent(
  env: TelemetryEnv,
  event: TelemetryEvent,
  waitUntil?: (p: Promise<unknown>) => void,
): void {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;

  if (!nonEmpty(url) || !nonEmpty(key)) {
    console.log(
      JSON.stringify({
        level: "warn",
        msg: "telemetry_skipped",
        reason: "missing_config",
      }),
    );
    return;
  }

  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/events`;

  const row: Record<string, unknown> = {
    source: event.source,
    tool: event.tool,
    decision: event.decision,
    reason_codes: event.reason_codes ?? [],
    network: event.network,
    latency_ms: event.latency_ms ?? null,
    amount_usdc: event.amount_usdc ?? null,
    pay_to: event.pay_to ?? null,
    tx_hash: event.tx_hash ?? null,
    payer: event.payer ?? null,
    request_id: event.request_id ?? null,
    facilitator_status: event.facilitator_status ?? null,
    error_class: event.error_class ?? null,
  };
  const body = JSON.stringify(row)

  /**
   * Fields this file may silently drop when the table lacks them.
   *
   * One entry, added 2026-11-14 for the `payer` migration, and it should be deleted once every
   * environment has the column. Adding to this set is a decision that a missing field is better than
   * a missing row; that is true for an optional field on a live migration and false in general.
   */
  const DROPPABLE_FIELDS = new Set(["payer"]);

  const p: Promise<unknown> = (async () => {
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
          Prefer: "return=minimal",
        },
        body,
      });
      // A field the table does not have yet must not silence telemetry.
      //
      // On 2026-11-13 `payer` shipped a day before its migration, PostgREST answered PGRST204 for
      // every row, and a day of events was dropped while every request returned 200. A retry keeps
      // the pipe open during that window.
      //
      // But an unlimited retry trades a loud failure for a silent one: any future schema drift —
      // a renamed column, a typo in this file — would be absorbed by dropping the field and logging
      // a warning nobody reads. That is the same shape as the outage it was written for.
      //
      // So the drop is an allowlist, and the allowlist is one field with a date on it. Anything else
      // fails loudly and keeps its error.
      if (res.status === 400) {
        const detail = await res.text().catch(() => "");
        const missing = /PGRST204|column .* does not exist|Could not find the '([a-z_]+)' column/i.exec(detail);
        const field = missing?.[1];
        // No captured name means we cannot say what is missing; dropping anything (especially a
        // default of `payer`) would be guessing with the field this project most needs.
        const droppable = field !== undefined && DROPPABLE_FIELDS.has(field);
        if (droppable) {
          const { [field]: _dropped, ...rest } = row;
          console.log(
            JSON.stringify({
              level: "error",
              msg: "telemetry_field_dropped",
              field,
              note: "on the drop allowlist; retrying without it. Remove it from DROPPABLE_FIELDS once the column exists.",
            }),
          );
          return fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify(rest),
          });
        }
      }

      if (!res.ok) {
        console.log(
          JSON.stringify({
            level: "warn",
            msg: "telemetry_failed",
            reason: "http_error",
            status: res.status,
            tool: event.tool,
          }),
        );
      }
      // PostgREST answers 400 for a row with an unknown field, and the effect of swallowing that is
      // invisible: every request 200s, nothing is recorded, and the site reports zero users. The
      // status and body are logged so the next schema drift is diagnosable from the logs alone.
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        console.log(
          JSON.stringify({
            level: "error",
            msg: "telemetry_insert_rejected",
            status: res.status,
            body: body.slice(0, 300),
          }),
        );
      }
    } catch (err) {
      console.log(
        JSON.stringify({
          level: "warn",
          msg: "telemetry_failed",
          reason: "fetch_error",
          error: err instanceof Error ? err.message : String(err),
          tool: event.tool,
        }),
      );
    }
  })();

  if (waitUntil) {
    try {
      waitUntil(p);
    } catch {
      // If waitUntil itself throws, fall back to detached promise.
      void p;
    }
  } else {
    void p;
  }
}

/**
 * Daily free-tier keep-alive: trivial SELECT against issue_flags.
 * Never throws; never logs secrets. Cron-only — no paid calls.
 */
export async function heartbeatSupabase(
  env: TelemetryEnv,
): Promise<{ ok: boolean }> {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!nonEmpty(url) || !nonEmpty(key)) {
    console.log(
      JSON.stringify({
        level: "warn",
        msg: "heartbeat_skipped",
        reason: "missing_config",
      }),
    );
    return { ok: false };
  }
  try {
    const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/issue_flags?select=flag&limit=1`;
    const res = await fetch(endpoint, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${key}`,
        apikey: key,
        Prefer: "count=exact",
        Accept: "application/json",
      },
    });
    console.log(
      JSON.stringify({
        level: "info",
        msg: "heartbeat",
        ok: res.ok,
        status: res.status,
      }),
    );
    return { ok: res.ok };
  } catch (err) {
    console.log(
      JSON.stringify({
        level: "warn",
        msg: "heartbeat_failed",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return { ok: false };
  }
}

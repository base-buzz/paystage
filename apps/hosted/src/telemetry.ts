// PayStage telemetry — fire-and-forget event recording to Supabase REST.
//
// Design constraints:
//   * No @supabase/supabase-js (edge bundle size).
//   * Never throw to caller; all failures are logged and swallowed.
//   * Never log secrets (URL/key) — only reason codes.

export type TelemetrySource = "real" | "synthetic" | "test";

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
  return v === "real" || v === "synthetic" || v === "test";
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

  const body = JSON.stringify({
    source: event.source,
    tool: event.tool,
    decision: event.decision,
    reason_codes: event.reason_codes ?? [],
    network: event.network,
    latency_ms: event.latency_ms ?? null,
    amount_usdc: event.amount_usdc ?? null,
    pay_to: event.pay_to ?? null,
    tx_hash: event.tx_hash ?? null,
    request_id: event.request_id ?? null,
    facilitator_status: event.facilitator_status ?? null,
    error_class: event.error_class ?? null,
  });

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

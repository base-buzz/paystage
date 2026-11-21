// PayStage telemetry — fire-and-forget event recording to Supabase REST.
//
// Design constraints:
//   * No @supabase/supabase-js (edge bundle size).
//   * Never throw to caller; all failures are logged and swallowed.
//   * Never log secrets (URL/key) — only reason codes.

// `free-tier` is a real caller who did not pay: labelled separately so the free funnel can
// be measured without ever inflating the count of paying customers.
export type TelemetrySource = "real" | "synthetic" | "test" | "free-tier";

/**
 * Dropped-field signals, visible from outside.
 *
 * The drop allowlist exists so a missing column does not silence telemetry. That is the right behaviour
 * and the wrong failure mode: it converts "every write rejected" into "one field quietly absent", and the
 * first version of it logged a warning nobody read. This keeps a per-isolate count so /health can say
 * *something is being dropped*, and the Coordinator digest can carry it where decisions are made.
 */
const droppedFields: Array<{ field: string; at: string }> = [];
const MAX_DROPS = 20;

export function recordDroppedField(field: string): void {
  droppedFields.push({ field, at: new Date().toISOString() });
  if (droppedFields.length > MAX_DROPS) droppedFields.shift();
}

export function telemetryDrops(): { count: number; fields: string[]; last: string | null } {
  return {
    count: droppedFields.length,
    fields: [...new Set(droppedFields.map((d) => d.field))],
    last: droppedFields.at(-1)?.at ?? null,
  };
}

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
  /** Which client package and version made the call (#52). Never an IP, never a person. */
  client_package?: string | null;
  client_version?: string | null;
  /**
   * The listing token from `?from=<channel>` (#326), normalised by `channel.ts`. Null means unknown — never "direct"
   * and never a bucket. This is attribution to a directory, not to a person: no IP, user agent or referrer is read.
   */
  channel?: string | null;
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
/**
 * Which client package and version made this call (#52).
 *
 * The question npm cannot answer: a download is not a call, and a call is not a user. Recording the **SDK build** turns
 * "4,139 weekly downloads" into "which installed version is actually being invoked", without recording an IP, a header
 * that identifies a person, or anything that survives the request.
 *
 * Preferred header is `x-paystage-client: @paystage/mcp/0.8.10`. A `user-agent` is also parsed, because a client that
 * forgets the header still usually sends one, and a half-answer beats none. Only `@paystage/*` packages are recorded:
 * an arbitrary user agent is not ours to store.
 */
const CLIENT_PATTERN = /(@paystage\/[a-z0-9-]+)[/@](\d+\.\d+\.\d+(?:-[-.\w]+)?)/i;

export interface ClientAttribution {
  package: string | null;
  version: string | null;
}

export function clientFromHeaders(req: { header(name: string): string | undefined }): ClientAttribution {
  for (const name of ["x-paystage-client", "user-agent"]) {
    const raw = req.header(name);
    if (raw === undefined || raw === "") continue;
    const match = CLIENT_PATTERN.exec(raw);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      return { package: match[1].toLowerCase(), version: match[2] };
    }
  }
  return { package: null, version: null };
}

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
    client_package: event.client_package ?? null,
    client_version: event.client_version ?? null,
    channel: event.channel ?? null,
    facilitator_status: event.facilitator_status ?? null,
    error_class: event.error_class ?? null,
  };
  const body = JSON.stringify(row)

  /**
   * Fields this file may silently drop when the table lacks them.
   *
   * One entry, added 2026-11-14 for the `payer` migration, and it should be deleted once every
   * environment has the column. `channel` was added 2026-11-21 for the same reason: its migration is
   * committed but not applied, and a field the table does not have must not silence telemetry for the
   * whole window between code and schema. Remove both entries once their columns exist everywhere.
   */
  const DROPPABLE_FIELDS = new Set(["payer", "channel"]);

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
          recordDroppedField(field);
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

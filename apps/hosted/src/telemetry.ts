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

/**
 * Who caused a call (#430).
 *
 * Three ways traffic can be provably ours, and `unknown` for everything else. `unknown` is **not** "external":
 * it is the absence of a signed label, which includes our own callers before they sign and anyone who does not
 * send a header. Nothing here is inferred from an IP, user agent or referrer.
 */
export type CallerProvenance = "own-ci" | "own-loadgen" | "own-probe" | "unknown";

const CALLER_PROVENANCE_VALUES: ReadonlySet<string> = new Set([
  "own-ci",
  "own-loadgen",
  "own-probe",
  "unknown",
]);

const PROVENANCE_HEADER = "x-paystage-provenance";
const PROVENANCE_SIG_HEADER = "x-paystage-provenance-sig";

/** Hex to bytes, or null when the value is not a well-formed even-length hex string. */
function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length === 0 || hex.length % 2 !== 0 || !/^[0-9a-f]+$/i.test(hex)) return null;
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/** Constant-time-ish: the loop never exits on a differing byte, only on a length mismatch. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * HMAC-SHA256 via Web Crypto. No Node `crypto` import: this runs in a Worker as well as in tests.
 * Returns null when the runtime has no subtle crypto, and never logs its inputs.
 */
async function hmacSha256(key: string, message: string): Promise<Uint8Array | null> {
  const subtle = typeof crypto === "undefined" ? undefined : crypto.subtle;
  if (!subtle) return null;
  const encoder = new TextEncoder();
  const cryptoKey = await subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await subtle.sign("HMAC", cryptoKey, encoder.encode(message)));
}

/**
 * Read caller provenance from a signed header (#430).
 *
 * The caller sends `x-paystage-provenance: own-ci | own-loadgen | own-probe` with
 * `x-paystage-provenance-sig: <hex HMAC-SHA256 of the value>`, keyed by `PAYSTAGE_PROVENANCE_KEY`.
 *
 * Every failure — missing key, missing header, missing or malformed signature, a value outside the allowlist, or a
 * signature that does not match — resolves to `unknown`. It never throws and never logs the key or the signature:
 * a caller's inability to prove provenance is ordinary, not an error.
 *
 * No timestamp is signed. That is deliberate: the header records provenance, it does not authorise anything, and a
 * replayed signature can only mislabel traffic as ours (which understates adoption, never inflates it).
 */
export async function provenanceFromHeaders(
  req: { header(name: string): string | undefined },
  key: string | undefined = process.env.PAYSTAGE_PROVENANCE_KEY,
): Promise<CallerProvenance> {
  const value = req.header(PROVENANCE_HEADER)?.trim() ?? "";
  const signature = req.header(PROVENANCE_SIG_HEADER)?.trim() ?? "";

  // A proof of "unknown" is not a proof of anything, so only the three own values can be returned signed.
  if (
    value === "unknown" ||
    !CALLER_PROVENANCE_VALUES.has(value) ||
    signature === "" ||
    key === undefined ||
    key === ""
  ) {
    /**
     * Say *why* when a caller did sign and we could not check it. Measured 2026-11-25: a correctly signed request
     * landed as `unknown` and nothing anywhere said the key was missing, so the column was inert and looked honest.
     * Never logs the key or the signature — only that a signature arrived and there was nothing to verify it with.
     */
    if (signature !== "") {
      console.log(
        JSON.stringify(
          key === undefined || key === ""
            ? { level: "warn", msg: "provenance_key_absent", reason: "signed header with no key configured" }
            : { level: "warn", msg: "provenance_header_rejected", reason: "signature did not verify" },
        ),
      );
    }
    return "unknown";
  }

  try {
    const expected = await hmacSha256(key, value);
    const provided = hexToBytes(signature);
    if (expected === null || provided === null) return "unknown";
    return equalBytes(expected, provided) ? (value as CallerProvenance) : "unknown";
  } catch {
    // A malformed header or an unavailable crypto implementation is not the caller's error to see.
    return "unknown";
  }
}

/**
 * The signing key, read from the Worker's **binding** rather than `process.env`.
 *
 * `provenanceFromHeaders` defaults to `process.env.PAYSTAGE_PROVENANCE_KEY`, and on a Worker with a
 * `compatibility_date` before 2025-04-01 that is only populated when `nodejs_compat_populate_process_env` is set.
 * Measured 2026-11-25: the flag was set, the secret was on the worker, and a correctly signed request still landed
 * as `unknown` — a dropped or absent value is indistinguishable from an honest "no signature", which is exactly the
 * failure this column must not have. Reading the binding is explicit and cannot be silently empty for a reason of
 * runtime configuration.
 */
export function provenanceKeyFrom(env: unknown): string | undefined {
  const value = (env as { PAYSTAGE_PROVENANCE_KEY?: unknown } | undefined)?.PAYSTAGE_PROVENANCE_KEY;
  return typeof value === "string" && value !== "" ? value : undefined;
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
  /**
   * Who caused the call (#430), proven by a signed header or `unknown`. Never guessed from IP, user agent or
   * referrer. An external caller is indistinguishable from an unlabelled one and both are `unknown`.
   */
  caller_provenance?: CallerProvenance;
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
    caller_provenance: event.caller_provenance ?? "unknown",
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
   * whole window between code and schema. `caller_provenance` was added 2026-11-25 for the same reason (#430).
   * Remove each entry once its column exists everywhere.
   */
  const DROPPABLE_FIELDS = new Set(["payer", "channel", "caller_provenance"]);

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
      let detail = "";
      if (res.status === 400) {
        detail = await res.text().catch(() => "");
        // PGRST204 puts `code` before `message`, and the message is the only place the column is
        // named. Capture the message form FIRST: the old alternation listed the bare `PGRST204`
        // first, so it matched the code and returned before the capture group, leaving `field`
        // undefined, `droppable` false, and the retry never fired (#360).
        const missing =
          /Could not find the '([a-z_]+)' column/i.exec(detail) ??
          /column "([a-z_]+)"(?: of [^ ]+)? does not exist/i.exec(detail) ??
          /PGRST204/i.exec(detail);
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
              reason: "missing_migration",
              note: `the events table has no '${field}' column, so the '${field}' migration is committed but not applied. Retrying without it; apply the migration and remove '${field}' from DROPPABLE_FIELDS.`,
            }),
          );
          const retried = await fetch(endpoint, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: key,
              Authorization: `Bearer ${key}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify(rest),
          });
          if (!retried.ok) {
            const retriedBody = await retried.text().catch(() => "");
            console.log(
              JSON.stringify({
                level: "error",
                msg: "telemetry_retry_rejected",
                field,
                status: retried.status,
                body: retriedBody.slice(0, 300),
              }),
            );
          }
          return retried;
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
        // Reuse the body read above. A Response body can only be read once, so the old code — which
        // consumed the 400 in the drop check and read `res.text()` again here — logged an empty
        // body, and the column that was missing never reached the logs.
        if (detail === "") detail = await res.text().catch(() => "");
        console.log(
          JSON.stringify({
            level: "error",
            msg: "telemetry_insert_rejected",
            status: res.status,
            body: detail.slice(0, 300),
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

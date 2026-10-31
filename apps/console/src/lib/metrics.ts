import "server-only";

import type {
  EventSource,
  Incident,
  MetricsSummary,
  StatusFlag,
  TelemetryEvent,
  VolumePoint,
} from "@/lib/types";
import { isSupabaseConfigured, selectRows } from "@/lib/supabase";

type EventRow = {
  id: string;
  ts: string;
  source: string | null;
  tool: string | null;
  decision: string | null;
  reason_codes: string[] | null;
  network: string | null;
  latency_ms: number | null;
  amount_usdc: number | string | null;
  tx_hash: string | null;
  request_id: string | null;
  facilitator_status: string | null;
  error_class: string | null;
};

type IncidentRow = {
  id: string;
  opened_at: string;
  closed_at: string | null;
  severity: string | null;
  title: string | null;
  summary: string | null;
  status: string | null;
  public: boolean | null;
};

const DEFAULT_STATUS_URL = "https://sepolia.api.paystage.xyz/v1/public/status";
const EVENT_LIMIT = 500;
const INCIDENT_LIMIT = 20;
const LATENCY_THRESHOLD_MS = 5000;
const HOUR_MS = 60 * 60 * 1000;
const WINDOW_HOURS = 24;

/**
 * Normalize a raw source value into a known EventSource.
 * Anything unrecognized is treated as real traffic.
 */
function normalizeSource(raw: string | null | undefined): EventSource {
  const value = (raw ?? "").trim().toLowerCase();
  if (value === "synthetic") return "synthetic";
  if (value === "test") return "test";
  if (value === "real") return "real";
  return "real";
}

function mapEvent(row: EventRow): TelemetryEvent {
  return {
    id: row.id,
    source: normalizeSource(row.source),
    kind: row.tool ?? "unknown",
    status: row.decision ?? "unknown",
    route: row.network ?? "unknown",
    message: row.error_class ?? row.facilitator_status ?? null,
    created_at: row.ts,
    latency_ms: typeof row.latency_ms === "number" ? row.latency_ms : null,
    tx_hash: row.tx_hash ?? null,
  };
}

function mapIncident(row: IncidentRow): Incident {
  const rawSeverity = (row.severity ?? "").trim().toLowerCase();
  const severity: Incident["severity"] =
    rawSeverity === "warning" ? "major" : (rawSeverity as Incident["severity"]) || "major";

  const rawStatus = (row.status ?? "").trim().toLowerCase();
  const status: Incident["status"] =
    rawStatus === "open" || rawStatus === "resolved" || rawStatus === "monitoring"
      ? rawStatus
      : "open";

  return {
    id: row.id,
    created_at: row.opened_at,
    title: row.title ?? "",
    severity,
    status,
    summary: row.summary ?? null,
  };
}

/**
 * Build 24 hourly volume buckets ending at `now`.
 * Only `real` and `synthetic` events are counted; `test` events are ignored.
 */
function buildVolume(events: TelemetryEvent[], now: Date): VolumePoint[] {
  const endMs = now.getTime();
  const startMs = endMs - WINDOW_HOURS * HOUR_MS;

  const buckets: VolumePoint[] = [];
  for (let i = 0; i < WINDOW_HOURS; i += 1) {
    const bucketStart = startMs + i * HOUR_MS;
    buckets.push({
      bucket: new Date(bucketStart).toISOString(),
      real: 0,
      synthetic: 0,
    });
  }

  for (const event of events) {
    if (event.source !== "real" && event.source !== "synthetic") continue;

    const ts = Date.parse(event.created_at);
    if (Number.isNaN(ts)) continue;
    if (ts < startMs || ts >= endMs) continue;

    const index = Math.floor((ts - startMs) / HOUR_MS);
    const bucket = buckets[index];
    if (!bucket) continue;

    if (event.source === "real") {
      bucket.real += 1;
    } else {
      bucket.synthetic += 1;
    }
  }

  return buckets;
}

function deriveFlags(events: TelemetryEvent[]): StatusFlag[] {
  const flags: StatusFlag[] = [];
  const real = events.filter((e) => e.source === "real");

  const facilitatorErrors = real.filter((e) =>
    (e.message ?? "").toLowerCase().includes("facilitator"),
  );
  if (facilitatorErrors.length > 0) {
    flags.push({
      id: "facilitator_error",
      label: "Facilitator errors",
      severity: facilitatorErrors.length > 5 ? "major" : "minor",
      active: true,
      detail: `${facilitatorErrors.length} facilitator error event(s)`,
    });
  }

  const settlementErrors = real.filter((e) => {
    const msg = (e.message ?? "").toLowerCase();
    const status = (e.status ?? "").toLowerCase();
    return msg.includes("settlement") || status.includes("settle");
  });
  if (settlementErrors.length > 0) {
    flags.push({
      id: "settlement",
      label: "Settlement issues",
      severity: settlementErrors.length > 5 ? "major" : "minor",
      active: true,
      detail: `${settlementErrors.length} settlement-related event(s)`,
    });
  }

  const slow = real.filter(
    (e) => typeof e.latency_ms === "number" && e.latency_ms > 5000,
  );
  if (slow.length > 0) {
    flags.push({
      id: "latency",
      label: "High latency",
      severity: slow.length > 10 ? "major" : "minor",
      active: true,
      detail: `${slow.length} event(s) exceeded 5000ms`,
    });
  }

  return flags;
}

function emptySummary(note?: string): MetricsSummary {
  return {
    configured: false,
    realCount24h: 0,
    syntheticCount24h: 0,
    testCount24h: 0,
    issuesOpen: 0,
    uptimePct: 100,
    flags: [],
    volume: [],
    events: [],
    incidents: [],
    generatedAt: new Date().toISOString(),
    ...(note ? { note } : {}),
  };
}

async function fetchPublicStatusFlags(): Promise<StatusFlag[]> {
  const url = process.env.NEXT_PUBLIC_STATUS_URL || DEFAULT_STATUS_URL;
  try {
    const res = await fetch(url, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (!res.ok) return [];
    const data: unknown = await res.json();
    if (!data || typeof data !== "object") return [];

    const record = data as Record<string, unknown>;
    const rawFlags = Array.isArray(record.flags) ? record.flags : [];
    const flags: StatusFlag[] = [];
    for (const raw of rawFlags) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const id =
        typeof f.id === "string"
          ? f.id
          : typeof f.flag === "string"
            ? f.flag
            : null;
      if (!id) continue;
      const triggered = f.triggered === true || f.active === true;
      const count = typeof f.count === "number" ? f.count : undefined;
      flags.push({
        id,
        label: typeof f.label === "string" ? f.label : id,
        severity:
          f.severity === "critical"
            ? "critical"
            : f.severity === "major" || f.severity === "warning"
              ? "major"
              : f.severity === "info"
                ? "info"
                : "minor",
        active: triggered,
        detail: count != null ? `${count} event(s)` : null,
      });
    }
    return flags;
  } catch {
    return [];
  }
}

export async function getMetrics(): Promise<MetricsSummary> {
  const now = new Date();

  if (!isSupabaseConfigured()) {
    const flags = await fetchPublicStatusFlags();
    return {
      ...emptySummary("Telemetry not configured"),
      flags,
      issuesOpen: flags.length,
    };
  }

  try {
    const since = new Date(now.getTime() - WINDOW_HOURS * HOUR_MS).toISOString();

    const [eventRows, incidentRows] = await Promise.all([
      selectRows<EventRow>(
        "events",
        `select=*&ts=gte.${encodeURIComponent(since)}&order=ts.desc&limit=${EVENT_LIMIT}`,
      ),
      selectRows<IncidentRow>(
        "incidents",
        `select=*&public=eq.true&status=in.(open,monitoring)&order=opened_at.desc&limit=${INCIDENT_LIMIT}`,
      ),
    ]);

    const events = (eventRows ?? []).map(mapEvent);
    const incidents = (incidentRows ?? []).map(mapIncident);

    let realCount24h = 0;
    let syntheticCount24h = 0;
    let testCount24h = 0;
    for (const event of events) {
      if (event.source === "real") realCount24h += 1;
      else if (event.source === "synthetic") syntheticCount24h += 1;
      else if (event.source === "test") testCount24h += 1;
    }

    const flags = deriveFlags(events);
    const issuesOpen = flags.length + incidents.filter((i) => i.status === "open").length;

    const volume = buildVolume(events, now);

    const totalReal = volume.reduce((sum, b) => sum + b.real, 0);
    const uptimePct =
      totalReal === 0 ? 100 : Math.max(0, Math.min(100, 100 - (flags.length / totalReal) * 100));

    return {
      configured: true,
      realCount24h,
      syntheticCount24h,
      testCount24h,
      issuesOpen,
      uptimePct: Math.round(uptimePct * 100) / 100,
      flags,
      volume,
      events,
      incidents,
      generatedAt: now.toISOString(),
    };
  } catch {
    return emptySummary("Telemetry unavailable");
  }
}

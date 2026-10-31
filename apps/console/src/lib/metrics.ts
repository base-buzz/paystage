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
  amount_usdc: number | null;
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

function normalizeSource(value: string | null | undefined): EventSource {
  const v = (value ?? "").toLowerCase();
  if (v === "synthetic") return "synthetic";
  if (v === "real") return "real";
  return "real";
}

function mapEvent(row: EventRow): TelemetryEvent {
  return {
    id: row.id,
    source: normalizeSource(row.source),
    kind: String(row.tool ?? ""),
    status: String(row.decision ?? ""),
    route: row.network ?? null,
    message: row.error_class ?? row.facilitator_status ?? null,
    created_at: row.ts,
    latency_ms: row.latency_ms ?? null,
  } as TelemetryEvent;
}

function hourBucket(date: Date): string {
  const d = new Date(date.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d.toISOString();
}

function buildVolume(events: TelemetryEvent[], now: Date): VolumePoint[] {
  const buckets: VolumePoint[] = [];
  const index = new Map<string, VolumePoint>();

  const end = new Date(now.getTime());
  end.setUTCMinutes(0, 0, 0);

  for (let i = 23; i >= 0; i -= 1) {
    const bucketDate = new Date(end.getTime() - i * 60 * 60 * 1000);
    const bucket = hourBucket(bucketDate);
    const point: VolumePoint = { bucket, real: 0, synthetic: 0 };
    buckets.push(point);
    index.set(bucket, point);
  }

  for (const event of events) {
    const ts = new Date(event.created_at);
    if (Number.isNaN(ts.getTime())) continue;
    const bucket = hourBucket(ts);
    const point = index.get(bucket);
    if (!point) continue;
    if (event.source === "synthetic") {
      point.synthetic += 1;
    } else {
      point.real += 1;
    }
  }

  return buckets;
}

function deriveFlags(events: TelemetryEvent[]): StatusFlag[] {
  const flags: StatusFlag[] = [];

  const facilitatorErrors = events.filter(
    (e) => e.message === "facilitator_error",
  );
  if (facilitatorErrors.length > 0) {
    flags.push({
      id: "facilitator_error",
      label: "Facilitator errors",
      severity: facilitatorErrors.length > 5 ? "major" : "minor",
      active: true,
      detail: `${facilitatorErrors.length} facilitator error event(s) observed`,
    });
  }

  const settlementErrors = events.filter(
    (e) =>
      e.message === "settlement" ||
      e.message === "settlement_error" ||
      (e.message ?? "").includes("settlement"),
  );
  if (settlementErrors.length > 0) {
    flags.push({
      id: "settlement",
      label: "Settlement issues",
      severity: settlementErrors.length > 5 ? "major" : "minor",
      active: true,
      detail: `${settlementErrors.length} settlement-related event(s) observed`,
    });
  }

  const slow = events.filter(
    (e) => typeof e.latency_ms === "number" && e.latency_ms > 5000,
  );
  if (slow.length > 0) {
    flags.push({
      id: "latency",
      label: "High latency",
      severity: slow.length > 10 ? "major" : "minor",
      active: true,
      detail: `${slow.length} event(s) exceeded 5000ms latency`,
    });
  }

  return flags;
}

function mapSeverity(value: string | null | undefined): StatusFlag["severity"] {
  const v = (value ?? "").toLowerCase();
  if (v === "critical") return "critical";
  if (v === "warning") return "major";
  if (v === "info") return "info";
  return "minor";
}

function normalizeIncidentStatus(
  value: string | null | undefined,
): Incident["status"] {
  const v = (value ?? "").toLowerCase();
  if (v === "open") return "open";
  if (v === "monitoring") return "monitoring";
  return "resolved";
}

function mapIncident(row: IncidentRow): Incident {
  return {
    id: row.id,
    created_at: row.opened_at,
    title: row.title ?? "",
    severity: mapSeverity(row.severity),
    status: normalizeIncidentStatus(row.status),
    summary: row.summary ?? null,
  };
}

function computeUptimePct(events: TelemetryEvent[]): number {
  if (events.length === 0) return 100;
  const failures = events.filter((e) => {
    const status = (e.status ?? "").toLowerCase();
    const message = (e.message ?? "").toLowerCase();
    return (
      status === "error" ||
      status === "failed" ||
      status === "failure" ||
      message.includes("error")
    );
  }).length;
  const pct = ((events.length - failures) / events.length) * 100;
  return Math.max(0, Math.min(100, Math.round(pct * 100) / 100));
}

async function fetchStatusFlags(): Promise<StatusFlag[]> {
  const url = process.env.NEXT_PUBLIC_STATUS_URL || DEFAULT_STATUS_URL;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return [];
    const json: unknown = await res.json();
    if (!json || typeof json !== "object") return [];
    const record = json as Record<string, unknown>;
    const rawFlags = record.flags;
    if (!Array.isArray(rawFlags)) return [];
    const flags: StatusFlag[] = [];
    for (const raw of rawFlags) {
      if (!raw || typeof raw !== "object") continue;
      const f = raw as Record<string, unknown>;
      const id = typeof f.id === "string" ? f.id : null;
      if (!id) continue;
      const severityRaw = typeof f.severity === "string" ? f.severity : "info";
      const severity: StatusFlag["severity"] =
        severityRaw === "critical" ||
        severityRaw === "major" ||
        severityRaw === "minor" ||
        severityRaw === "info"
          ? severityRaw
          : "info";
      flags.push({
        id,
        label: typeof f.label === "string" ? f.label : id,
        severity,
        active: f.active === true,
        detail: typeof f.detail === "string" ? f.detail : "",
      });
    }
    return flags;
  } catch {
    return [];
  }
}

export async function getMetrics(): Promise<MetricsSummary> {
  const now = new Date();
  const generatedAt = now.toISOString();

  if (!isSupabaseConfigured()) {
    const flags = await fetchStatusFlags();
    return {
      configured: false,
      realCount24h: 0,
      syntheticCount24h: 0,
      testCount24h: 0,
      issuesOpen: flags.filter((f) => f.active).length,
      uptimePct: 100,
      flags,
      volume: buildVolume([], now),
      events: [],
      incidents: [],
      generatedAt,
      note: "Telemetry not configured",
    };
  }

const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

  const eventRows =
    (await selectRows<EventRow>(
      "events",
      `select=*&ts=gte.${since}&order=ts.desc&limit=500`,
    )) ?? [];
  const incidentRows =
    (await selectRows<IncidentRow>(
      "incidents",
      "select=*&public=eq.true&status=in.(open,monitoring)&order=opened_at.desc&limit=20",
    )) ?? [];

  const events = eventRows.map(mapEvent);
  const incidents = incidentRows.map(mapIncident);

  let realCount24h = 0;
  let syntheticCount24h = 0;
  let testCount24h = 0;

  for (const event of events) {
    if (event.source === "real") realCount24h++;
    else if (event.source === "synthetic") syntheticCount24h++;
    else if (event.source === "test") testCount24h++;
  }

  const flags = deriveFlags(events);
  const issuesOpen = flags.filter((f) => f.active).length;

  return {
    configured: true,
    realCount24h,
    syntheticCount24h,
    testCount24h,
    issuesOpen,
    uptimePct: computeUptimePct(events),
    flags,
    volume: buildVolume(events, now),
    events,
    incidents,
    generatedAt,
  };
}

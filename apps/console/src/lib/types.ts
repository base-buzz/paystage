export type EventSource = "real" | "synthetic" | "test";
export interface TelemetryEvent { id: string; created_at: string; source: EventSource; kind: string; status: string; latency_ms: number | null; route: string | null; message: string | null; }
export interface Incident { id: string; created_at: string; title: string; severity: "info" | "minor" | "major" | "critical"; status: "open" | "resolved" | "monitoring"; summary: string | null; }
export interface StatusFlag { id: string; label: string; severity: "info" | "minor" | "major" | "critical"; active: boolean; detail?: string | null; }
export interface PublicStatus { ok: boolean; uptime_pct: number | null; flags: StatusFlag[]; updated_at: string | null; }
export interface VolumePoint { bucket: string; real: number; synthetic: number; }
export interface MetricsSummary { configured: boolean; realCount24h: number; syntheticCount24h: number; testCount24h: number; issuesOpen: number; uptimePct: number | null; flags: StatusFlag[]; volume: VolumePoint[]; events: TelemetryEvent[]; incidents: Incident[]; generatedAt: string; note?: string; }

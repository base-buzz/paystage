import { Hono } from "hono";

export const publicStatusRoutes = new Hono();

interface IssueFlag {
  flag: string;
  triggered: boolean;
  count?: number;
  last_seen?: string | null;
}

interface Incident {
  id: string;
  opened_at: string;
  closed_at: string | null;
  severity: "info" | "warning" | "critical";
  title: string;
  summary: string;
  status: "open" | "monitoring" | "resolved";
}

interface StatusResponse {
  status: "ok" | "degraded" | "outage";
  flags: IssueFlag[];
  incidents: Incident[];
  generated_at: string;
  note?: string;
}

function nonEmpty(v: string | undefined | null): v is string {
  return typeof v === "string" && v.length > 0;
}

function deriveStatus(flags: IssueFlag[]): "ok" | "degraded" | "outage" {
  const triggered = flags.filter((f) => f.triggered);
  if (triggered.length === 0) return "ok";
  // Any critical-ish flag -> outage; otherwise degraded.
  const outageFlags = new Set([
    "failed_settlements",
    "facilitator_errors",
    "abnormal_block_rate",
  ]);
  if (triggered.some((f) => outageFlags.has(f.flag))) return "outage";
  return "degraded";
}

async function fetchJson<T>(
  url: string,
  key: string,
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

publicStatusRoutes.get("/v1/public/status", async (c) => {
  const generated_at = new Date().toISOString();
  const url = c.env?.SUPABASE_URL as string | undefined;
  const key = c.env?.SUPABASE_SERVICE_ROLE_KEY as string | undefined;

  if (!nonEmpty(url) || !nonEmpty(key)) {
    const body: StatusResponse = {
      status: "ok",
      flags: [],
      incidents: [],
      generated_at,
      note: "telemetry_unconfigured",
    };
    return c.json(body);
  }

  const base = url.replace(/\/+$/, "");

  const [flags, incidents] = await Promise.all([
    fetchJson<IssueFlag[]>(
      `${base}/rest/v1/issue_flags?select=flag,triggered,count,last_seen`,
      key,
    ),
    fetchJson<Incident[]>(
      `${base}/rest/v1/incidents?select=id,opened_at,closed_at,severity,title,summary,status&public=eq.true&status=in.(open,monitoring)&order=opened_at.desc&limit=20`,
      key,
    ),
  ]);

  const safeFlags: IssueFlag[] = Array.isArray(flags) ? flags : [];
  const safeIncidents: Incident[] = Array.isArray(incidents) ? incidents : [];

  const body: StatusResponse = {
    status: deriveStatus(safeFlags),
    flags: safeFlags,
    incidents: safeIncidents,
    generated_at,
  };
  return c.json(body);
});

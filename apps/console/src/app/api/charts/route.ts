import { NextResponse } from "next/server";
import { selectRows, isSupabaseConfigured } from "@/lib/supabase";

/**
 * The series behind the lander's charts.
 *
 * Two sources, both of which we already read elsewhere:
 *  - requests per day, last 30, stacked by source (our own telemetry)
 *  - npm installs per week, last 12, summed across every published package
 *
 * Both are returned as data rather than rendered on the server, so the lander stays a static page —
 * the same reason SettledStrip moved client-side after an incremental-regeneration failure that only
 * appeared on Workers.
 */
export const dynamic = "force-dynamic";
export const revalidate = 0;

const PACKAGES = [
  "@paystage/mcp",
  "@paystage/preflight",
  "@paystage/policy",
  "@paystage/velocity",
  "@paystage/auth-watch",
  "@paystage/trade-preflight",
  "@paystage/x402-guard",
  "@paystage/x-evm",
  "@paystage/skill",
  "@paystage/ai-sdk",
];

type EventRow = { ts: string; source: string | null };

const DAY_MS = 86_400_000;

function dayKey(iso: string): string {
  return iso.slice(0, 10);
}

async function npmWeekly(): Promise<Array<{ week: string; installs: number }> | null> {
  const end = new Date();
  const start = new Date(end.getTime() - 12 * 7 * DAY_MS);
  const range = `${start.toISOString().slice(0, 10)}:${end.toISOString().slice(0, 10)}`;

  try {
    const perPackage = await Promise.all(
      PACKAGES.map(async (name) => {
        const res = await fetch(`https://api.npmjs.org/downloads/range/${range}/${encodeURIComponent(name)}`, {
          next: { revalidate: 3600 },
        });
        if (!res.ok) return [];
        const body = (await res.json()) as { downloads?: Array<{ day: string; downloads: number }> };
        return body.downloads ?? [];
      }),
    );

    const byDay = new Map<string, number>();
    for (const days of perPackage) {
      for (const d of days) byDay.set(d.day, (byDay.get(d.day) ?? 0) + d.downloads);
    }

    // Bucket into weeks ending today, so the last bar is the week in progress and is labelled as such.
    const buckets: Array<{ week: string; installs: number }> = [];
    for (let w = 11; w >= 0; w--) {
      const endOfWeek = new Date(end.getTime() - w * 7 * DAY_MS);
      const startOfWeek = new Date(endOfWeek.getTime() - 7 * DAY_MS);
      let sum = 0;
      for (const [day, count] of byDay) {
        if (day > startOfWeek.toISOString().slice(0, 10) && day <= endOfWeek.toISOString().slice(0, 10)) {
          sum += count;
        }
      }
      buckets.push({ week: endOfWeek.toISOString().slice(0, 10), installs: sum });
    }
    return buckets;
  } catch {
    return null;
  }
}

async function requestsDaily() {
  if (!isSupabaseConfigured()) return null;
  const since = new Date(Date.now() - 30 * DAY_MS).toISOString();
  const rows = await selectRows<EventRow>("events", `select=ts,source&ts=gte.${since}&limit=5000`);
  if (rows === null) return null;

  const days: Array<{ day: string; real: number; synthetic: number; test: number }> = [];
  const byDay = new Map<string, { real: number; synthetic: number; test: number }>();
  for (const row of rows) {
    const key = dayKey(row.ts);
    const bucket = byDay.get(key) ?? { real: 0, synthetic: 0, test: 0 };
    const source = row.source === "synthetic" ? "synthetic" : row.source === "test" ? "test" : "real";
    bucket[source] += 1;
    byDay.set(key, bucket);
  }

  for (let i = 29; i >= 0; i--) {
    const day = new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { real: 0, synthetic: 0, test: 0 };
    days.push({ day, ...bucket });
  }
  return days;
}

export async function GET() {
  const [weekly, daily] = await Promise.all([npmWeekly(), requestsDaily()]);
  return NextResponse.json(
    {
      npm: weekly,
      requests: daily,
      note: "npm installs include our own CI and mirrors; requests are labelled by the caller.",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

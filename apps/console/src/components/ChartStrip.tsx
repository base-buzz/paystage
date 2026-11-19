"use client";

import { useEffect, useState } from "react";

/**
 * The activity strip as charts rather than counters.
 *
 * A number says how much. A shape says whether it is growing, whether it stopped, and whether the
 * growth is us. Both series carry the caveat they need: installs include our own CI, and the request
 * bars separate real callers from synthetic and test traffic, because a tall bar of our own probes
 * read as adoption would be the single most dishonest pixel on this site.
 */
type NpmWeek = { week: string; installs: number };
type RequestDay = { day: string; real: number; synthetic: number; test: number };

export function ChartStrip() {
  const [npm, setNpm] = useState<NpmWeek[] | null>(null);
  const [requests, setRequests] = useState<RequestDay[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/charts", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!alive) return;
        setNpm(j?.npm ?? null);
        setRequests(j?.requests ?? null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!npm && !requests) return null;

  return (
    <section className="lp-charts" aria-label="Project activity over time">
      {npm && <NpmChart weeks={npm} />}
      {requests && <RequestChart days={requests} />}
    </section>
  );
}

function NpmChart({ weeks }: { weeks: NpmWeek[] }) {
  const max = Math.max(...weeks.map((w) => w.installs), 1);
  const total = weeks.reduce((s, w) => s + w.installs, 0);
  const thisWeek = weeks.at(-1)?.installs ?? 0;

  return (
    <figure className="lp-chart">
      <figcaption className="lp-chart-head">
        <span>npm installs, 12 weeks</span>
        <span className="lp-chart-note">includes our own CI and mirrors · {total.toLocaleString("en-US")} total</span>
      </figcaption>
      <div className="lp-chart-bars" role="img" aria-label={`npm installs per week for 12 weeks, ${thisWeek} this week`}>
        {weeks.map((w, i) => (
          <span
            key={w.week}
            className={`lp-chart-bar${i === weeks.length - 1 ? " is-current" : ""}`}
            style={{ height: `${Math.max((w.installs / max) * 100, w.installs > 0 ? 3 : 1)}%` }}
            title={`week ending ${w.week}: ${w.installs.toLocaleString("en-US")}`}
          />
        ))}
      </div>
      <div className="lp-chart-axis">
        <span>{weeks[0]?.week.slice(5)}</span>
        <span>this week: {thisWeek.toLocaleString("en-US")}</span>
        <span>{weeks.at(-1)?.week.slice(5)}</span>
      </div>
    </figure>
  );
}

function RequestChart({ days }: { days: RequestDay[] }) {
  const max = Math.max(...days.map((d) => d.real + d.synthetic + d.test), 1);
  const realTotal = days.reduce((s, d) => s + d.real, 0);

  return (
    <figure className="lp-chart">
      <figcaption className="lp-chart-head">
        <span>requests per day, 30 days</span>
        <span className="lp-chart-note">
          {realTotal.toLocaleString("en-US")} unlabelled · grey is our own synthetic and test traffic
        </span>
      </figcaption>
      <div className="lp-chart-bars" role="img" aria-label={`requests per day for 30 days, ${realTotal} unlabelled`}>
        {days.map((d) => {
          const total = d.real + d.synthetic + d.test;
          const realShare = total === 0 ? 0 : d.real / total;
          return (
            <span
              key={d.day}
              className="lp-chart-bar is-stacked"
              style={{ height: `${Math.max((total / max) * 100, total > 0 ? 3 : 1)}%` }}
              title={`${d.day}: ${d.real} unlabelled, ${d.synthetic} synthetic, ${d.test} test`}
            >
              <span className="lp-chart-fill-real" style={{ height: `${realShare * 100}%` }} />
            </span>
          );
        })}
      </div>
      <div className="lp-chart-axis">
        <span>{days[0]?.day.slice(5)}</span>
        <span>labelled where known</span>
        <span>today</span>
      </div>
    </figure>
  );
}

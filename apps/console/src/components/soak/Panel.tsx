import type { ReactNode } from "react";

import { formatTimestamp } from "@/lib/soak-mesh";

/**
 * One panel on `/lab/mesh` (#482).
 *
 * The footer is not decoration: every panel carries the narrow claim it supports and the much
 * larger claim it does **not** support. The provenance label and window are in the header of every
 * panel, because a chart about our own load must never be readable as a chart about demand.
 */
export function Panel({
  index,
  id,
  title,
  question,
  proves,
  doesNot,
  source,
  windowStart,
  windowEnd,
  children,
  tone,
}: {
  index: number;
  id: string;
  title: string;
  question: string;
  proves: string;
  doesNot: string;
  source: string;
  windowStart: string;
  windowEnd: string;
  children: ReactNode;
  tone?: "refusal" | "provenance";
}) {
  return (
    <section className={`mesh-panel${tone ? ` mesh-panel--${tone}` : ""}`} id={id} aria-labelledby={`${id}-title`}>
      <header className="mesh-panel-head">
        <span className="mesh-panel-n" aria-hidden="true">
          {String(index).padStart(2, "0")}
        </span>
        <div className="mesh-panel-heading">
          <h2 id={`${id}-title`}>{title}</h2>
          <p className="mesh-panel-question">{question}</p>
        </div>
        <p className="mesh-panel-meta">
          source <code>{source}</code>
          <br />
          window {formatTimestamp(windowStart)} → {formatTimestamp(windowEnd)}
        </p>
      </header>
      <div className="mesh-panel-body">{children}</div>
      <dl className="mesh-proof">
        <div>
          <dt>What it proves</dt>
          <dd>{proves}</dd>
        </div>
        <div>
          <dt>What it does not prove</dt>
          <dd>{doesNot}</dd>
        </div>
      </dl>
    </section>
  );
}

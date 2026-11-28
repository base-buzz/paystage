"use client";

import { useState } from "react";

import {
  ASK_OPTIONS,
  NOT_CONNECTED,
  afterAskReply,
  countLabel,
  formatOpenedOn,
  initialAskView,
} from "@/lib/ask-survey";
import type { AskAnswer, AskSnapshot } from "@/lib/ask-survey";

/**
 * The three buttons and the count (#511).
 *
 * There is no default answer, no "no thanks" that means yes, and no disabled styling that hides an option.
 * The count is rendered from `showCount`, which is true only when a read or a stored write returned one;
 * every other case shows the not-connected sentence instead.
 */
export function AskSurvey({ snapshot }: { snapshot: AskSnapshot }) {
  const [view, setView] = useState(() => initialAskView(snapshot));
  const [pending, setPending] = useState<AskAnswer | null>(null);
  const [accepted, setAccepted] = useState(false);

  async function answer(value: AskAnswer) {
    setPending(value);
    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answer: value, page: "/ask" }),
      });
      const reply: unknown = await response.json().catch(() => null);
      setView((previous) => afterAskReply(previous, reply));
      const body = reply as { stored?: unknown } | null;
      if (body?.stored === true) setAccepted(true);
    } catch {
      setView((previous) =>
        afterAskReply(previous, { stored: false, reason: "the request did not reach the counter" }),
      );
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="mt-8">
      <div role="group" aria-label="Your answer" className="flex flex-wrap gap-3">
        {ASK_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => answer(option.value)}
            disabled={pending !== null || accepted}
            className="rounded-md border border-ink/20 bg-paper px-5 py-3 text-sm font-semibold text-ink transition-colors hover:border-deep hover:text-deep focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink/60">One answer per address per day. Nothing is pre-selected.</p>

      <div aria-live="polite" className="mt-8 rounded-md border border-ink/10 bg-ink/[0.03] px-4 py-3 text-sm text-ink/80">
        {view.showCount && view.count !== null ? (
          <p>
            <strong>{countLabel(view.count)}</strong> so far · question opened {formatOpenedOn(view.openedOn)}.
          </p>
        ) : (
          <p>
            {NOT_CONNECTED} Question opened {formatOpenedOn(view.openedOn)}.
          </p>
        )}
        {view.notice && view.notice !== NOT_CONNECTED ? <p className="mt-2">{view.notice}</p> : null}
      </div>
    </div>
  );
}

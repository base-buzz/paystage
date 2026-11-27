import type { Metadata } from "next";
import Link from "next/link";

import "../landing.css";
import "./mocks.css";

import { StatusChip } from "@/components/mocks/StatusChip";
import { STORIES, storyHref, thumbnailFor } from "@/lib/mocks";

/**
 * `/mocks` — the index.
 *
 * Six cards, each with the number, the premise, a thumbnail, a status chip and the route. The chip is the point of
 * splitting the scroll: a story that is still a drawing says `drawn`, and a story with one live page says `live`.
 * The old single scroll could not say either without a paragraph of apology.
 *
 * The machine-readable version is `/mocks/index.json`, generated from the same `mocks-stories.json` these cards render.
 * Unlisted: `robots` says noindex, and nothing in the nav links here. The URL is the invitation, same as `/backlog`.
 */
export const metadata: Metadata = {
  title: "Mocks",
  description: "The Vouch model in six stories, each labelled drawn, live or not built.",
  robots: { index: false, follow: false, nocache: true },
};

export default function MocksIndexPage() {
  return (
    <main className="mocks-page">
      <div className="mocks-shell">
        <header className="mocks-index-head">
          <p className="mocks-eyebrow">Mocks · six stories</p>
          <h1>The model, one story at a time.</h1>
          <p className="mocks-lead">
            Six stories about a spending limit a human can set, watch and stop. Every frame carries a chip:{" "}
            <strong>drawn</strong> when an image exists, <strong>live</strong> when the feature is live,{" "}
            <strong>not built</strong> when neither is true. No frame is a screenshot of something that does not exist.
          </p>
          <p className="mocks-index-order">
            Reading order 1 → 5 → 3 → 4 → 2 → 6 · <a href="/mocks/index.json">index.json</a>
          </p>
        </header>

        <div className="mocks-card-grid">
          {STORIES.map((story) => {
            const thumbnail = thumbnailFor(story);
            return (
              <Link className="mocks-card" href={storyHref(story)} key={story.n}>
                <div className="mocks-card-thumb">
                  <span className="mocks-card-n">{String(story.n).padStart(2, "0")}</span>
                  {thumbnail ? (
                    // eslint-disable-next-line @next/next/no-img-element -- static storyboard assets; no layout shift to optimise
                    <img src={thumbnail.file} alt={thumbnail.alt} loading="lazy" decoding="async" />
                  ) : (
                    <span className="mocks-card-noimage">No image</span>
                  )}
                </div>
                <div className="mocks-card-body">
                  <div className="mocks-card-topline">
                    <span>Story {story.n}</span>
                    <StatusChip status={story.status} />
                  </div>
                  <h2>{story.title}</h2>
                  <p className="mocks-card-premise">{story.premise}</p>
                  <p className="mocks-card-meta">
                    {story.frames.length} frame{story.frames.length === 1 ? "" : "s"} ·{" "}
                    {story.frames.filter((frame) => frame.status === "live").length} live
                  </p>
                  <span className="mocks-card-cta">
                    Read story <span aria-hidden="true">→</span>
                  </span>
                </div>
              </Link>
            );
          })}
        </div>

        <footer className="mocks-index-foot">
          <p>
            Every image is rendered from <code>scripts/lib/pass-face.mjs</code> and{" "}
            <code>scripts/lib/pass-story.mjs</code>, the same layout modules that produce the Wallet assets. A drawing
            cannot drift from the mark without the renderer changing first.
          </p>
        </footer>
      </div>
    </main>
  );
}

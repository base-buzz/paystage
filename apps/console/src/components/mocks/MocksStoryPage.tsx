import Link from "next/link";

import { StatusChip } from "@/components/mocks/StatusChip";
import { adjacentStories, storyHref, type MockStory } from "@/lib/mocks";

/**
 * The shared anatomy every story route renders.
 *
 * Static-first: no state, no effects, no client component. The sticky caption and the swapping frame are CSS only, so
 * the page reads with JavaScript disabled — and an agent can fetch a story and cite `#f2-refusal` without knowing
 * anything about the layout.
 *
 * The image rule is enforced here, not in prose: `file` may only be rendered when it is non-null **and** the frame is
 * not `not built`. A `live` frame with no image is allowed on purpose — the live page is the evidence, and a
 * screenshot of it would be a copy that can go stale.
 */
export function MocksStoryPage({ story }: { story: MockStory }) {
  const { previous, next } = adjacentStories(story);

  return (
    <main className="mocks-page">
      <div className="mocks-shell">
        <nav className="mocks-breadcrumb" aria-label="Breadcrumb">
          <Link href="/mocks">Mocks</Link>
          <span aria-hidden="true">/</span>
          <span>
            Story {story.n} of 6
          </span>
        </nav>

        <header className="mocks-story-head">
          <p className="mocks-eyebrow">Story {story.n} of 6</p>
          <h1>{story.title}</h1>
          <p className="mocks-premise">{story.premise}</p>
          <div className="mocks-head-meta">
            <StatusChip status={story.status} />
            <span>
              {story.frames.length} frame{story.frames.length === 1 ? "" : "s"} · {story.slug}
            </span>
          </div>
          <p className="mocks-note">{story.statusNote}</p>
          {story.link ? (
            <a className="mocks-live-link" href={story.link.href}>
              {story.link.label} <span aria-hidden="true">↗</span>
            </a>
          ) : story.linkNote ? (
            <p className="mocks-nolink">{story.linkNote}</p>
          ) : null}
        </header>

        <nav className="mocks-frame-nav" aria-label="Frames in this story">
          {story.frames.map((frame, index) => (
            <a key={frame.id} href={`#${frame.id}`}>
              <span className="mocks-frame-nav-n">{String(index + 1).padStart(2, "0")}</span>
              <span>{frame.title}</span>
            </a>
          ))}
        </nav>

        <div className="mocks-frames">
          {story.frames.map((frame, index) => {
            return (
              <section className="mocks-frame" id={frame.id} key={frame.id}>
                <div className="mocks-frame-caption">
                  <div className="mocks-frame-topline">
                    <span>Frame {index + 1}</span>
                    <StatusChip status={frame.status} />
                  </div>
                  <h2>
                    <a className="mocks-frame-anchor" href={`#${frame.id}`}>
                      {frame.title}
                    </a>
                  </h2>
                  <p className="mocks-surface">
                    {frame.surface}
                    {frame.diagram ? " · diagram" : ""}
                  </p>
                  <p>{frame.caption}</p>
                  {frame.correction ? <aside className="mocks-correction">{frame.correction}</aside> : null}
                </div>

                <figure className="mocks-frame-media">
                  {frame.file !== null && frame.status !== "not built" ? (
                    // eslint-disable-next-line @next/next/no-img-element -- static storyboard assets; no layout shift to optimise
                    <img src={frame.file} alt={frame.alt ?? ""} loading="lazy" decoding="async" />
                  ) : (
                    <div className="mocks-frame-absent">
                      <p>
                        <strong>{frame.status === "live" ? "Live — no image" : "Not built — no image"}</strong>
                      </p>
                      <p>
                        {frame.status === "live"
                          ? "The feature exists; the link at the top of this story is the page itself, not a picture of it."
                          : "There is nothing to photograph yet, so this frame shows none."}
                      </p>
                    </div>
                  )}
                </figure>
              </section>
            );
          })}
        </div>

        <footer className="mocks-not">
          <h2>What this is not</h2>
          <p>{story.notThis}</p>
        </footer>

        <nav className="mocks-pager" aria-label="Story navigation">
          {previous ? (
            <Link className="mocks-pager-prev" href={storyHref(previous)}>
              <span>Previous</span>
              {previous.n} · {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next ? (
            <Link className="mocks-pager-next" href={storyHref(next)}>
              <span>Next</span>
              {next.n} · {next.title}
            </Link>
          ) : (
            <span />
          )}
        </nav>
      </div>
    </main>
  );
}

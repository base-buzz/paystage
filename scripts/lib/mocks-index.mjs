/**
 * The shape of `/mocks/index.json`, in one place.
 *
 * The page renders `apps/console/src/lib/mocks-stories.json`; the generator and the schema check read the same file.
 * `buildIndex()` is the only projection from a story to the machine-readable record, so the index cannot grow a field
 * the page does not have (or lose a frame the page renders).
 */

export const SOURCE_PATH = "apps/console/src/lib/mocks-stories.json";
export const INDEX_PATH = "apps/console/public/mocks/index.json";
export const PUBLIC_MOCKS = "apps/console/public/mocks";
export const APP_MOCKS = "apps/console/src/app/mocks";

export const STORY_STATUSES = ["drawn", "live", "not built"];
export const FRAME_STATUSES = ["drawn", "live", "not built"];
export const MAX_FRAMES = 4;

/** Reading order from the proposal: 1 → 5 → 3 → 4 → 2 → 6, stored by number. */
export const EXPECTED_STORIES = [
  { n: 1, slug: "setup" },
  { n: 2, slug: "works" },
  { n: 3, slug: "adjust" },
  { n: 4, slug: "stops" },
  { n: 5, slug: "checks" },
  { n: 6, slug: "fails" },
];

/** Exact fields the proposal defines. A new field is a decision, not a drift. */
export const STORY_KEYS = ["n", "slug", "premise", "status", "frames"];
export const FRAME_KEYS = ["id", "file", "status", "caption"];

export function buildIndex(stories) {
  return {
    stories: stories.map((story) => ({
      n: story.n,
      slug: story.slug,
      premise: story.premise,
      status: story.status,
      frames: story.frames.map((frame) => ({
        id: frame.id,
        file: frame.file ?? null,
        status: frame.status,
        caption: frame.caption,
      })),
    })),
  };
}

/** `not built` < `drawn` < `live`: a card can only be as mature as its most mature frame. */
export function maturity(status) {
  return status === "live" ? 2 : status === "drawn" ? 1 : 0;
}

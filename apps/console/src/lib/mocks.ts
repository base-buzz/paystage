import data from "./mocks-stories.json";

/**
 * The one source for `/mocks` — the index cards, the six story routes, and `public/mocks/index.json`.
 *
 * The data lives in JSON rather than TSX because a Node script has to read the exact same object to generate the
 * machine-readable index; importing a TSX module from `scripts/` would need a transpiler we do not have (and a new
 * dependency is not how this page should ship). The pages and the generator both read this file, so a frame can
 * never be on a card but missing from the index.
 *
 * The `status` vocabulary is deliberately small and load-bearing:
 *   drawn     — an image exists, and it is a drawing
 *   live      — the feature is live in the product (the frame may have no image on purpose)
 *   not built — no image and no live feature; never render an <img> for it
 */
export type MockStatus = "drawn" | "live" | "not built";

export type MockFrame = {
  id: string;
  /** Public path under `apps/console/public`; `null` when there is no image. */
  file: string | null;
  status: MockStatus;
  title: string;
  surface: string;
  diagram: boolean;
  alt: string | null;
  caption: string;
  correction?: string;
};

export type MockStory = {
  n: number;
  slug: string;
  title: string;
  premise: string;
  status: MockStatus;
  statusNote: string;
  notThis: string;
  link: { href: string; label: string } | null;
  linkNote: string | null;
  frames: MockFrame[];
};

const stories = data.stories as unknown as MockStory[];

/** Ordered by the proposal's reading order: 1 → 5 → 3 → 4 → 2 → 6. */
export const STORY_ORDER = [1, 5, 3, 4, 2, 6] as const;

export const STORIES: MockStory[] = STORY_ORDER.map((n) => {
  const story = stories.find((candidate) => candidate.n === n);
  if (!story) throw new Error(`mocks: story ${n} is missing from mocks-stories.json`);
  return story;
});

export function storyFor(n: number): MockStory {
  const story = STORIES.find((candidate) => candidate.n === n);
  if (!story) throw new Error(`mocks: story ${n} does not exist`);
  return story;
}

export function storyHref(story: MockStory): string {
  return `/mocks/${story.n}-${story.slug}`;
}

/** The first frame with an image, used for the index card's thumbnail. */
export function thumbnailFor(story: MockStory): { file: string; alt: string } | null {
  const frame = story.frames.find((candidate) => candidate.file !== null && candidate.status !== "not built");
  if (!frame?.file) return null;
  return { file: frame.file, alt: frame.alt ?? "" };
}

export function adjacentStories(story: MockStory): { previous: MockStory | null; next: MockStory | null } {
  const index = STORIES.findIndex((candidate) => candidate.n === story.n);
  return {
    previous: index > 0 ? STORIES[index - 1] : null,
    next: index >= 0 && index < STORIES.length - 1 ? STORIES[index + 1] : null,
  };
}

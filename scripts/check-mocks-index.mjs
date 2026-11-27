#!/usr/bin/env node
/**
 * `/mocks/index.json` is a claim, and a claim that cannot be checked is how a storyboard starts lying.
 *
 *   node scripts/check-mocks-index.mjs
 *
 * The schema check enforces the proposal's promises:
 *   - six stories, one per route, with unique slugs and frame ids;
 *   - every story has at least one frame and never more than four;
 *   - every `file` that is referenced exists under `apps/console/public/mocks/`;
 *   - a `drawn` frame has a real file, and a `not built` frame has none;
 *   - each story's card chip is as mature as its best frame (`live` if any frame is live, else `drawn`);
 *   - `index.json` is exactly the projection of `mocks-stories.json`, so it was generated, not hand-edited.
 *
 * Exit 0 clean · 1 a problem · 2 cannot read the source or index.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  APP_MOCKS,
  EXPECTED_STORIES,
  FRAME_KEYS,
  FRAME_STATUSES,
  INDEX_PATH,
  MAX_FRAMES,
  PUBLIC_MOCKS,
  SOURCE_PATH,
  STORY_KEYS,
  STORY_STATUSES,
  buildIndex,
  maturity,
} from "./lib/mocks-index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PUBLIC = join(ROOT, PUBLIC_MOCKS);
const APP = join(ROOT, APP_MOCKS);

function readJson(path) {
  if (!existsSync(join(ROOT, path))) {
    console.error(`mocks-index: ${path} is missing — run \`node scripts/gen-mocks-index.mjs\``);
    process.exit(2);
  }
  try {
    return JSON.parse(readFileSync(join(ROOT, path), "utf8"));
  } catch (error) {
    console.error(`mocks-index: ${path} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
}

const source = readJson(SOURCE_PATH);
const index = readJson(INDEX_PATH);
const problems = [];
const fail = (message) => problems.push(message);
const exactKeys = (object, keys, label) => {
  const actual = Object.keys(object).sort();
  const expected = [...keys].sort();
  if (actual.join(",") !== expected.join(",")) {
    fail(`${label}: expected exactly ${expected.join(", ")}; got ${actual.join(", ") || "nothing"}`);
  }
};

if (!Array.isArray(source.stories)) {
  console.error(`mocks-index: ${SOURCE_PATH} has no stories array`);
  process.exit(2);
}

const expected = buildIndex(source.stories);
if (JSON.stringify(index) !== JSON.stringify(expected)) {
  fail(`${INDEX_PATH} does not match ${SOURCE_PATH} — run \`node scripts/gen-mocks-index.mjs\``);
}

exactKeys(index, ["stories"], INDEX_PATH);
const stories = Array.isArray(index.stories) ? index.stories : [];

if (stories.length !== EXPECTED_STORIES.length) {
  fail(`${INDEX_PATH}: expected ${EXPECTED_STORIES.length} stories, got ${stories.length}`);
}

const expectedByNumber = new Map(EXPECTED_STORIES.map((story) => [story.n, story.slug]));
const seenSlugs = new Set();
const seenStoryNumbers = new Set();
const seenFrameIds = new Set();
const statusCount = { drawn: 0, live: 0, "not built": 0 };

stories.forEach((story, storyIndex) => {
  const where = `story ${story?.n ?? storyIndex + 1}`;
  if (!story || typeof story !== "object") {
    fail(`${where}: not an object`);
    return;
  }
  exactKeys(story, STORY_KEYS, where);

  if (!Number.isInteger(story.n) || story.n < 1 || story.n > 6) fail(`${where}: n must be an integer 1–6`);
  if (expectedByNumber.get(story.n) !== story.slug) {
    fail(`${where}: slug "${story.slug}" does not match the route for story ${story.n} ("${expectedByNumber.get(story.n)}")`);
  }
  if (seenSlugs.has(story.slug)) fail(`${where}: duplicate slug "${story.slug}"`);
  seenSlugs.add(story.slug);
  if (seenStoryNumbers.has(story.n)) fail(`${where}: duplicate story number ${story.n}`);
  seenStoryNumbers.add(story.n);

  if (typeof story.premise !== "string" || story.premise.trim() === "") fail(`${where}: premise is empty`);
  if (!STORY_STATUSES.includes(story.status)) fail(`${where}: status "${story.status}" is not one of ${STORY_STATUSES.join(", ")}`);

  if (!Array.isArray(story.frames)) {
    fail(`${where}: frames is not an array`);
    return;
  }
  if (story.frames.length < 1) fail(`${where}: has no frames`);
  if (story.frames.length > MAX_FRAMES) fail(`${where}: has ${story.frames.length} frames; the story maximum is ${MAX_FRAMES}`);

  story.frames.forEach((frame, frameIndex) => {
    const label = `${where} frame ${frameIndex + 1}`;
    if (!frame || typeof frame !== "object") {
      fail(`${label}: not an object`);
      return;
    }
    exactKeys(frame, FRAME_KEYS, label);

    if (typeof frame.id !== "string" || !new RegExp(`^f${story.n}-[a-z0-9-]+$`).test(frame.id)) {
      fail(`${label}: id "${frame.id}" must look like f${story.n}-name`);
    } else if (seenFrameIds.has(frame.id)) {
      fail(`${label}: duplicate frame id "${frame.id}"`);
    } else {
      seenFrameIds.add(frame.id);
    }

    if (!FRAME_STATUSES.includes(frame.status)) fail(`${label}: status "${frame.status}" is not one of ${FRAME_STATUSES.join(", ")}`);
    else statusCount[frame.status] += 1;

    if (typeof frame.caption !== "string" || frame.caption.trim() === "") fail(`${label}: caption is empty`);

    if (frame.file === null) {
      if (frame.status === "drawn") fail(`${label}: status drawn but file is null — a drawing must have an image`);
    } else if (typeof frame.file !== "string") {
      fail(`${label}: file must be a string path or null`);
    } else {
      if (!frame.file.startsWith("/mocks/")) {
        fail(`${label}: file "${frame.file}" must live under /mocks/`);
      } else {
        const filePath = resolve(PUBLIC, frame.file.slice("/mocks/".length));
        if (!filePath.startsWith(`${PUBLIC}${sep}`) && filePath !== PUBLIC) {
          fail(`${label}: file "${frame.file}" escapes ${PUBLIC_MOCKS}`);
        } else if (!existsSync(filePath)) {
          fail(`${label}: file "${frame.file}" is referenced but does not exist under ${PUBLIC_MOCKS}`);
        } else if (!statSync(filePath).isFile() || statSync(filePath).size === 0) {
          fail(`${label}: file "${frame.file}" is not a non-empty file`);
        }
      }
      if (frame.status === "not built") fail(`${label}: status not built but file is not null — do not show an image that does not exist`);
    }

    // A live frame may have no file on purpose: the live page is the evidence, and a screenshot goes stale.
  });

  const best = story.frames.reduce((max, frame) => Math.max(max, maturity(frame?.status)), 0);
  const expectedStatus = best === 2 ? "live" : best === 1 ? "drawn" : "not built";
  if (story.status !== expectedStatus) {
    fail(`${where}: card status "${story.status}" does not match its frames (expected "${expectedStatus}")`);
  }

  const route = join(APP, `${story.n}-${story.slug}`, "page.tsx");
  if (!existsSync(route)) fail(`${where}: route ${story.n}-${story.slug} has no page.tsx`);
});

for (const story of EXPECTED_STORIES) {
  if (!seenStoryNumbers.has(story.n)) fail(`story ${story.n} (${story.slug}) is missing from ${INDEX_PATH}`);
}
if (!existsSync(join(APP, "page.tsx"))) fail(`${APP_MOCKS}: the index has no page.tsx`);

if (problems.length > 0) {
  console.error(`mocks-index: ${problems.length} problem(s) in /mocks/index.json`);
  for (const problem of problems.slice(0, 30)) console.error(`  ${problem}`);
  if (problems.length > 30) console.error(`  …and ${problems.length - 30} more`);
  process.exit(1);
}

const storyLabel = `${stories.length} stories`;
const frameLabel = `${seenFrameIds.size} frames`;
const statusLabel = `${statusCount.drawn} drawn, ${statusCount.live} live, ${statusCount["not built"]} not built`;
console.log(`mocks-index: ${storyLabel}, ${frameLabel} (${statusLabel})`);
console.log(`mocks-index: every referenced image exists under ${PUBLIC_MOCKS}/; every drawn frame has one; no not-built frame has one`);
console.log(`mocks-index: ${INDEX_PATH} is the projection of ${SOURCE_PATH}, not a hand edit`);

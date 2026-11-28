import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

import {
  ASK_OPTIONS,
  NOT_A_LIST,
  NOT_CONNECTED,
  QUESTION,
  STORAGE_SENTENCE,
  countLabel,
  formatOpenedOn,
  initialAskView,
} from "../src/lib/ask-survey.ts";

/**
 * The page's copy and the count condition.
 *
 * There is no DOM renderer in this app's test runner and adding one would be a new dependency, so this
 * checks the two things a render would prove: the exact sentences/options are in the source, and the
 * count is inside the `showCount` branch with the not-connected sentence in the other branch. The view
 * logic itself is exercised directly in `ask-route.test.mjs`.
 */
const SITE = join(import.meta.dirname, "..");
const read = (...parts) => readFileSync(join(SITE, ...parts), "utf8");

const PAGE = read("src/app/ask/page.tsx");
const COMPONENT = read("src/components/ask-survey.tsx");
const PRIVACY = read("src/app/privacy/page.tsx");
const DIRECTORY = read("../console/src/app/directory/page.tsx");

test("the page renders the verbatim question and all three answers", () => {
  assert.ok(PAGE.includes("QUESTION"), "the page imports the shared question constant");
  assert.match(QUESTION, /^Would you put a team's agent spend behind a limit you can see\?$/);
  assert.deepEqual(
    ASK_OPTIONS.map((option) => option.value),
    ["yes", "no", "already"],
  );
  assert.deepEqual(
    ASK_OPTIONS.map((option) => option.label),
    ["Yes", "No", "Already do it"],
  );
  assert.match(COMPONENT, /ASK_OPTIONS\.map/);
  assert.match(COMPONENT, /\{option\.label\}/);
});

test("the required sentences are on the page, not paraphrased", () => {
  assert.ok(PAGE.includes("NOT_A_LIST"));
  assert.ok(PAGE.includes("STORAGE_SENTENCE"));
  assert.ok(COMPONENT.includes("NOT_CONNECTED"));
  assert.equal(NOT_A_LIST, "This is not a customer list. A click is not a payment.");
  assert.equal(
    STORAGE_SENTENCE,
    "Your answer is stored as a count, with a hashed IP address to stop repeat votes, and nothing else.",
  );
  assert.equal(NOT_CONNECTED, "The counter is not connected yet.");
});

test("the count is shown only in the showCount branch, with not-connected otherwise", () => {
  const countBranch = /view\.showCount && view\.count !== null \? \(([\s\S]*?)\) : \(\s*<p>\s*\{NOT_CONNECTED\}/;
  const match = COMPONENT.match(countBranch);
  assert.ok(match, "the component branches on showCount and falls back to NOT_CONNECTED");
  assert.match(match[1], /countLabel\(view\.count\)/);
});

test("nothing is pre-selected and no button is a disguised yes", () => {
  // Strip comments first: the file explains that it has no "no thanks" button, and that explanation
  // must not itself trip the check.
  const code = COMPONENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /defaultChecked|checked=|<input|type="radio"/);
  assert.doesNotMatch(code, /no thanks|No, thanks|not now/i);
  assert.match(code, /type="button"/);
});

test("the page reads the count per request and links the privacy page", () => {
  assert.match(PAGE, /export const dynamic = "force-dynamic"/);
  assert.match(PAGE, /await readAskSnapshot\(\)/);
  assert.match(PAGE, /href="\/privacy"/);
});

test("the privacy page covers a survey answer in one sentence", () => {
  assert.match(PRIVACY, /salted hash of your IP address/);
  assert.match(PRIVACY, /cannot answer twice in a day/);
  assert.ok(PRIVACY.includes("<code>/ask</code>"));
});

test("the console directory carries a one-line link to the question", () => {
  assert.match(DIRECTORY, /https:\/\/vouchguard\.app\/ask/);
  assert.match(DIRECTORY, /One question: would you put a team&apos;s agent spend behind a limit you can see\?/);
});

test("the opening date and count label are deterministic", () => {
  assert.equal(formatOpenedOn("2026-11-28"), "28 November 2026");
  assert.equal(countLabel(0), "0 responses");
  assert.equal(countLabel(1), "1 response");
  assert.equal(countLabel(12), "12 responses");
});

test("a not-connected snapshot never produces a shown count", () => {
  const view = initialAskView({
    connected: false,
    count: null,
    openedOn: "2026-11-28",
    reason: NOT_CONNECTED,
  });
  assert.equal(view.showCount, false);
  assert.equal(view.count, null);
  assert.equal(view.notice, NOT_CONNECTED);
});

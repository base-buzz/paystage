#!/usr/bin/env node
/**
 * Copy the shared Vouch artwork into this app at build time.
 *
 * The pass face and the storyboard are already produced by `scripts/lib/pass-face.mjs`
 * and `scripts/lib/pass-story.mjs` in the console checkout. This app must not carry a
 * second drawing of the same product, so this script copies the rendered files from
 * `apps/console/public/` instead of committing duplicates. `prebuild` (and `predev`)
 * run it, and `deploy:prod`/`preview` run it explicitly (OpenNext calls `next build`
 * directly, so npm's `prebuild` lifecycle does not fire there).
 *
 * **The list is explicit and required.** The 2026-11-26 incident was a live
 * `/pass/pass-face@2x.png` that answered 307 with a zero-byte body while every page
 * around it looked fine. A directory copy that happens to include the file is not a
 * guarantee; a required-file assertion is. The copy fails if any of these is missing
 * or zero bytes, before the build can ship a half-populated kit.
 *
 * Node stdlib only: no network, no new dependency.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONSOLE_PUBLIC = resolve(APP, "../../apps/console/public");
const PASS_SRC = join(CONSOLE_PUBLIC, "pass");
const MOCKS_SRC = join(CONSOLE_PUBLIC, "mocks");

/** Every pass file the site and the demo pass reference. Missing here is a shipped defect, not a warning. */
export const REQUIRED_PASS_FILES = [
  "pass-face@2x.png",
  "pass-face.svg",
  "strip.png",
  "strip@2x.png",
  "logo.png",
  "icon.png",
  "icon@2x.png",
  "icon@3x.png",
  "mark-active.svg",
  "mark-revoked.svg",
  "mark-expired.svg",
];

if (!existsSync(PASS_SRC)) {
  console.error(`copy-pass-assets: missing ${PASS_SRC} — run from a full paystage checkout`);
  process.exit(1);
}

const PUBLIC = join(APP, "public");
mkdirSync(PUBLIC, { recursive: true });

// The pass face, icons, logo and the three state marks: Apple's asset sizes, one master.
rmSync(join(PUBLIC, "pass"), { recursive: true, force: true });
cpSync(PASS_SRC, join(PUBLIC, "pass"), { recursive: true });

const problems = [];
for (const file of REQUIRED_PASS_FILES) {
  const path = join(PUBLIC, "pass", file);
  if (!existsSync(path)) {
    problems.push(`${file} is missing after the copy`);
    continue;
  }
  if (statSync(path).size === 0) problems.push(`${file} copied as 0 bytes`);
}
if (problems.length > 0) {
  console.error(`copy-pass-assets: ${problems.length} required pass asset(s) unusable:`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error("  run `node scripts/render-pass-assets.mjs` in the repo root, then retry");
  process.exit(1);
}

/**
 * URL-safe alias for the pass face.
 *
 * Cloudflare normalises `@` in a request path with a 307 to the percent-encoded path. The bytes are
 * fine after the redirect, but social crawlers (and any client that does not follow a 307 for an OG
 * image) see an empty response. The asset keeps its Apple-facing name; the page and the OG metadata
 * point at this alias, which serves the same bytes with no redirect.
 */
cpSync(join(PUBLIC, "pass", "pass-face@2x.png"), join(PUBLIC, "pass", "pass-face-2x.png"));

/*
 * The same normalisation applies to the icons, and the favicon is the one asset every page loads: `/pass/icon@2x.png`
 * answers 307 because Cloudflare normalises `@` in a path, so a strict client (and a crawler) sees an empty redirect
 * body. Aliases without the `@`, and the metadata points at these.
 */
for (const [from, to] of [
  ["icon@2x.png", "icon-2x.png"],
  ["icon@3x.png", "icon-3x.png"],
]) {
  cpSync(join(PUBLIC, "pass", from), join(PUBLIC, "pass", to));
}

// Only the storyboard frames this lander uses. story2/frame-pass are the wallet and
// activity frames; story1-pick/configure/confirm/provision are the four-step sequence.
const KEEP = /^(story1-(pick|configure|confirm|provision)|story2-.*|frame-pass-.*)\.png$/;
const mocksOut = join(PUBLIC, "mocks");
rmSync(mocksOut, { recursive: true, force: true });
mkdirSync(mocksOut, { recursive: true });
for (const file of readdirSync(MOCKS_SRC)) {
  if (KEEP.test(file)) cpSync(join(MOCKS_SRC, file), join(mocksOut, file));
}

console.log(`copy-pass-assets: ${REQUIRED_PASS_FILES.length} required pass files + ${readdirSync(mocksOut).length} storyboard frames -> public/`);

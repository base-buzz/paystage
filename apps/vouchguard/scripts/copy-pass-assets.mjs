#!/usr/bin/env node
/**
 * Copy the shared Vouch artwork into this app at build time.
 *
 * The pass face and the storyboard are already produced by `scripts/lib/pass-face.mjs`
 * and `scripts/lib/pass-story.mjs` in the console checkout. This app must not carry a
 * second drawing of the same product, so this script copies the rendered files from
 * `apps/console/public/` instead of committing duplicates. `prebuild` (and `predev`)
 * run it, so a source change in the console reaches this app on the next build.
 *
 * Node stdlib only: no network, no new dependency.
 */
import { cpSync, mkdirSync, existsSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CONSOLE_PUBLIC = resolve(APP, "../../apps/console/public");
const PASS_SRC = join(CONSOLE_PUBLIC, "pass");
const MOCKS_SRC = join(CONSOLE_PUBLIC, "mocks");

if (!existsSync(PASS_SRC)) {
  console.error(`copy-pass-assets: missing ${PASS_SRC} — run from a full paystage checkout`);
  process.exit(1);
}

const PUBLIC = join(APP, "public");
mkdirSync(PUBLIC, { recursive: true });

// The pass face, icons, logo and the three state marks: Apple's asset sizes, one master.
rmSync(join(PUBLIC, "pass"), { recursive: true, force: true });
cpSync(PASS_SRC, join(PUBLIC, "pass"), { recursive: true });

// Only the storyboard frames this lander uses. story2/frame-pass are the wallet and
// activity frames; story1-pick/configure/confirm/provision are the four-step sequence.
const KEEP = /^(story1-(pick|configure|confirm|provision)|story2-.*|frame-pass-.*)\.png$/;
const mocksOut = join(PUBLIC, "mocks");
rmSync(mocksOut, { recursive: true, force: true });
mkdirSync(mocksOut, { recursive: true });
for (const file of readdirSync(MOCKS_SRC)) {
  if (KEEP.test(file)) cpSync(join(MOCKS_SRC, file), join(mocksOut, file));
}

console.log(`copy-pass-assets: pass/ + ${readdirSync(mocksOut).length} storyboard frames -> public/`);

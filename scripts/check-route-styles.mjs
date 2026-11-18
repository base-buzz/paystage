#!/usr/bin/env node
/**
 * A route that renders `lp-*` classes must import `landing.css` in its own chunk.
 *
 * Twice now a page shipped unstyled and nobody saw it: `/try` (its paid section rendered as run-together text) and
 * `/zh` (the whole Chinese landing page came back as raw HTML — 785px of it against the English page's 7,311). In
 * the App Router a route only receives the CSS its own chunk imports, so `className="lp-wrap"` on a page that does
 * not import the stylesheet is markup with no rules — valid HTML, no error, no test.
 *
 *   node scripts/check-route-styles.mjs
 *
 * Exit 0 every page that needs the stylesheet imports it · 1 one does not · 2 cannot read the app tree.
 *
 * The check follows one level of component imports, which is where both real failures lived: the page imported a
 * component that used `lp-` classes, or used them itself.
 */
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps/console/src/app");
const STYLES = "landing.css";
const ROOT_STYLES = "globals.css";

if (!existsSync(APP)) {
  console.error(`route-styles: no app tree at ${APP}`);
  process.exit(2);
}

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name === "page.tsx") out.push(full);
  }
  return out;
}

/** Local components a page imports, resolved to files under src/. */
function localImports(source, pageDir) {
  const files = [];
  for (const m of source.matchAll(/from\s+"(@\/[^"]+|\.\.?\/[^"]+)"/g)) {
    const spec = m[1];
    const base = spec.startsWith("@/")
      ? join(ROOT, "apps/console/src", spec.slice(2))
      : resolve(pageDir, spec);
    for (const candidate of [`${base}.tsx`, `${base}.ts`, join(base, "index.tsx")]) {
      if (existsSync(candidate)) {
        files.push(candidate);
        break;
      }
    }
  }
  return files;
}

const pages = walk(APP);
if (pages.length === 0) {
  console.error("route-styles: found no page.tsx files");
  process.exit(2);
}

const problems = [];
let checked = 0;
for (const page of pages) {
  const source = readFileSync(page, "utf8");
  const needed = /className="[^"]*\blp-|\blp-[a-z]/.test(source);
  const viaComponent = localImports(source, dirname(page)).some((f) => /\blp-[a-z]/.test(readFileSync(f, "utf8")));
  if (!needed && !viaComponent) continue;
  checked += 1;

  // The import has to be in this route's own graph: the page, or a layout beside it.
  const routeDir = dirname(page);
  const candidates = [page];
  for (const f of ["layout.tsx"]) if (existsSync(join(routeDir, f))) candidates.push(join(routeDir, f));
  const imports = candidates.some((f) => {
    const text = readFileSync(f, "utf8");
    return text.includes(STYLES) || text.includes(ROOT_STYLES);
  });
  if (!imports) {
    problems.push(page.replace(`${ROOT}/`, ""));
  }
}

if (problems.length === 0) {
  console.log(`route-styles: ${checked} page(s) use lp- classes and import the stylesheet`);
  process.exit(0);
}
console.error("route-styles: these pages render lp- classes but never import landing.css — they will ship unstyled:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);

#!/usr/bin/env node
/**
 * `llms.txt` is the first thing an agent reads, and nothing was checking it (#465).
 *
 * The format is small enough to validate exactly: an H1 with the project name, one blockquote summary, H2 sections, and
 * link lists under them. We wrote the file and then told agents to read it — which is a claim about a file that nothing
 * parsed. A malformed one is worse than a missing one, because the agent gets a partial map and no error.
 *
 * Two extra assertions beyond the format, because they are the failure modes this site actually has:
 *   * every internal link must answer 200 from the **built** route table (a 404 in a map is a dead end);
 *   * the pages the site map calls canonical must be listed, so a new page cannot exist without being discoverable.
 *
 * Exit 0 clean · 1 malformed or a dead link · 2 the file is missing (which is a finding, not a pass).
 */
import { existsSync, readFileSync } from "node:fs";

/** Rendered from a route handler, so the words live in source; the check reads the same source the route serves. */
const ROUTE = "apps/console/src/app/llms.txt/route.ts";
const FULL = "apps/console/src/app/llms-full.txt/route.ts";

/** Canonical pages an agent should be able to reach from the map. Add to this list when a page becomes canonical. */
const CANONICAL = ["/glossary", "/lab", "/mocks", "/lists", "/state-of-x402", "/try"];

const problems = [];

if (!existsSync(ROUTE)) {
  console.error(`llms-txt: ${ROUTE} is missing — the map an agent reads first does not exist`);
  process.exit(2);
}

/**
 * The route builds its body from template literals, so a full render is not available without running Next. What *is*
 * checkable is the structure of the literal: the H1, the blockquote, the H2 headings and the links are all in the source,
 * and a template is compiled from them in order. So this asserts on the source's own text.
 */
const source = readFileSync(ROUTE, "utf8");
const body = source
  .slice(source.indexOf('export const dynamic'))
  .replace(/\\n/g, "\n")
  .replace(/\$\{[^}]*\}/g, "x");

// The body is a template literal, so the H1 arrives after a backtick rather than at the start of a line.
const h1 = body.match(/(?:^|[`\n])# ([^\n`]+)/m);
if (!h1) problems.push("no H1 — the first line must be `# <project name>`");
else if (!/paystage/i.test(h1[1])) problems.push(`the H1 is "${h1[1].slice(0, 40)}" — it should name the project`);

if (!/^> .+/m.test(body)) problems.push("no blockquote summary — the format requires one line under the H1");

const sections = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
if (sections.length < 2) problems.push(`only ${sections.length} H2 section(s) — a map with fewer than two sections is a stub`);

/**
 * Links: markdown `[label](/path)`. Each must be a real route in the app (a directory with a page, or a file route),
 * which is checkable from the filesystem without starting a server.
 */
/**
 * Links may be absolute (they are, for the site's own pages, so the file works when copied out of context) or
 * root-relative. Both are reduced to a path before the route check.
 */
const SITE = /^https?:\/\/paystage\.xyz/;
// Markdown links first, then bare URLs: the file uses the bare form in its list items, which the format allows.
const links = [
  ...body.matchAll(/\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g),
  ...body.matchAll(/(?:^|[\s(])(https?:\/\/paystage\.xyz[^\s)`]*)/g),
]
  .map((m) => m[1])
  .filter((url) => !/^https?:/.test(url) || SITE.test(url))
  .map((url) => url.replace(SITE, "").replace(/[.,)]$/, "") || "/");
const appDir = "apps/console/src/app";
const routeExists = (path) => {
  const clean = path.replace(/[?#].*$/, "").replace(/\/$/, "");
  if (clean === "") return true;
  const candidates = [
    `${appDir}${clean}/page.tsx`,
    `${appDir}${clean}/page.ts`,
    `${appDir}${clean}.tsx`,
    `${appDir}${clean}/route.ts`,
  ];
  return candidates.some((c) => existsSync(c));
};
for (const link of new Set(links)) {
  if (!link.startsWith("/")) continue;
  if (!routeExists(link)) problems.push(`link to ${link} has no route — a map with a dead end is worse than no map`);
}

for (const page of CANONICAL) {
  if (!links.includes(page)) problems.push(`the canonical page ${page} is not in the map — an agent will never find it`);
}

if (!existsSync(FULL)) problems.push(`${FULL} is missing — the full text is what an agent reads second`);

if (problems.length > 0) {
  console.error(`llms-txt: ${problems.length} problem(s)`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}
console.log(
  `llms-txt: H1 + blockquote + ${sections.length} section(s), ${new Set(links).size} link(s) all resolving, ` +
    `${CANONICAL.length} canonical page(s) listed`,
);

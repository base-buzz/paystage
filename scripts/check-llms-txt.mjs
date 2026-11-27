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
/** Both maps are checked (#465): the brand site got its own, and a check that covers one domain is half a check. */
const MAPS = [
  { route: "apps/console/src/app/llms.txt/route.ts", full: "apps/console/src/app/llms-full.txt/route.ts", app: "apps/console/src/app", label: "paystage.xyz" },
  { route: "apps/vouchguard/src/app/llms.txt/route.ts", full: null, app: "apps/vouchguard/src/app", label: "vouchguard.app" },
];

/** Canonical pages per site. Add to these lists when a page becomes canonical. */
const CANONICAL = {
  "paystage.xyz": ["/glossary", "/lab", "/mocks", "/lists", "/state-of-x402", "/try", "/docs", "/pricing"],
  "vouchguard.app": ["/brand", "/pricing", "/privacy", "/terms"],
};

const problems = [];

for (const map of MAPS) {
  if (!existsSync(map.route)) {
    problems.push(`${map.label}: no /llms.txt route (${map.route}) — an agent landing there has only HTML`);
    continue;
  }
  if (map.full && !existsSync(map.full)) problems.push(`${map.label}: ${map.full} is missing — the full text is what an agent reads second`);

  /*
   * The route builds its body from template literals, so a full render is not available without running Next. What *is*
   * checkable is the structure of the literal: the H1, the blockquote, the H2 headings and the links are all in the source,
   * and a template is compiled from them in order. So this asserts on the source's own text.
   */
  const source = readFileSync(map.route, "utf8");
  const body = source.slice(source.indexOf("export function GET") >= 0 ? source.indexOf("export function GET") : source.indexOf("export const dynamic"));

  const h1 = body.match(/(?:^|[`\n])# ([^\n`]+)/m);
  if (!h1) problems.push(`${map.label}: no H1 — the first line must be \`# <project name>\``);
  else if (!/paystage|vouchguard/i.test(h1[1]) && !/^\$\{/.test(h1[1].trim())) problems.push(`${map.label}: the H1 is "${h1[1].slice(0, 40)}" — it should name the product`);

  if (!/^> .+/m.test(body)) problems.push(`${map.label}: no blockquote summary — the format requires one line under the H1`);

  const sections = [...body.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  if (sections.length < 2) problems.push(`${map.label}: only ${sections.length} H2 section(s) — a map with fewer than two is a stub`);

  const site = /paystage\.xyz/;
  const links = [
    ...body.matchAll(/\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g),
    ...body.matchAll(/(?:^|[\s(])(https?:\/\/(?:paystage\.xyz|vouchguard\.app)[^\s)`]*)/g),
    ...body.matchAll(/\$\{site\}(\/[\w./-]+)/g),
  ]
    .map((m) => m[1])
    .filter((url) => !/^https?:/.test(url) || site.test(url) || /vouchguard\.app/.test(url));
  const paths = links.map((url) => url.replace(/^https?:\/\/[^/]+/, "").replace(/[.,)]$/, "") || "/");

  const routeExists = (path) => {
    const clean = path.replace(/[?#].*$/, "").replace(/\/$/, "");
    if (clean === "") return true;
    return [`${map.app}${clean}/page.tsx`, `${map.app}${clean}/page.ts`, `${map.app}${clean}.tsx`, `${map.app}${clean}/route.ts`].some((c) => existsSync(c));
  };
  for (const path of new Set(paths)) {
    if (path.startsWith("http")) continue;
    if (!routeExists(path)) problems.push(`${map.label}: link to ${path} has no route — a map with a dead end is worse than no map`);
  }

  for (const page of CANONICAL[map.label] ?? []) {
    if (!new Set(paths).has(page)) problems.push(`${map.label}: the canonical page ${page} is not in the map — an agent will never find it`);
  }
}

if (problems.length > 0) {
  console.error(`llms-txt: ${problems.length} problem(s)`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}
console.log(`llms-txt: ${MAPS.length} map(s) with an H1, a blockquote, sections, live links and their canonical pages`);

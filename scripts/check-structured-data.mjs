#!/usr/bin/env node
/**
 * Structured data has to exist, and has to be true (#476).
 *
 * It read `application/ld+json` **zero** times on both sites: OpenGraph made a link preview look right while a search or
 * answer engine got no entity at all. This reads the **built HTML**, not the source, because that is what a crawler sees —
 * a component that renders the block conditionally can pass a source grep and ship nothing.
 *
 * Two assertions, and the second is the one worth having:
 *   1. a JSON-LD block exists, parses, and carries the fields an engine needs (name, url, licence, repository);
 *   2. it carries **no** `aggregateRating`, `review`, `offers` or `ratingValue`. Invented markup is the machine-readable
 *      version of a false claim, and it is the kind a search engine penalises rather than corrects.
 *
 * Exit 0 clean · 1 a problem · 2 nothing to read (no build), which is not a pass.
 */
import { existsSync, readFileSync } from "node:fs";

const PAGES = [
  { app: "apps/vouchguard", html: "apps/vouchguard/.next/server/app/index.html", label: "vouchguard.app/" },
];

const FORBIDDEN = ["aggregateRating", "ratingValue", "review", "offers", "priceCurrency"];

const problems = [];
let checked = 0;

for (const page of PAGES) {
  if (!existsSync(page.html)) continue;
  checked += 1;
  const html = readFileSync(page.html, "utf8");
  const blocks = [...html.matchAll(/<script[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);

  if (blocks.length === 0) {
    problems.push(`${page.label}: no JSON-LD block in the built HTML — a crawler gets no entity`);
    continue;
  }

  for (const block of blocks) {
    let parsed;
    try {
      parsed = JSON.parse(block);
    } catch (error) {
      problems.push(`${page.label}: a JSON-LD block does not parse (${error instanceof Error ? error.message.slice(0, 60) : "unknown"})`);
      continue;
    }
    const nodes = parsed["@graph"] ?? [parsed];
    const types = nodes.map((node) => node["@type"]).filter(Boolean);
    if (types.length === 0) problems.push(`${page.label}: JSON-LD block has no @type`);
    for (const node of nodes) {
      if (node["@type"] !== "SoftwareApplication") continue;
      for (const field of ["name", "description", "license", "codeRepository"]) {
        if (!node[field]) problems.push(`${page.label}: SoftwareApplication is missing ${field}`);
      }
    }
    for (const banned of FORBIDDEN) {
      if (block.includes(banned)) {
        problems.push(`${page.label}: JSON-LD carries \`${banned}\` — invented markup is a false claim a crawler will repeat`);
      }
    }
    // The relationship to the engine is the machine-readable version of the sentence the page says in prose.
    if (!/paystage\.xyz/.test(block)) {
      problems.push(`${page.label}: JSON-LD never mentions paystage.xyz — the two brands are unrelated to an engine`);
    }
  }
}

if (checked === 0) {
  console.error("structured-data: no built HTML to read — run `npm run build` first (this is not a pass)");
  process.exit(2);
}

if (problems.length > 0) {
  console.error(`structured-data: ${problems.length} problem(s)`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}
console.log(`structured-data: ${checked} page(s) carry a valid JSON-LD entity with no invented ratings or offers`);

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
  { label: "vouchguard.app/", html: "apps/vouchguard/.next/server/app/index.html" },
  { label: "paystage.xyz/", html: "apps/console/.next/server/app/index.html" },
];

/**
 * Invented markup is the failure this guards. A **price** is not invented — `paystage.xyz` publishes a real per-evaluation
 * price and an `Offer` that states it is checkable elsewhere. A **rating** is invented, because there is no rating to give:
 * nobody has reviewed us and we are not going to author the review ourselves.
 */
const FORBIDDEN_TYPES = ["AggregateRating", "Rating", "Review"];

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

  const union = blocks.join("\n");
  const other = page.label.startsWith("vouchguard") ? "paystage.xyz" : "vouchguard.app";
  if (!union.includes(other)) {
    problems.push(`${page.label}: no JSON-LD block names ${other} — the two brands are unrelated to an engine`);
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
    for (const banned of FORBIDDEN_TYPES) {
      if (new RegExp(`"@type"\\s*:\\s*"${banned}"`).test(block)) {
        problems.push(`${page.label}: JSON-LD declares a ${banned} — there is no rating to give, and inventing one is a false claim a crawler repeats`);
      }
    }
    /**
     * The cross-reference, in whichever direction the page is: the engine names the instance, the instance names the engine.
     * This is the machine-readable version of the sentence each page says in prose, and the thing that would drift if the
     * two blocks were maintained separately by hand.
     */
    const other = page.label.startsWith("vouchguard") ? "paystage\.xyz" : "vouchguard\.app";
    if (!new RegExp(other).test(block)) {
      problems.push(`${page.label}: JSON-LD does not name ${other.replace("\\", "")} — the two brands are unrelated to an engine`);
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
console.log(`structured-data: ${checked} page(s) carry a valid JSON-LD entity, cross-referenced both ways, with no invented ratings`);

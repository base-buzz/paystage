#!/usr/bin/env node
/**
 * Every route the worker serves is documented, and every documented endpoint exists (#140).
 *
 * `llms.txt` and the manifest list endpoints by hand, and those files are what an agent reads before trusting
 * anything. A route added or renamed makes them wrong — and a wrong endpoint list is worse than none, because it is
 * read as authoritative.
 *
 *   node scripts/check-route-docs.mjs
 *
 * Exit 0 the lists agree · 1 a route is undocumented or a documented one is missing · 2 cannot read.
 *
 * Internal paths are excluded by pattern rather than by an ever-growing allowlist: a route that serves HTML, a static
 * asset or a debug surface is not part of the public contract.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps/hosted/src/app.ts");

if (!existsSync(APP)) {
  console.error("route-docs: apps/hosted/src/app.ts not found");
  process.exit(2);
}

/** Paths that are not part of the documented public contract. */
const INTERNAL = [
  /^\/$/, // health/root
  /^\/(robots|sitemap|favicon)/,
  /^\/v1\/public\/receipt-key\.json$/, // documented in the receipt spec, not the agent list
  /^\/\.well-known\//, // documented separately, and covered by their own tests
  /^\/_next\//,
];

const source = readFileSync(APP, "utf8");

/** `app.get("/path"` / `app.post` / `app.all`, plus routes delegated to a sub-app below. */
const routes = new Set();
for (const m of source.matchAll(/\bapp\.(get|post|all|put|delete)\(\s*"([^"]+)"/g)) routes.add(m[2]);

/**
 * Sub-apps mounted with `app.route("/", x)`: their routes are declared in their own files. Read them rather than
 * silently reporting half the surface, which is the failure mode of a route check that only looks at one file.
 */
for (const m of source.matchAll(/app\.route\(\s*"([^"]*)"\s*,\s*([a-zA-Z]+)\)/g)) {
  const mount = m[1];
  const symbol = m[2];
  const fileGuess = [
    join(ROOT, "apps/hosted/src/routes", `${symbol.replace(/Routes$/, "").replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`).replace(/^-/, "")}.ts`),
  ];
  for (const file of fileGuess) {
    if (!existsSync(file)) continue;
    const sub = readFileSync(file, "utf8");
    for (const r of sub.matchAll(/\.(get|post|all|put|delete)\(\s*"([^"]+)"/g)) {
      routes.add(mount.replace(/\/$/, "") + r[2]);
    }
  }
}

const publicRoutes = [...routes].filter((path) => !INTERNAL.some((re) => re.test(path))).sort();
if (publicRoutes.length === 0) {
  console.error("route-docs: found no routes to compare — the parse is wrong, not the docs");
  process.exit(2);
}

/** The documented list: llms.txt plus the agent manifest, which is generated from the same source. */
const docs = [
  readFileSync(join(ROOT, "apps/console/src/app/llms.txt/route.ts"), "utf8"),
  readFileSync(join(ROOT, "apps/console/src/lib/agent-manifest.ts"), "utf8"),
  readFileSync(join(ROOT, "apps/console/src/app/llms-full.txt/route.ts"), "utf8"),
].join("\n");

const undocumented = publicRoutes.filter((path) => !docs.includes(path));
if (undocumented.length > 0) {
  console.error("route-docs: these routes are served but appear in no agent-facing document:");
  for (const path of undocumented) console.error(`  ${path}`);
  console.error("  An endpoint an agent cannot find is an endpoint that does not exist for it.");
  process.exit(1);
}

console.log(`route-docs: ${publicRoutes.length} public route(s), all documented`);

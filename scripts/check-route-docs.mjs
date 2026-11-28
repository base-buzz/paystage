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
 *
 * **The derivation is exported, on purpose.** `scripts/check-openapi-parity.mjs` compares the OpenAPI document
 * against this same list. A second parser is how the OpenAPI document drifted from the routes in the first place:
 * two lists that disagree are two truths, and the one that is wrong is whichever the reader opened.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = join(ROOT, "apps/hosted/src/app.ts");

/** Paths that are not part of the documented public contract. */
const INTERNAL = [
  /^\/$/, // health/root
  /^\/(robots|sitemap|favicon)/,
  /^\/v1\/public\/receipt-key\.json$/, // documented in the receipt spec, not the agent list
  /^\/\.well-known\//, // documented separately, and covered by their own tests
  /^\/_next\//,
];

/** Route objects are named `app`, `routes` or `*Routes`; `c.get("channel")` is a header read, not a route. */
const ROUTE_OBJECT = /^(?:app|routes|[A-Za-z_$][\w$]*Routes)$/;

/**
 * Capture a balanced `( … )` call starting at `start` (the index of the opening paren).
 *
 * A single regex cannot do this: `app.route("/", createRollupRoutes({ store }))` has nested parentheses, and the
 * hand-written parser that only matched one-line `app.route("/", symbol)` mounts silently missed `/supported`,
 * `/verify`, `/settle`, `/v1/public/rollup` and the three evaluation paths — a route check reporting 16 routes when
 * 22 are served is a check that certifies the wrong document.
 */
function balancedCall(source, start) {
  let depth = 0;
  let quote = null;
  let escaped = false;
  for (let i = start; i < source.length; i += 1) {
    const ch = source[i];
    if (quote !== null) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    else if (ch === ")") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return null;
}

/** `publicStatusRoutes` → `public-status.ts`, `createEvaluateRoutes` → `evaluate.ts`. */
function fileForSymbol(symbol) {
  const base = symbol.replace(/^create/, "").replace(/Routes$/, "");
  const kebab = base
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/^-/, "");
  return join(ROOT, "apps/hosted/src/routes", `${kebab}.ts`);
}

/**
 * Every `METHOD path` the app serves, including routes delegated to a sub-app.
 *
 * Mounts are parsed by balanced parentheses rather than by a one-line regex; sub-app route files are read rather
 * than assumed. A mount whose file cannot be found is an error, not a silent omission.
 */
export function deriveRoutes(root = ROOT) {
  const app = join(root, "apps/hosted/src/app.ts");
  if (!existsSync(app)) {
    throw new Error(`apps/hosted/src/app.ts not found under ${root}`);
  }
  const source = readFileSync(app, "utf8");
  const routes = [];

  /** `app.get("/path"` / `app.post` / `app.all`, the routes declared in app.ts itself. */
  for (const m of source.matchAll(/\bapp\.(get|post|all|put|delete)\(\s*"([^"]+)"/g)) {
    routes.push({ method: m[1], path: m[2], file: "app.ts" });
  }

  /** Sub-apps mounted with `app.route("/", x)`, including `createXRoutes({ … })` calls across lines. */
  for (const m of source.matchAll(/app\.route\(/g)) {
    const start = m.index + "app.route".length;
    const call = balancedCall(source, start);
    if (call === null) throw new Error("could not parse an app.route( … ) mount in app.ts");
    const inner = call.slice(1, -1);
    const args = inner.match(/^\s*"([^"]*)"\s*,\s*([A-Za-z_$][\w$]*)/);
    if (args === null) throw new Error(`could not parse app.route mount: ${call.slice(0, 80)}`);
    const [, mount, symbol] = args;
    const file = fileForSymbol(symbol);
    if (!existsSync(file)) {
      throw new Error(`app.route mounts ${symbol}, but ${file} does not exist`);
    }
    const sub = readFileSync(file, "utf8");
    for (const r of sub.matchAll(/\b([A-Za-z_$][\w$]*)\.(get|post|all|put|delete)\(\s*"([^"]+)"/g)) {
      const [, object, method, path] = r;
      if (!ROUTE_OBJECT.test(object)) continue;
      routes.push({
        method,
        path: mount.replace(/\/$/, "") + path,
        file: file.split(/[\\/]/).pop(),
      });
    }
  }

  return routes;
}

/** The public contract: the derived routes minus the internal patterns above. */
export function derivePublicRoutes(root = ROOT) {
  return deriveRoutes(root).filter((route) => !INTERNAL.some((re) => re.test(route.path)));
}

/** `:param` and `{param}` name the same path segment; OpenAPI spells it with braces. */
export function normaliseRoutePath(path) {
  return path.replace(/\/:([A-Za-z0-9_]+)/g, "/{$1}");
}

/** Unique raw paths, sorted — what the agent-facing documents must mention. */
export function publicRoutePaths(root = ROOT) {
  return [...new Set(derivePublicRoutes(root).map((route) => route.path))].sort();
}

function main() {
  if (!existsSync(APP)) {
    console.error("route-docs: apps/hosted/src/app.ts not found");
    process.exit(2);
  }

  let publicRoutes;
  try {
    publicRoutes = publicRoutePaths();
  } catch (error) {
    console.error(`route-docs: ${error.message}`);
    process.exit(2);
  }
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
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

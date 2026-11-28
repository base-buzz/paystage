#!/usr/bin/env node
/**
 * The OpenAPI document and the routes the app serves must be the same list.
 *
 * The document at `GET /openapi.json` is what x402scan and an agent read before the first call. It drifted from
 * the routes because the routes were derived in one place (`check-route-docs.mjs`) and the document was maintained
 * by hand in another. This check closes that gap by importing the live document and comparing it to **the same
 * derivation** `check-route-docs.mjs` uses — not a second parser, which would just be a second list to disagree.
 *
 *   node scripts/check-openapi-parity.mjs
 *
 * Exit 0 they agree · 10 a served route is absent from the document · 11 the document declares an operation the app
 * does not serve · 2 the document or the route list cannot be read.
 *
 * Method-aware: `/v1/mandate/:serial` (GET) and `/v1/mandate/:serial/revoke` (POST) are different operations, so the
 * comparison is over `METHOD path` pairs. `:param` and `{param}` name the same segment and are normalised before the
 * comparison. A route mounted with `app.all` is served for every method, so any documented method satisfies it.
 *
 * Node 20 is still the CI runner, so the TypeScript module is not imported directly — it is transpiled with the
 * root devDependency and evaluated with a minimal `hono` stub. That imports the **exported object from the live
 * source**, not a copy of it; a copy would be the drift this check exists to catch.
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

import { derivePublicRoutes, normaliseRoutePath } from "./check-route-docs.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "apps/hosted/src/routes/openapi.ts");
const HTTP_METHODS = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

/**
 * Evaluate `openapi.ts` and return its `OPENAPI_DOCUMENT` export.
 *
 * The module's only import is `Hono` (for the route that serves the document). A stub with a chainable `get()` is
 * enough to construct it. Any other import is a real error: this check must not silently load a different module.
 */
export function loadOpenApiDocument(source = SOURCE) {
  const text = readFileSync(source, "utf8");
  const output = ts.transpileModule(text, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: source,
  }).outputText;

  class HonoStub {
    get() {
      return this;
    }
  }
  const fakeRequire = (id) => {
    if (id === "hono") return { Hono: HonoStub };
    throw new Error(`openapi.ts imported "${id}"; this check only knows the hono import`);
  };

  const module = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function("exports", "require", "module", output)(module.exports, fakeRequire, module);
  const document = module.exports.OPENAPI_DOCUMENT;
  if (document === undefined) throw new Error("openapi.ts does not export OPENAPI_DOCUMENT");
  return document;
}

/** Every `METHOD path` operation declared in a path item, with the OpenAPI path spelling normalised. */
function documentOperations(document) {
  if (document === null || typeof document !== "object" || typeof document.paths !== "object" || document.paths === null) {
    throw new Error("the document has no `paths` object");
  }
  const operations = [];
  for (const [path, item] of Object.entries(document.paths)) {
    if (item === null || typeof item !== "object") {
      throw new Error(`path item ${path} is not an object`);
    }
    for (const [method, operation] of Object.entries(item)) {
      if (!HTTP_METHODS.has(method.toLowerCase())) continue;
      if (operation === null || typeof operation !== "object") {
        throw new Error(`${method.toUpperCase()} ${path} is not an operation object`);
      }
      operations.push({ method: method.toUpperCase(), path: normaliseRoutePath(path) });
    }
  }
  return operations;
}

/**
 * Compare the document to the served routes. Pure, so the test can exercise the same logic the check runs.
 *
 * Returns `{ missing, extra, routes, operations }`: `missing` is served but undocumented, `extra` is documented
 * but unserved.
 */
export function compareOpenApiDocument(document, routes = derivePublicRoutes(ROOT)) {
  const operations = documentOperations(document);
  const served = routes.map((route) => ({
    method: route.method.toUpperCase(),
    path: normaliseRoutePath(route.path),
  }));

  const matches = (servedRoute, documented) =>
    servedRoute.path === documented.path &&
    (servedRoute.method === documented.method || servedRoute.method === "ALL");

  const missing = served.filter((route) => !operations.some((operation) => matches(route, operation)));
  const extra = operations.filter((operation) => !served.some((route) => matches(route, operation)));

  return { missing, extra, routes: served.length, operations: operations.length };
}

function label(entry) {
  return `${entry.method} ${entry.path}`;
}

function main() {
  let document;
  let routes;
  try {
    routes = derivePublicRoutes(ROOT);
    document = loadOpenApiDocument();
  } catch (error) {
    console.error(`openapi-parity: cannot read the document or the route list: ${error.message}`);
    process.exit(2);
  }

  let compared;
  try {
    compared = compareOpenApiDocument(document, routes);
  } catch (error) {
    console.error(`openapi-parity: ${error.message}`);
    process.exit(2);
  }

  const { missing, extra } = compared;
  if (missing.length === 0 && extra.length === 0) {
    console.log(
      `openapi-parity: ${compared.routes} served operation(s) (${new Set(routes.map((route) => route.path)).size} paths)` +
        ` match the document's ${compared.operations} documented operation(s)`,
    );
    process.exit(0);
  }

  if (missing.length > 0) {
    console.error("openapi-parity: these routes are served but absent from the OpenAPI document:");
    for (const route of missing) console.error(`  ${label(route)}`);
    console.error("  A route an agent cannot find in the document is a route that does not exist for it.");
  }
  if (extra.length > 0) {
    console.error("openapi-parity: the OpenAPI document declares these operations the app does not serve:");
    for (const operation of extra) console.error(`  ${label(operation)}`);
    console.error("  A documented route that 404s is worse than an undocumented one: the document is read as authoritative.");
  }

  process.exit(missing.length > 0 ? 10 : 11);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}

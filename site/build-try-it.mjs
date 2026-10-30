// Bundles site/try-it/entry.js -> site/try-it.bundle.js (ESM, browser).
// Resolves @x402/* and viem from apps/hosted/node_modules.
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const hostedModules = resolve(repoRoot, "apps/hosted/node_modules");

await build({
  entryPoints: [resolve(here, "try-it/entry.js")],
  outfile: resolve(here, "try-it.bundle.js"),
  bundle: true,
  format: "esm",
  platform: "browser",
  target: ["es2022"],
  sourcemap: false,
  minify: true,
  nodePaths: [hostedModules],
  logLevel: "info",
});
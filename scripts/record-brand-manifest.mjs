#!/usr/bin/env node
/**
 * Write `brand/asset-manifest.json`: the hash of every generated asset and of the masters it came from.
 *
 * Run by `scripts/brand-rebuild.mjs` **after** the last generator and again after the demo pass is signed. Running it by
 * hand is allowed, but it does not regenerate anything: it only records what is on disk, so a half-run stays detectable
 * by `check-brand-assets.mjs`.
 *
 *   node scripts/record-brand-manifest.mjs
 *
 * Exit 0 wrote the ledger · 1 a master or asset could not be read.
 */
import { writeFileSync } from "node:fs";
import { MANIFEST_PATH, buildManifest } from "./lib/brand-manifest.mjs";

try {
  const manifest = buildManifest();
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(
    `brand-manifest: ${Object.keys(manifest.assets).length} generated asset(s) hashed against ${Object.keys(manifest.masters).length} master(s) → ${MANIFEST_PATH}`,
  );
  console.log(`brand-manifest: master hash ${manifest.masterHash.slice(0, 16)} (${manifest.generatedAt})`);
} catch (error) {
  console.error(`brand-manifest: could not record the assets — ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

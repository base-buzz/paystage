#!/usr/bin/env node
/**
 * The registry probe's POST body must stay `{}`.
 *
 * `verify-registry.mjs` spent six days (2026-11-12 → 2026-11-18) marking every entry DEAD, including our
 * own, because its probe body was `{ payment_required: {…accepts: []}, policy: {} }`. Endpoints validate
 * that before the paywall and answer 400, so the probe concluded "not an x402 endpoint" about fourteen
 * endpoints that were all answering 402 to `{}`.
 *
 * Nothing failed. The check produced a confident negative for six days, and the bot issue carrying it was
 * scrolled past. This assertion exists so a future improvement to that body has to be a deliberate one.
 *
 *   node scripts/check-registry-probe.mjs
 *
 * Exit 0 the body is `{}` · 1 it is not
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(join(ROOT, "scripts/verify-registry.mjs"), "utf8");

const match = /body:\s*JSON\.stringify\((\{[^\n]*?\})\)/.exec(source);
if (!match) {
  console.error("registry-probe: could not find the POST body in verify-registry.mjs — the probe changed shape; update this check with it");
  process.exit(1);
}
const body = match[1].trim();
if (body !== "{}") {
  console.error(`registry-probe: POST body is ${body}, expected {}`);
  console.error("  A shaped body is rejected during validation *before* the paywall, which marks every entry dead.");
  process.exit(1);
}
console.log("registry-probe: POST body is `{}` — reaches the paywall, so a 400 means the endpoint, not the probe");

#!/usr/bin/env node
/**
 * The privacy page must describe the telemetry we actually write.
 *
 * A policy that understates collection is a lie with a footer link. This compares the field list in
 * `apps/console/src/app/privacy/page.tsx` against `TelemetryEvent` in `apps/hosted/src/telemetry.ts`, and fails when a
 * field exists in one and not the other — in either direction, because a field documented but never written is also a
 * wrong claim.
 *
 *   node scripts/check-privacy.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const telemetry = readFileSync(join(ROOT, "apps/hosted/src/telemetry.ts"), "utf8");
const page = readFileSync(join(ROOT, "apps/console/src/app/privacy/page.tsx"), "utf8");

const block = telemetry.slice(telemetry.indexOf("export interface TelemetryEvent"));
const body = block.slice(0, block.indexOf("}"));
const fields = [...body.matchAll(/^\s{2}([a-z_]+)\??:/gm)].map((m) => m[1]);

const problems = [];
for (const field of fields) {
  // The page names fields in prose, so accept the snake_case name or a plain-English equivalent of the same thing.
  const aliases = {
    reason_codes: "reason codes",
    pay_to: "payee",
    tx_hash: "transaction hash",
    payer: "payer address",
    latency_ms: "latency",
    amount_usdc: "amount",
    request_id: "request id",
    facilitator_status: "facilitator status",
    error_class: "error class",
    source: "source",
    tool: "tool",
    decision: "decision",
    network: "network",
  };
  const needle = aliases[field] ?? field;
  if (!page.toLowerCase().includes(needle.toLowerCase())) {
    problems.push(`telemetry records "${field}" but the privacy page never mentions it`);
  }
}


// ---- glossary ----
{
  const site = readFileSync(join(ROOT, "apps/console/src/app/page.tsx"), "utf8");
  const glossary = readFileSync(join(ROOT, "docs/glossary.md"), "utf8");
  // The words a stranger meets without explanation. Kept here so adding one to the site without defining it fails.
  const REQUIRED = [
    "x402", "facilitator", "settlement", "EIP-3009", "PAYMENT-REQUIRED", "CAIP-2", "atomic units", "payTo",
    "drainer", "sanctions", "allowlist", "policy", "velocity", "receipt", "provenance", "MCP", "HIP-3", "Permit2",
  ];
  const missing = REQUIRED.filter((t) => !new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(glossary));
  if (missing.length > 0) problems.push(`glossary is missing: ${missing.join(", ")}`);
  if (!site.includes("/glossary")) problems.push("the site footer does not link /glossary");
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  DRIFT ${p}`);
  console.log("privacy: page does not match telemetry");
  process.exit(1);
}
console.log(`privacy: page covers all ${fields.length} telemetry fields`);

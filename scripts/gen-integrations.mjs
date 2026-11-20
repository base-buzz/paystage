#!/usr/bin/env node
/**
 * Generate the integrations status page from its single source.
 *
 * `docs/state/integrations.json` is the only place a capability is recorded. This script renders it to
 * `docs/integrations/README.md`, and `--check` fails when the markdown has drifted. It also fails when any
 * `last_verified_at` is more than 90 days old, because a status table nobody refreshes is just a different
 * kind of hand-written claim.
 *
 *   node scripts/gen-integrations.mjs                  # write
 *   node scripts/gen-integrations.mjs --check          # exit 1 when stale or out of date
 *   node scripts/gen-integrations.mjs --today=YYYY-MM-DD  # fixed date, for proving the stale path
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "docs/state/integrations.json");
const OUT = join(ROOT, "docs/integrations/README.md");
const OUT_DIR = dirname(OUT);
const MAX_AGE_DAYS = 90;

const KINDS = new Set(["client", "framework", "library", "seller-pairing", "listing"]);
const STATUSES = new Set(["tested", "documented", "unverified"]);
const KIND_ORDER = new Map(["client", "framework", "library", "seller-pairing", "listing"].map((k, i) => [k, i]));

class UsageError extends Error {}

function parseArgs(argv) {
  const options = { check: false, today: new Date().toISOString().slice(0, 10) };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--check") {
      options.check = true;
    } else if (arg === "--today") {
      const value = argv[i + 1];
      if (!value) throw new UsageError("--today needs a YYYY-MM-DD value");
      options.today = value;
      i += 1;
    } else if (arg.startsWith("--today=")) {
      options.today = arg.slice("--today=".length);
    } else if (arg === "--help" || arg === "-h") {
      console.log("usage: node scripts/gen-integrations.mjs [--check] [--today=YYYY-MM-DD]");
      process.exit(0);
    } else {
      throw new UsageError(`unknown argument: ${arg}`);
    }
  }
  requireCalendarDate(options.today, "--today");
  return options;
}

function requireCalendarDate(value, label) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must be a calendar date in YYYY-MM-DD form, got ${JSON.stringify(value)}`);
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} is not a real date: ${value}`);
  }
}

function daysBetween(fromDate, toDate) {
  const from = Date.parse(`${fromDate}T00:00:00Z`);
  const to = Date.parse(`${toDate}T00:00:00Z`);
  return Math.floor((to - from) / 86_400_000);
}

function validate(model) {
  if (!model || typeof model !== "object") throw new Error("integrations.json must contain an object");
  if (model.schema_version !== 1) throw new Error(`schema_version must be 1, got ${JSON.stringify(model.schema_version)}`);
  if (!Array.isArray(model.entries) || model.entries.length === 0) throw new Error("entries must be a non-empty array");

  const ids = new Set();
  for (const [index, entry] of model.entries.entries()) {
    const where = `entries[${index}]`;
    if (!entry || typeof entry !== "object") throw new Error(`${where} must be an object`);
    for (const field of ["id", "name", "kind", "what_we_gate", "status", "evidence", "last_verified_at"]) {
      if (!entry[field]) throw new Error(`${where} is missing ${field}`);
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
      throw new Error(`${where}.id must be lower-case kebab-case`);
    }
    if (ids.has(entry.id)) throw new Error(`${where}.id is a duplicate: ${entry.id}`);
    ids.add(entry.id);
    if (!KINDS.has(entry.kind)) throw new Error(`${entry.id}: kind must be one of ${[...KINDS].join(", ")}`);
    if (!STATUSES.has(entry.status)) throw new Error(`${entry.id}: status must be one of ${[...STATUSES].join(", ")}`);
    if (typeof entry.name !== "string" || !entry.name.trim()) throw new Error(`${entry.id}: name must be non-empty`);
    if (typeof entry.what_we_gate !== "string" || !entry.what_we_gate.trim()) {
      throw new Error(`${entry.id}: what_we_gate must be non-empty`);
    }
    if (entry.what_we_gate.includes("\n")) throw new Error(`${entry.id}: what_we_gate must be one line`);
    requireCalendarDate(entry.last_verified_at, `${entry.id}.last_verified_at`);
    if (entry.status === "unverified" && (typeof entry.notes !== "string" || !entry.notes.trim())) {
      throw new Error(`${entry.id}: an unverified entry needs notes saying what is missing`);
    }

    const evidence = entry.evidence;
    if (!evidence || typeof evidence !== "object") throw new Error(`${entry.id}: evidence must be an object`);
    if (typeof evidence.command !== "string" || !evidence.command.trim()) {
      throw new Error(`${entry.id}: evidence.command must be the command that produced the evidence`);
    }
    if (!evidence.url && !evidence.path) throw new Error(`${entry.id}: evidence needs a url or a repo path`);
    if (evidence.url) {
      let parsed;
      try {
        parsed = new URL(evidence.url);
      } catch {
        throw new Error(`${entry.id}: evidence.url is not a URL: ${evidence.url}`);
      }
      if (!["http:", "https:"].includes(parsed.protocol)) throw new Error(`${entry.id}: evidence.url must be http(s)`);
    }
    if (evidence.path) {
      if (typeof evidence.path !== "string" || evidence.path.startsWith("/") || evidence.path.includes("..")) {
        throw new Error(`${entry.id}: evidence.path must be a repo-relative path without '..'`);
      }
      const absolute = resolve(ROOT, evidence.path);
      if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`${entry.id}: evidence.path escapes the repo`);
      if (!existsSync(absolute)) throw new Error(`${entry.id}: evidence.path does not exist: ${evidence.path}`);
    }
  }
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function evidenceCell(evidence) {
  const links = [];
  if (evidence.url) {
    let label = evidence.label || new URL(evidence.url).hostname;
    links.push(`[${markdownCell(label)}](${evidence.url})`);
  }
  if (evidence.path) {
    const target = relative(OUT_DIR, join(ROOT, evidence.path)).split("\\").join("/");
    const label = evidence.url ? basename(evidence.path) : evidence.path;
    links.push(`[${markdownCell(label)}](${target})`);
  }
  return `${links.join(" · ")}<br><code>${markdownCell(evidence.command)}</code>`;
}

function staleEntries(entries, today) {
  return entries
    .map((entry) => ({ entry, age: daysBetween(entry.last_verified_at, today) }))
    .filter(({ age }) => age > MAX_AGE_DAYS)
    .sort((a, b) => b.age - a.age);
}

function render(model) {
  const entries = [...model.entries].sort(
    (a, b) => KIND_ORDER.get(a.kind) - KIND_ORDER.get(b.kind) || a.name.localeCompare(b.name),
  );
  const counts = { tested: 0, documented: 0, unverified: 0 };
  for (const entry of entries) counts[entry.status] += 1;

  const lines = [
    "# Integrations and consumers",
    "",
    "<!-- Generated by scripts/gen-integrations.mjs from docs/state/integrations.json — do not edit. -->",
    "",
    "A row is a claim about a surface PayStage gates or ships on. `tested` means a test or live probe run on the",
    "recorded date produced the state; `documented` means prose exists but the target was not driven; `unverified`",
    "means we have not tested it or the surface is not current — the note says which. When `last_verified_at` is more",
    "than 90 days old, `node scripts/gen-integrations.mjs --check` fails and names the row.",
    "",
    `**${entries.length} entries:** ${counts.tested} tested · ${counts.documented} documented · ${counts.unverified} unverified.`,
    "",
    "The seller-side pairing page is [PayMCP](paymcp.md); it stays prose and is linked from the PayMCP row below.",
    "",
    "| Name | Kind | What we gate | Status | Evidence | Last verified |",
    "| --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of entries) {
    lines.push(
      `| ${markdownCell(entry.name)} | \`${entry.kind}\` | ${markdownCell(entry.what_we_gate)} | \`${entry.status}\` | ${evidenceCell(entry.evidence)} | ${entry.last_verified_at} |`,
    );
  }

  const noted = entries.filter((entry) => typeof entry.notes === "string" && entry.notes.trim());
  if (noted.length > 0) {
    lines.push("", "## Notes", "");
    for (const entry of noted) lines.push(`- **${markdownCell(entry.name)}** — ${markdownCell(entry.notes)}`);
  }

  lines.push("");
  return `${lines.join("\n")}\n`;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  let model;
  try {
    model = JSON.parse(readFileSync(SOURCE, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${relative(ROOT, SOURCE)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  validate(model);

  const stale = staleEntries(model.entries, options.today);
  if (stale.length > 0) {
    console.error(`integrations: ${stale.length} entr${stale.length === 1 ? "y is" : "ies are"} older than ${MAX_AGE_DAYS} days (as of ${options.today}):`);
    for (const { entry, age } of stale) {
      console.error(`  - ${entry.id} — last_verified_at ${entry.last_verified_at} (${age} days old; run the evidence command and update the date)`);
    }
    console.error("integrations: refresh the evidence and dates in docs/state/integrations.json before generating");
    process.exit(1);
  }

  const next = render(model);
  const current = existsSync(OUT) ? readFileSync(OUT, "utf8") : "";

  if (options.check) {
    if (current !== next) {
      console.error(
        `integrations: ${relative(ROOT, OUT)} is out of date — run node scripts/gen-integrations.mjs (source: ${relative(ROOT, SOURCE)})`,
      );
      process.exit(1);
    }
    console.log(`integrations: ${relative(ROOT, OUT)} is current (${model.entries.length} entries, checked as of ${options.today})`);
    return;
  }

  writeFileSync(OUT, next);
  console.log(`integrations: wrote ${relative(ROOT, OUT)} — ${model.entries.length} entries`);
}

try {
  main();
} catch (error) {
  if (error instanceof UsageError) {
    console.error(`integrations: ${error.message}`);
    process.exit(2);
  }
  console.error(`integrations: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(2);
}

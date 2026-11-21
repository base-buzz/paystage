#!/usr/bin/env node
/**
 * Generate the integrations grading page from its single source.
 *
 * `docs/state/integrations.json` is the only place an integration is graded. This script renders it to
 * `docs/integrations/README.md`, and `--check` fails when the markdown has drifted. It also fails when any
 * known `last_verified_at` is more than 90 days old, because a status table nobody refreshes is just a different
 * kind of hand-written claim. Rows with an unknown date are skipped by that clock — they carry no date to age.
 *
 * The six grading fields are validated here and again, more strictly, in
 * `scripts/check-integrations-grading.mjs`; this script must stay a faithful renderer, not the only guard.
 *
 *   node scripts/gen-integrations.mjs                  # write
 *   node scripts/gen-integrations.mjs --check          # exit 1 when stale or out of date
 *   node scripts/gen-integrations.mjs --today=YYYY-MM-DD  # fixed date, for proving the stale path
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "docs/state/integrations.json");
const OUT = join(ROOT, "docs/integrations/README.md");
const OUT_DIR = dirname(OUT);
const MAX_AGE_DAYS = 90;

const KINDS = new Set(["client", "framework", "library", "seller-pairing", "listing"]);
const GRADES = {
  pre_action_enforcement: new Set(["none", "experimental", "tested"]),
  receipt_support: new Set(["none", "local", "hosted_execution", "settlement"]),
  proof_class: new Set(["test", "run-log", "screenshot", "upstream-merge", "public-listing", "none"]),
};
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

function validateEvidenceRef(id, ref) {
  if (ref === null) return;
  if (typeof ref !== "string" || !ref.trim()) throw new Error(`${id}.evidence_ref must be a non-empty string or null`);
  if (/^https?:\/\//.test(ref)) {
    let parsed;
    try {
      parsed = new URL(ref);
    } catch {
      throw new Error(`${id}.evidence_ref is not a URL: ${ref}`);
    }
    if (parsed.protocol !== "https:") throw new Error(`${id}.evidence_ref URL must be https`);
    return;
  }
  if (ref.startsWith("/") || ref.includes("..")) {
    throw new Error(`${id}.evidence_ref must be a repo-relative path without '..', or an https URL`);
  }
  const absolute = resolve(ROOT, ref);
  if (!absolute.startsWith(`${ROOT}/`)) throw new Error(`${id}.evidence_ref escapes the repo`);
  if (!existsSync(absolute)) throw new Error(`${id}.evidence_ref does not exist: ${ref}`);
}

function validate(model) {
  if (!model || typeof model !== "object") throw new Error("integrations.json must contain an object");
  if (model.schema_version !== 2) throw new Error(`schema_version must be 2, got ${JSON.stringify(model.schema_version)}`);
  if (!Array.isArray(model.entries) || model.entries.length === 0) throw new Error("entries must be a non-empty array");

  const ids = new Set();
  for (const [index, entry] of model.entries.entries()) {
    const where = `entries[${index}]`;
    if (!entry || typeof entry !== "object") throw new Error(`${where} must be an object`);
    for (const field of ["id", "name", "kind", "what_we_gate", "pre_action_enforcement", "receipt_support", "host_version_tested", "proof_class", "last_verified_at", "evidence_ref"]) {
      if (!Object.prototype.hasOwnProperty.call(entry, field)) throw new Error(`${where} is missing ${field}`);
    }
    if (typeof entry.id !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(entry.id)) {
      throw new Error(`${where}.id must be lower-case kebab-case`);
    }
    if (ids.has(entry.id)) throw new Error(`${where}.id is a duplicate: ${entry.id}`);
    ids.add(entry.id);
    if (!KINDS.has(entry.kind)) throw new Error(`${entry.id}: kind must be one of ${[...KINDS].join(", ")}`);
    if (typeof entry.name !== "string" || !entry.name.trim()) throw new Error(`${entry.id}: name must be non-empty`);
    if (typeof entry.what_we_gate !== "string" || !entry.what_we_gate.trim()) {
      throw new Error(`${entry.id}: what_we_gate must be non-empty`);
    }
    if (entry.what_we_gate.includes("\n")) throw new Error(`${entry.id}: what_we_gate must be one line`);
    for (const [field, allowed] of Object.entries(GRADES)) {
      if (!allowed.has(entry[field])) throw new Error(`${entry.id}: ${field} must be one of ${[...allowed].join(", ")}`);
    }
    if (typeof entry.host_version_tested !== "string" || !entry.host_version_tested.trim() || /\s/.test(entry.host_version_tested)) {
      throw new Error(`${entry.id}: host_version_tested must be an exact version string or "unknown"`);
    }
    if (entry.last_verified_at !== null) requireCalendarDate(entry.last_verified_at, `${entry.id}.last_verified_at`);
    validateEvidenceRef(entry.id, entry.evidence_ref);
    if (entry.evidence_ref === null && (entry.pre_action_enforcement !== "none" || entry.receipt_support !== "none" || entry.host_version_tested !== "unknown" || entry.proof_class !== "none" || entry.last_verified_at !== null)) {
      throw new Error(`${entry.id}: without evidence_ref the row must say unknown (none/unknown/none/null)`);
    }
    if (typeof entry.notes !== "string" || !entry.notes.trim()) throw new Error(`${entry.id}: notes must say why the row is graded as it is`);
  }
}

function markdownCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function evidenceCell(entry) {
  if (entry.evidence_ref === null) return "unknown";
  let link;
  if (/^https?:\/\//.test(entry.evidence_ref)) {
    link = `[${markdownCell(new URL(entry.evidence_ref).hostname)}](${entry.evidence_ref})`;
  } else {
    const target = relative(OUT_DIR, join(ROOT, entry.evidence_ref)).split("\\").join("/");
    link = `[${markdownCell(entry.evidence_ref)}](${target})`;
  }
  const command = typeof entry.evidence_command === "string" && entry.evidence_command.trim()
    ? `<br><code>${markdownCell(entry.evidence_command)}</code>`
    : "";
  return `${link}${command}`;
}

function staleEntries(entries, today) {
  return entries
    .filter((entry) => entry.last_verified_at !== null)
    .map((entry) => ({ entry, age: daysBetween(entry.last_verified_at, today) }))
    .filter(({ age }) => age > MAX_AGE_DAYS)
    .sort((a, b) => b.age - a.age);
}

function countLine(entries) {
  const withEvidence = entries.filter((entry) => entry.evidence_ref !== null).length;
  const noEvidence = entries.filter((entry) => entry.evidence_ref === null).length;
  const unknown = entries.filter(
    (entry) => entry.host_version_tested === "unknown" || entry.last_verified_at === null,
  ).length;
  return `**${entries.length} rows · ${withEvidence} with evidence · ${unknown} carrying an unknown · ${noEvidence} with no evidence.**`;
}

function render(model) {
  const entries = [...model.entries].sort(
    (a, b) => KIND_ORDER.get(a.kind) - KIND_ORDER.get(b.kind) || a.name.localeCompare(b.name),
  );

  const lines = [
    "# Integrations and consumers",
    "",
    "<!-- Generated by scripts/gen-integrations.mjs from docs/state/integrations.json — do not edit. -->",
    "",
    "These rows grade each surface on dimensions that are deliberately not inferable from each other. " +
      "`pre_action_enforcement` says how far a payment is actually stopped before it is signed: `none` means no enforcement was observed, " +
      "`experimental` means something runs the integration but no gated payment was proven through it, and `tested` means a test or run we can point at. " +
      "`receipt_support` is the strongest receipt path proven, and only moves `none` → `local` → `hosted_execution` → `settlement` when evidence for that exact step exists — a settlement is never inferred from an execution receipt. " +
      "`host_version_tested` is the exact host version, or `unknown`. `proof_class` names the kind of artifact behind the row. " +
      "`last_verified_at` is the date of that artifact, or `unknown` when nothing was verified. " +
      "`evidence_ref` is a repo path or https URL a reviewer can open, or `unknown`. " +
      "We do not infer enforcement from an example, deployment from a local test, or settlement from an execution receipt; when evidence is missing the value stays unknown rather than becoming a guess. " +
      "When a known `last_verified_at` is more than 90 days old, `node scripts/gen-integrations.mjs --check` fails and names the row.",
    "",
    countLine(entries),
    "",
    "The seller-side pairing page is [PayMCP](paymcp.md); it stays prose and is linked from the PayMCP row below.",
    "",
    "| Name | Kind | What we gate | Pre-action enforcement | Receipt support | Host version tested | Proof class | Last verified | Evidence |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];

  for (const entry of entries) {
    lines.push(
      `| ${markdownCell(entry.name)} | \`${entry.kind}\` | ${markdownCell(entry.what_we_gate)} | \`${entry.pre_action_enforcement}\` | \`${entry.receipt_support}\` | ${entry.host_version_tested === "unknown" ? "unknown" : `\`${markdownCell(entry.host_version_tested)}\``} | \`${entry.proof_class}\` | ${entry.last_verified_at ?? "unknown"} | ${evidenceCell(entry)} |`,
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

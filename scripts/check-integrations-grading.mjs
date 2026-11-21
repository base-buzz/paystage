#!/usr/bin/env node
/**
 * Guard the integrations grading: the six dimensions are present, honest, and in step with the generated page.
 *
 * The old table had one word of status per row, and "tested" there could mean a unit test, a live probe, or a
 * sentence in a README. This guard forces each of those facts into its own field and refuses a strong value that
 * has nothing behind it:
 *
 *   - every row carries all six fields, even when the value is `unknown`/`null`;
 *   - `evidence_ref` is a real repo path or an https URL — **http(s) URLs are not fetched here** (the build has no
 *     network contract and a dead page is check-listings' job, not this guard's);
 *   - `tested` enforcement, any `experimental` enforcement, any receipt support, and any known `last_verified_at`
 *     need an `evidence_ref`; `settlement` additionally needs a settlement-shaped ref (a settlement path or a
 *     transaction link), because an execution receipt is not a settlement;
 *   - a row with no `evidence_ref` must say `unknown` everywhere rather than guess;
 *   - the generated `docs/integrations/README.md` matches the JSON, by running the generator's `--check`.
 *
 *   node scripts/check-integrations-grading.mjs
 *   exit 0 pass · 1 a row is missing, unbacked, or the generated page drifted · 2 the source cannot be read
 */
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = resolve(ROOT, "docs/state/integrations.json");
const GENERATED = resolve(ROOT, "docs/integrations/README.md");

const FIELDS = [
  "pre_action_enforcement",
  "receipt_support",
  "host_version_tested",
  "proof_class",
  "last_verified_at",
  "evidence_ref",
];
const ENUMS = {
  pre_action_enforcement: ["none", "experimental", "tested"],
  receipt_support: ["none", "local", "hosted_execution", "settlement"],
  proof_class: ["test", "run-log", "screenshot", "upstream-merge", "public-listing", "none"],
};

/** Paths/URLs that are specifically a settlement record, not merely an execution receipt or a test. */
function isSettlementRef(ref) {
  if (typeof ref !== "string") return false;
  return (
    /(?:^|\/)(?:settlements?|settled)(?:\/|$)/i.test(ref) ||
    /\/tx\/0x[0-9a-f]{64}(?:$|[?#])/i.test(ref) ||
    /^0x[0-9a-f]{64}$/i.test(ref)
  );
}

function requireCalendarDate(id, value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return `${id}.last_verified_at must be an ISO date (YYYY-MM-DD) or null`;
  }
  const ms = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(ms) || new Date(ms).toISOString().slice(0, 10) !== value) {
    return `${id}.last_verified_at is not a real calendar date: ${value}`;
  }
  return null;
}

function checkEvidenceRef(id, ref) {
  if (ref === null) return null;
  if (typeof ref !== "string" || !ref.trim()) return `${id}.evidence_ref must be a non-empty string or null`;
  if (/^https?:\/\//i.test(ref)) {
    let parsed;
    try {
      parsed = new URL(ref);
    } catch {
      return `${id}.evidence_ref is not a URL: ${ref}`;
    }
    // Deliberately not fetched: an unreachable URL is check-listings/check-published-links territory.
    if (parsed.protocol !== "https:") return `${id}.evidence_ref URL must be https: ${ref}`;
    return null;
  }
  if (ref.startsWith("/") || ref.includes("..")) {
    return `${id}.evidence_ref must be repo-relative without '..', or an https URL: ${ref}`;
  }
  const absolute = resolve(ROOT, ref);
  if (!absolute.startsWith(`${ROOT}/`)) return `${id}.evidence_ref escapes the repo: ${ref}`;
  if (!existsSync(absolute)) return `${id}.evidence_ref points at a missing repo path: ${ref}`;
  return null;
}

function checkEntry(entry, index) {
  const problems = [];
  const id = typeof entry?.id === "string" ? entry.id : `entries[${index}]`;
  if (!entry || typeof entry !== "object") return [`entries[${index}] must be an object`];
  for (const field of FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) problems.push(`${id}: missing ${field}`);
  }
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(entry[field])) problems.push(`${id}: ${field} must be one of ${allowed.join(", ")} (got ${JSON.stringify(entry[field])})`);
  }
  if (typeof entry.host_version_tested !== "string" || !entry.host_version_tested.trim()) {
    problems.push(`${id}: host_version_tested must be an exact version string or "unknown"`);
  } else if (/\s/.test(entry.host_version_tested)) {
    problems.push(`${id}: host_version_tested must be one version string without whitespace (got ${JSON.stringify(entry.host_version_tested)})`);
  } else if (/^(latest|current|head|main|n\/?a|tbd)$/i.test(entry.host_version_tested)) {
    problems.push(`${id}: host_version_tested must be exact, not ${JSON.stringify(entry.host_version_tested)}`);
  }
  if (typeof entry.notes !== "string" || !entry.notes.trim()) {
    problems.push(`${id}: notes must say what the evidence does and does not prove`);
  }

  const dateProblem = entry.last_verified_at === null ? null : requireCalendarDate(id, entry.last_verified_at);
  if (dateProblem) problems.push(dateProblem);

  const refProblem = checkEvidenceRef(id, entry.evidence_ref);
  if (refProblem) problems.push(refProblem);

  if (entry.pre_action_enforcement === "tested" && !entry.evidence_ref) {
    problems.push(`${id}: tested enforcement needs an evidence_ref`);
  }
  if (entry.pre_action_enforcement === "experimental" && !entry.evidence_ref) {
    problems.push(`${id}: experimental enforcement needs an evidence_ref showing what runs it`);
  }
  if (entry.receipt_support !== "none" && !entry.evidence_ref) {
    problems.push(`${id}: receipt_support ${entry.receipt_support} needs its own evidence_ref`);
  }
  if (entry.receipt_support === "settlement" && !isSettlementRef(entry.evidence_ref)) {
    problems.push(`${id}: receipt_support settlement needs a settlement ref (a settlement path or a transaction link), not an execution receipt`);
  }
  if (entry.last_verified_at !== null && !entry.evidence_ref) {
    problems.push(`${id}: last_verified_at ${entry.last_verified_at} needs an evidence_ref`);
  }
  if (entry.proof_class !== "none" && !entry.evidence_ref) {
    problems.push(`${id}: proof_class ${entry.proof_class} needs an evidence_ref`);
  }

  if (entry.evidence_ref === null) {
    if (entry.pre_action_enforcement !== "none") problems.push(`${id}: pre_action_enforcement is ${JSON.stringify(entry.pre_action_enforcement)} with no evidence_ref`);
    if (entry.receipt_support !== "none") problems.push(`${id}: receipt_support is ${JSON.stringify(entry.receipt_support)} with no evidence_ref`);
    if (entry.host_version_tested !== "unknown") problems.push(`${id}: host_version_tested is ${JSON.stringify(entry.host_version_tested)} with no evidence_ref`);
    if (entry.proof_class !== "none") problems.push(`${id}: proof_class is ${JSON.stringify(entry.proof_class)} with no evidence_ref`);
    if (entry.last_verified_at !== null) problems.push(`${id}: last_verified_at is ${entry.last_verified_at} with no evidence_ref`);
  }
  return problems;
}

function checkDrift() {
  try {
    execFileSync(process.execPath, ["scripts/gen-integrations.mjs", "--check"], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: "pipe",
    });
    return [];
  } catch (error) {
    const detail = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim().split("\n").slice(-4).join(" | ");
    return [
      `generated page drift: ${detail || "node scripts/gen-integrations.mjs --check exited non-zero"}` +
        (existsSync(GENERATED) ? "" : " (docs/integrations/README.md is missing)"),
    ];
  }
}

function main() {
  let model;
  try {
    model = JSON.parse(readFileSync(SOURCE, "utf8"));
  } catch (error) {
    console.error(`integrations-grading: cannot read ${SOURCE}: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(2);
  }
  if (!model || typeof model !== "object" || !Array.isArray(model.entries)) {
    console.error("integrations-grading: integrations.json must contain an entries array");
    process.exit(2);
  }
  if (model.schema_version !== 2) {
    console.error(`integrations-grading: schema_version must be 2, got ${JSON.stringify(model.schema_version)}`);
    process.exit(2);
  }

  const problems = [];
  const ids = new Set();
  for (const [index, entry] of model.entries.entries()) {
    problems.push(...checkEntry(entry, index));
    if (entry && typeof entry.id === "string") {
      if (ids.has(entry.id)) problems.push(`duplicate id: ${entry.id}`);
      ids.add(entry.id);
    }
  }
  problems.push(...checkDrift());

  if (problems.length > 0) {
    console.error(`integrations-grading: ${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const count = (field, bucket) => model.entries.filter((entry) => entry[field] === bucket).length;
  const evidence = model.entries.filter((entry) => entry.evidence_ref !== null).length;
  const unknown = model.entries.filter(
    (entry) => entry.host_version_tested === "unknown" || entry.last_verified_at === null,
  ).length;
  console.log(
    `integrations-grading: ${model.entries.length} rows — pre_action_enforcement ` +
      ["none", "experimental", "tested"].map((bucket) => `${bucket}=${count("pre_action_enforcement", bucket)}`).join(" ") +
      `; receipt_support ` +
      ["none", "local", "hosted_execution", "settlement"].map((bucket) => `${bucket}=${count("receipt_support", bucket)}`).join(" ") +
      `; ${evidence} with evidence, ${unknown} carrying an unknown, ${model.entries.length - evidence} with no evidence.`,
  );
  console.log("integrations-grading: ok — every strong value is backed, unknowns stay unknown, and the page is current.");
}

main();

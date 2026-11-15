#!/usr/bin/env node
/**
 * `paystage-policy check <file>` — does this policy parse?
 *
 * The most common support question is not "what verdict" but "why does my policy file not load". The
 * answer today requires installing a package, writing a script and reading a stack trace. This answers
 * it in one command, offline, with the exact message the evaluator would have produced.
 *
 *   paystage-policy check policy.json      # exit 0 valid · 1 invalid · 2 unreadable
 *   paystage-policy check --json policy.json
 */
import { readFileSync } from "node:fs";
import { parsePolicy } from "@paystage/policy";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const positional = args.filter((a) => !a.startsWith("-"));
const verb = positional[0] === "check" ? "check" : null;
const file = verb ? positional[1] : positional[0];

if (!file) {
  console.error("usage: paystage-policy check <policy.json> [--json]");
  process.exit(2);
}

let raw: string;
try {
  raw = readFileSync(file, "utf8");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (asJson) console.log(JSON.stringify({ ok: false, stage: "read", error: message }, null, 2));
  else console.error(`cannot read ${file}: ${message}`);
  process.exit(2);
}

let parsed: unknown;
try {
  parsed = JSON.parse(raw);
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  if (asJson) console.log(JSON.stringify({ ok: false, stage: "json", error: message }, null, 2));
  else console.error(`${file} is not valid JSON: ${message}`);
  process.exit(1);
}

try {
  const policy = parsePolicy(parsed) as unknown as Record<string, unknown>;
  if (asJson) {
    console.log(JSON.stringify({ ok: true, file, policy }, null, 2));
  } else {
    const caps = [
      policy.max_amount ? `max_amount ${(policy.max_amount as { value: string }).value}` : "no max_amount",
      Array.isArray(policy.allowed_networks) && policy.allowed_networks.length
        ? `networks ${(policy.allowed_networks as string[]).join(", ")}`
        : "no allowed_networks",
      policy.unknown_payee ? `unknown_payee ${policy.unknown_payee}` : "unknown_payee unset",
    ];
    console.log(`${file}: valid`);
    console.log(`  ${caps.join(" · ")}`);
  }
  process.exit(0);
} catch (err) {
  // The Zod message is the point: it names the field and the problem, which is what a stack trace
  // buries. Print it verbatim rather than wrapping it.
  const message = err instanceof Error ? err.message : String(err);
  if (asJson) {
    console.log(JSON.stringify({ ok: false, stage: "policy", error: message }, null, 2));
    process.exit(1);
  }

  console.error(`${file}: invalid`);
  try {
    const issues = JSON.parse(message) as Array<{ path?: (string | number)[]; message?: string }>;
    if (Array.isArray(issues)) {
      // One line per field, because that is the question: which field, and what is wrong with it.
      for (const issue of issues) {
        const where = Array.isArray(issue.path) && issue.path.length ? issue.path.join(".") : "(root)";
        console.error(`  ${where}: ${issue.message ?? "invalid"}`);
      }
      process.exit(1);
    }
  } catch {
    // Not the structured form; fall through to the raw message.
  }
  console.error(message.split("\n").map((l) => `  ${l}`).join("\n"));
  process.exit(1);
}

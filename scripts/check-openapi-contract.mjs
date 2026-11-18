#!/usr/bin/env node
/**
 * The OpenAPI document has to be a contract an agent can follow, not a summary a human can skim.
 *
 * An autonomous caller reads this before its first request. What it needs, and what this checks:
 *  - a description that says **when to use and when not to** (a "Do NOT" clause, so it does not pick this tool over a
 *    sibling);
 *  - **strict formats** for the values it would otherwise guess (atomic units, unix seconds, 0x addresses);
 *  - every error response it can actually receive, in the Problem Details shape with `is_retriable`;
 *  - an `example` wherever a caller could hallucinate a value.
 *
 *   node scripts/check-openapi-contract.mjs
 *
 * Exit 0 the document is a contract · 1 it is a summary · 2 cannot read.
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = join(ROOT, "apps/hosted/src/routes/openapi.ts");

let text;
try {
  text = readFileSync(SOURCE, "utf8");
} catch (error) {
  console.error(`openapi-contract: cannot read ${SOURCE} (${error.message})`);
  process.exit(2);
}

const problems = [];
const MIN_DESCRIPTION = 200;

/** Each `paidOperation(...)` call: its summary, description and whether it declares the problem responses. */
/**
 * The description is a concatenation of string literals across lines, so one `"..."` capture reads 110 characters and
 * reports every operation as too short — a false alarm about the checker, not the document. Capture the whole
 * expression: as many quoted literals and `+` as it takes.
 */
const operations = [
  ...text.matchAll(/paidOperation\(\s*\n?\s*"([^"]+)",\s*\n?\s*((?:"(?:[^"\\]|\\.)*"\s*\+?\s*)+)/g),
].map(([, summary, expression]) => [
  summary,
  [...expression.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1].replace(/\\"/g, '"')).join(""),
]);
if (operations.length === 0) {
  console.error("openapi-contract: no operations found — the parse is wrong, or the document is empty");
  process.exit(2);
}

for (const [summary, description] of operations) {
  if (description.length < MIN_DESCRIPTION) {
    problems.push(`"${summary}": description is ${description.length} chars — too short to say when NOT to use it (min ${MIN_DESCRIPTION})`);
  }
  if (!/do not use|don't use|not for/i.test(description)) {
    problems.push(`"${summary}": no "do not use" clause — an agent cannot tell it apart from a sibling tool`);
  }
  if (!/atomic|string|unix|0x|format/i.test(description)) {
    problems.push(`"${summary}": no format guidance — the caller will guess units or encodings`);
  }
}

// The problem schema and the responses that carry it.
for (const [label, needle] of [
  ["a PROBLEM_SCHEMA", "const PROBLEM_SCHEMA"],
  ["a 400 response", '"400":'],
  ["a 429 response", '"429":'],
  ["a 503 response", '"503":'],
  ["application/problem+json", "application/problem+json"],
  ["is_retriable", "is_retriable"],
  ["retry_after_seconds", "retry_after_seconds"],
]) {
  if (!text.includes(needle)) problems.push(`the document declares no ${label.replace(/^a /, "")}`);
}

// An example on the schema an agent fills in: this is what stops it inventing a plausible-looking value.
if (!/examples?:/.test(text)) problems.push("no examples anywhere — a caller with no example invents one");

if (problems.length === 0) {
  console.log(`openapi-contract: ${operations.length} operation(s), each a contract (use/don't use, formats, problem responses)`);
  process.exit(0);
}
console.error("openapi-contract: this document reads like a summary, not a contract:");
for (const p of problems) console.error(`  ${p}`);
process.exit(1);

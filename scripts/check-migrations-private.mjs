#!/usr/bin/env node
/**
 * No schema migration may be tracked in this repository (operator decision, 2026-11-28).
 *
 * The operator's words: *"i dont like having migrations in public. its a potential mistake in future waiting to happen."* A public schema
 * invites a fork to apply half of it, and it publishes the shape of tables that hold tenant and payer data. The directory is gitignored and
 * untracked; this check is what stops the decision being quietly undone by a `git add -f` or a careless merge.
 *
 *   node scripts/check-migrations-private.mjs
 *
 * Exit 0 nothing tracked under supabase/ · 10 something is · 2 git could not be asked.
 */
import { execFileSync } from "node:child_process";

let tracked;
try {
  tracked = execFileSync("git", ["ls-files", "supabase"], { encoding: "utf8" })
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
} catch (error) {
  console.error(`migrations-private: could not list tracked files (${error?.code ?? "git failed"})`);
  process.exit(2);
}

const offenders = tracked.filter((path) => path.startsWith("supabase/"));
if (offenders.length === 0) {
  console.log("migrations-private: no tracked file under supabase/ — the schema is not published");
  process.exit(0);
}

console.log(`migrations-private: ${offenders.length} tracked file(s) under supabase/, which the operator decided must not be published:`);
for (const path of offenders.slice(0, 10)) console.log(`  ${path}`);
if (offenders.length > 10) console.log(`  … and ${offenders.length - 10} more`);
console.log("  untrack them with `git rm -r --cached supabase/migrations` and leave the files on disk; do not rewrite history");
process.exit(10);

#!/usr/bin/env node
/**
 * Run the conformance kit the way the nightly `cadence` workflow runs it, but from the repo root.
 *
 * This is a thin wrapper on purpose. The nightly job invokes `apps/hosted/scripts/conformance.mjs` directly, so the
 * only thing worth checking locally is that the script *loads and runs* — its imports resolve, its fixtures parse, its
 * exit code is sane. On 2026-11-26 a wrong relative import there passed every local gate and failed the nightly run,
 * because nothing local ever executed the file.
 *
 * Exit 0 pass · 1 the kit failed its checks · 2 the kit could not run at all (the case that broke).
 */
import { execFileSync } from "node:child_process";

const script = "apps/hosted/scripts/conformance.mjs";

try {
  const out = execFileSync(process.execPath, [script], { encoding: "utf8", stdio: "pipe" });
  const last = out.trim().split("\n").filter(Boolean).at(-1) ?? "";
  console.log(`conformance-fixtures: ${last}`);
  process.exit(0);
} catch (error) {
  if (error.code === "ERR_MODULE_NOT_FOUND" || /Cannot find module/.test(String(error.stderr))) {
    console.error("conformance-fixtures: the kit cannot load — a broken import, not a failed check");
    console.error(String(error.stderr).split("\n").slice(0, 6).join("\n"));
    process.exit(2);
  }
  console.error(`conformance-fixtures: the kit failed its checks (exit ${error.status})`);
  console.error(String(error.stdout ?? "").split("\n").slice(-6).join("\n"));
  process.exit(1);
}

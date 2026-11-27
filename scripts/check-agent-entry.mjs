#!/usr/bin/env node
/**
 * Every domain we own must have an agent entry point (#468).
 *
 * A site whose thesis is "an agent can set this up for you" and which serves only HTML is a contradiction. vouchguard.app
 * answered 404 at `/llms.txt` and at every well-known path while paystage.xyz had both — nobody noticed, because there was
 * nothing to notice with.
 *
 * This checks the **source routes**, not the live wire: a fetch here would fail in CI when the network is slow, and a check
 * that flakes gets removed. The live check belongs to the pipeline monitor.
 */
import { existsSync, readFileSync } from "node:fs";

const DOMAINS = [
  {
    name: "paystage.xyz",
    llms: "apps/console/src/app/llms.txt/route.ts",
    // paystage.xyz serves its descriptor from `/agent-manifest.json` through a middleware rewrite, which is the
    // conventional path too. The check follows the rewrite rather than demanding a second file.
    descriptor: "apps/console/src/app/agent-manifest.json/route.ts",
  },
  {
    name: "vouchguard.app",
    llms: "apps/vouchguard/src/app/llms.txt/route.ts",
    descriptor: "apps/vouchguard/src/app/.well-known/vouchguard.json/route.ts",
  },
];

const problems = [];
for (const domain of DOMAINS) {
  if (!existsSync(domain.llms)) {
    problems.push(`${domain.name}: no /llms.txt route (${domain.llms}) — an agent landing here has only HTML`);
    continue;
  }
  const text = readFileSync(domain.llms, "utf8");
  if (!/# [A-Za-z]/.test(text)) problems.push(`${domain.name}: llms.txt has no H1 naming the project`);
  if (!/^> /m.test(text)) problems.push(`${domain.name}: llms.txt has no blockquote summary`);
  if (!/github\.com\/base-buzz\/paystage/.test(text)) {
    problems.push(`${domain.name}: llms.txt does not link the repository`);
  }
  // The cross-reference is the machine-readable version of "these two brands belong together".
  const other = domain.name === "paystage.xyz" ? "vouchguard" : "paystage.xyz";
  if (!new RegExp(other, "i").test(text)) {
    problems.push(`${domain.name}: llms.txt never mentions ${other} — the two brands are strangers on the wire`);
  }

  if (!existsSync(domain.descriptor)) {
    problems.push(`${domain.name}: no well-known descriptor (${domain.descriptor})`);
    continue;
  }
  // The route may be a thin wrapper over a manifest module; follow one import so the check reads the real fields.
  let descriptor = readFileSync(domain.descriptor, "utf8");
  const imported = descriptor.match(/from "@\/(lib\/[\w./-]+)"/)?.[1];
  if (imported) {
    const target = `apps/console/src/${imported}.ts`;
    if (existsSync(target)) descriptor += readFileSync(target, "utf8");
  }
  if (!/related/.test(descriptor)) {
    problems.push(`${domain.name}: descriptor has no \`related\` field naming the other brand`);
  }
  if (!/license/.test(descriptor)) problems.push(`${domain.name}: descriptor does not state its licence`);
}

if (problems.length > 0) {
  console.error(`agent-entry: ${problems.length} problem(s)`);
  for (const problem of problems) console.error("  " + problem);
  process.exit(1);
}
console.log(`agent-entry: ${DOMAINS.length} domain(s) with an llms.txt, a well-known descriptor and a cross-reference`);

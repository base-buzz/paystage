#!/usr/bin/env node
/**
 * Every published version must have a tarball you can actually download.
 *
 * `velocity@0.2.2` had a complete version document on npm and **404ed on its tarball**, so
 * `npm install @paystage/mcp@0.8.8` failed for every user while `npm view` reported the version happily.
 * The release workflow's own assert caught it — but only for the packages that release published, and only
 * when that release happened. Nothing watched the published set afterwards, which is why the state could
 * sit there being wrong.
 *
 * A version document is not an artifact. Same distinction as a 200 page vs a live socket, or a merged PR
 * vs a published package: metadata is a claim, the tarball is the thing.
 *
 *   node scripts/check-tarballs.mjs            # all publishable packages, at `latest`
 *   node scripts/check-tarballs.mjs --json
 *
 * Exit 0 every tarball served · 1 at least one is not · 2 the registry could not be read (not a pass)
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
// Overridable so the failure path can be driven against a local fixture rather than by breaking npm.
const REGISTRY = process.env.NPM_REGISTRY ?? "https://registry.npmjs.org";
const TIMEOUT_MS = 20_000;

function publishablePackages() {
  const out = [];
  for (const dir of readdirSync(join(ROOT, "packages"), { withFileTypes: true })) {
    if (!dir.isDirectory()) continue;
    const manifest = join(ROOT, "packages", dir.name, "package.json");
    if (!existsSync(manifest)) continue;
    const pkg = JSON.parse(readFileSync(manifest, "utf8"));
    if (pkg.private || !pkg.name?.startsWith("@paystage/")) continue;
    out.push({ name: pkg.name, repoVersion: pkg.version });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

async function head(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "HEAD", signal: controller.signal, redirect: "follow" });
    return res.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(timer);
  }
}

const packages = publishablePackages();
if (packages.length === 0) {
  console.error("check-tarballs: found no publishable packages under packages/");
  process.exit(2);
}

const rows = [];
const problems = [];
let unreadable = 0;
const pending = [];

for (const pkg of packages) {
  const encoded = pkg.name.replace("/", "%2F");
  let doc;
  try {
    const res = await fetch(`${REGISTRY}/${encoded}`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new Error(`registry ${res.status}`);
    doc = await res.json();
  } catch (error) {
    /**
     * A 404 for a package that exists in this repo means it has never been published — `@paystage/n8n` and `@paystage/eliza-plugin` are exactly that, waiting on a
     * Trusted Publisher entry. That is a pending first release, not a broken tarball, and treating it as a failure made the whole check unusable the moment those two
     * packages landed. Any other error is still a problem.
     */
    if (/registry 404/.test(String(error.message))) {
      pending.push(pkg.name);
      continue;
    }
    unreadable += 1;
    problems.push(`${pkg.name}: registry unreadable (${error.message}) — not a pass`);
    continue;
  }

  const latest = doc?.["dist-tags"]?.latest ?? null;
  if (!latest) {
    problems.push(`${pkg.name}: no \`latest\` dist-tag — nothing to install`);
    continue;
  }
  const tarball = doc?.versions?.[latest]?.dist?.tarball ?? null;
  if (!tarball) {
    problems.push(`${pkg.name}@${latest}: version document has no dist.tarball`);
    rows.push({ name: pkg.name, version: latest, status: "no tarball url" });
    continue;
  }

  const status = await head(tarball);
  rows.push({ name: pkg.name, version: latest, status });
  if (status !== 200) {
    problems.push(`${pkg.name}@${latest}: tarball ${status === 0 ? "unreachable" : `HTTP ${status}`} — the version is a claim, not an artifact`);
  }
}

const payload = { ok: problems.length === 0, checked: rows.length, problems, rows };
if (process.argv.includes("--json")) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  const width = Math.max(...rows.map((r) => r.name.length), 8);
  for (const row of rows) console.log(`  ${row.name.padEnd(width)} ${String(row.version).padEnd(8)} tarball ${row.status}`);
  console.log(
    problems.length === 0
      ? `\ncheck-tarballs: ${rows.length} publishable package(s), every latest tarball answers 200${pending.length ? ` · ${pending.length} pending first publish (${pending.join(", ")})` : ""}`
      : `\ncheck-tarballs: ${problems.length} problem(s)\n${problems.map((p) => `  ${p}`).join("\n")}`,
  );
}
process.exit(problems.length === 0 ? 0 : unreadable === problems.length ? 2 : 1);

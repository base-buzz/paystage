#!/usr/bin/env node
/**
 * Every tag gets a changelog line, or CI fails.
 *
 * `CHANGELOG.md` is written by hand and lags: on 2026-11-18 it had entries for 2026-11-17 but nothing for the
 * `mcp-0.8.10` or `x402-guard-0.4.7` releases that shipped that day, and several tags (`v0.4.6`, `v0.8.8`,
 * `v0.8.9`) never appear at all. A changelog nobody can trust is worse than none, because it looks complete.
 *
 *   node scripts/check-changelog.mjs            # exit 0 every tag covered, 1 a tag is missing, 2 cannot read
 *   node scripts/check-changelog.mjs --json
 *
 * A tag is "covered" when the changelog mentions its version string and its date, or when a `## <date>` block
 * for the tag's date mentions that version. Both spellings in the file today (`0.8.10`, `x402-guard@0.4.7`)
 * are accepted — the check is about coverage, not formatting.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

let changelog;
try {
  changelog = readFileSync(join(ROOT, "CHANGELOG.md"), "utf8");
} catch (error) {
  console.error(`changelog: cannot read CHANGELOG.md (${error.code ?? error.message})`);
  process.exit(2);
}

/** Tags and their commit dates, from git — the tags are the record of what shipped. */
function tags() {
  // `git fetch --tags` first: CI checks out a single commit by default (`fetch-depth: 1`), which brings no tags,
  // so the first run failed with "no versioned tags found". A shallow clone is not an empty changelog.
  try {
    execFileSync("git", ["fetch", "--tags", "--quiet", "--depth=1", "origin"], { cwd: ROOT, stdio: "ignore" });
  } catch {
    /* offline or no remote: fall back to whatever tags exist locally below */
  }
  let raw;
  try {
    raw = execFileSync("git", ["for-each-ref", "--format=%(refname:short) %(creatordate:short)", "refs/tags"], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (error) {
    console.error(`changelog: cannot list tags (${error.message})`);
    process.exit(2);
  }
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [tag, date] = line.trim().split(" ");
      return { tag, date };
    });
}

/**
 * The version a tag ships. Handles `v2026.11.17-mcp-0.8.10` and the older `v0.8.9`; a date-tagged release with no
 * version component (e.g. `v2026.11.17-registry-fix`) is not a package release and is exempt.
 */
/** Package name -> version from the workspace manifests, for tags that carry no package component. */
function workspaceVersions() {
  const out = {};
  for (const tree of ["packages", "apps"]) {
    const base = join(ROOT, tree);
    let dirs = [];
    try {
      dirs = readdirSync(base, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dir of dirs) {
      if (!dir.isDirectory()) continue;
      try {
        const pkg = JSON.parse(readFileSync(join(base, dir.name, "package.json"), "utf8"));
        if (pkg.name) out[pkg.name] = pkg.version;
      } catch {
        /* an app without a manifest is not a package */
      }
    }
  }
  return out;
}

/** The package a versioned tag belongs to, or "" when the tag carries no package component. */
function packageOf(tag) {
  const m = /^v\d{4}\.\d{2}\.\d{2}-([a-z0-9-]+)-(\d+\.\d+\.\d+)$/.exec(tag);
  return m ? m[1] : "";
}

/**
 * Which release day this tag belongs to.
 *
 * Tags are named for one date and often created on another: `v2026.11.17-preflight-0.5.0` was tagged on the 16th.
 * Using the git date made every such tag look uncovered even when the changelog had it under the right day.
 */
function releaseDate(tag) {
  const m = /^v(\d{4})\.(\d{2})\.(\d{2})/.exec(tag);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/**
 * The version a tag ships. Handles `v2026.11.17-mcp-0.8.10` and the older `v0.8.9`.
 * A bare date tag (`v2026.11.02`) is a release marker, not something a reader can install — exempt.
 */
function versionOf(tag) {
  const generic = /^v\d{4}\.\d{2}\.\d{2}-[a-z0-9-]+-(\d+\.\d+\.\d+)$/.exec(tag);
  if (generic) return generic[1];
  const plain = /^v(\d+)\.(\d+)\.(\d+)$/.exec(tag);
  if (plain && Number(plain[1]) < 100) return `${plain[1]}.${plain[2]}.${plain[3]}`;
  return null;
}

/** Split the changelog into `## <date>` blocks so a mention is matched inside the right day, not the whole file. */
function blocksByDate(text) {
  const out = [];
  for (const chunk of text.split(/^## /m).slice(1)) {
    const date = chunk.slice(0, chunk.indexOf("\n")).trim();
    out.push({ date, body: chunk });
  }
  return out;
}

const entries = tags()
  .map((t) => ({ ...t, version: versionOf(t.tag) }))
  .filter((t) => t.version !== null);

if (entries.length === 0) {
  console.error("changelog: no versioned tags found — nothing to check");
  process.exit(2);
}

const blocks = blocksByDate(changelog);
const missing = [];
for (const { tag, date, version } of entries) {
  const stamp = releaseDate(tag) ?? date;
  const pkg = packageOf(tag);
  // Same version across packages (`…-{mcp,preflight,x402-guard}-0.4.0`) means one mention cannot cover three
  // tags: the line has to name the package too. Matched inside the tag's own day block, so an entry under the
  // wrong date is still a missing entry.
  // Two acceptable homes: a `## <date>` section that names the version (and the package, when the tag carries one),
  // or the generated day index line, which names both by construction.
  const inSection = blocks.some(
    (b) =>
      b.date === stamp &&
      b.body
        .split("\n")
        .some((line) => new RegExp(`\\b${version.replace(/\./g, "\\.")}\\b`).test(line) && (pkg === "" || line.includes(pkg))),
  );
  const inIndex = new RegExp(
    `^- \\*\\*${stamp}\\*\\* |.*${version.replace(/\./g, "\\.")}`,
    "m",
  ).test(changelog) && changelog.split("\n").some((l) => l.startsWith(`- **${stamp}**`) && l.includes(version) && (pkg === "" || l.includes(pkg)));
  const covered = inSection || inIndex;
  if (!covered) missing.push({ tag, date: stamp, version, package: pkg || null });
}

if (process.argv.includes("--write")) {
  // The index line per release day: a table a reader can trust because a script wrote it. Hand-written prose about
  // *why* a release happened stays above it; this only guarantees every tag is named, under its release day.
  const byDay = new Map();
  for (const { tag, date, version } of entries) {
    const stamp = releaseDate(tag) ?? date;
    const pkg = packageOf(tag);
    // Bare-version tags (`v0.8.9`) carry no package, so resolve it: one package at that version means it is that
    // package's release; several means we cannot say, and the index says so rather than inventing a name.
    let label;
    if (pkg) label = `\`@paystage/${pkg}@${version}\``;
    else {
      const owners = Object.entries(workspaceVersions()).filter(([, v]) => v === version).map(([n]) => n);
      label = owners.length === 1 ? `\`${owners[0]}@${version}\`` : `\`${version}\` (package not stated in the tag)`;
    }
    if (!byDay.has(stamp)) byDay.set(stamp, []);
    byDay.get(stamp).push(label);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  const table = [
    "<!-- generated by scripts/check-changelog.mjs --write — every tag, by release day -->",
    "## Every release, by day",
    "",
    ...days.map(([d, pkgs]) => `- **${d}** — ${[...new Set(pkgs)].join(", ")}`),
    "",
  ].join("\n");

  const start = changelog.indexOf("<!-- generated by scripts/check-changelog.mjs");
  const end = changelog.indexOf("<!-- end generated -->");
  let next;
  if (start >= 0 && end > start) {
    next = changelog.slice(0, start) + table + "<!-- end generated -->\n" + changelog.slice(end + "<!-- end generated -->\n".length);
  } else {
    const at = changelog.indexOf("\n## ");
    next = changelog.slice(0, at + 1) + table + "<!-- end generated -->\n" + changelog.slice(at + 1);
  }
  writeFileSync(join(ROOT, "CHANGELOG.md"), next);
  console.log(`changelog: wrote ${entries.length} release(s) across ${days.length} day(s)`);
  process.exit(0);
}

if (process.argv.includes("--json")) {
  console.log(JSON.stringify({ ok: missing.length === 0, checked: entries.length, missing }, null, 2));
} else if (missing.length === 0) {
  console.log(`changelog: ${entries.length} versioned tag(s), all mentioned`);
} else {
  console.log(`changelog: ${missing.length} of ${entries.length} versioned tag(s) have no entry:`);
  for (const m of missing) console.log(`  ${m.date}  ${m.tag}  (${m.version}${m.package ? ` @${m.package}` : ""})`);
}
process.exit(missing.length === 0 ? 0 : 1);

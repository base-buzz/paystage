#!/usr/bin/env node
/**
 * Assert that the artifact on npm is the artifact in the repo.
 *
 * Written after mcp.so showed five tools and was right: `@paystage/mcp@0.3.5` on npm registered five
 * while the repo registered nine, because the published tarball was built from an older commit and had
 * no `dist/tools.js` at all. Every check we had — tests, typecheck, the conformance kit — ran against
 * the working tree or the hosted endpoint. Nothing opened the tarball.
 *
 *   node scripts/assert-artifact.mjs @paystage/mcp 0.4.0
 *   node scripts/assert-artifact.mjs @paystage/mcp --latest
 *
 * Exit 0 pass · 1 mismatch · 2 unable to check (which is not a pass)
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = process.argv[2];
const versionArg = process.argv[3] ?? "--latest";

if (!pkg) {
  console.error("usage: assert-artifact.mjs <package> <version|--latest>");
  process.exit(2);
}

const problems = [];
const passed = [];

const local = JSON.parse(readFileSync(join(ROOT, "packages", pkg.replace("@paystage/", ""), "package.json"), "utf8"));

// npm's registry lagged about four minutes behind a successful publish once, which is exactly long
// enough to declare a good release broken. `--wait` retries the version lookup instead of inventing a
// failure; anything longer than that is a real problem, not propagation.
const waitArg = process.argv.indexOf("--wait");
const waitSeconds = waitArg > 0 ? Number(process.argv[waitArg + 1] ?? 0) : 0;

function npmVersion() {
  return execFileSync("npm", ["view", pkg, "version"], { encoding: "utf8" }).trim();
}

function resolveVersion() {
  if (versionArg !== "--latest") return versionArg;
  const deadline = Date.now() + waitSeconds * 1000;
  let seen = npmVersion();
  while (seen !== local.version && Date.now() < deadline) {
    execFileSync("sleep", ["20"]);
    seen = npmVersion();
  }
  return seen;
}

const version = resolveVersion();

if (version !== local.version) {
  problems.push(`npm latest is ${version}; the repo is ${local.version} — the next release has not shipped, or shipped and was not tagged`);
} else {
  passed.push(`version ${version} matches the repo`);
}

const dir = mkdtempSync(join(tmpdir(), "artifact-"));
try {
  /**
   * Retry the pack: the release publishes and then immediately asks npm for the artifact, and the registry is not one
   * machine. The first run after publishing preflight@0.5.1 failed here with a bare `npm pack` exit 1 while the version
   * was already visible a minute later — a race, not a defect. Three attempts, ten seconds apart, is enough for
   * propagation and short enough that a genuinely missing tarball still fails the release.
   */
  let packed = false;
  for (let attempt = 1; attempt <= 3 && !packed; attempt += 1) {
    try {
      execFileSync("npm", ["pack", `${pkg}@${version}`, "--silent"], { cwd: dir, encoding: "utf8", timeout: 120_000 });
      packed = true;
    } catch (error) {
      if (attempt === 3) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 10_000));
    }
  }
  const tarball = readdirSync(dir).find((f) => f.endsWith(".tgz"));
  if (!tarball) {
    console.error("assert-artifact: npm pack produced no tarball");
    process.exit(2);
  }
  execFileSync("tar", ["xzf", tarball], { cwd: dir });

  const pkgDir = join(dir, "package");
  const shipped = JSON.parse(readFileSync(join(pkgDir, "package.json"), "utf8"));

  // 1. The tarball must carry what the repo declares as exports — a subpath the hosted Worker imports
  //    was silently missing from 0.3.5.
  for (const key of Object.keys(local.exports ?? {})) {
    if (!shipped.exports?.[key]) problems.push(`published package is missing exports["${key}"]`);
  }
  if (Object.keys(local.exports ?? {}).length > 0 && problems.length === 0) {
    passed.push(`exports match (${Object.keys(local.exports).join(", ")})`);
  }

  // 2. For the MCP package, the registered tool count is the claim every listing repeats.
  if (pkg === "@paystage/mcp") {
    const src = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
    const block = src.slice(src.indexOf("export const TOOL_NAMES"), src.indexOf("] as const", src.indexOf("export const TOOL_NAMES")));
    const expected = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);

    let registered = [];
    try {
      const built = readFileSync(join(pkgDir, "dist/tools.js"), "utf8");
      registered = [...built.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
    } catch {
      problems.push("published package has no dist/tools.js — it predates the shared registration");
    }

    const missing = expected.filter((t) => !registered.includes(t));
    if (missing.length > 0) {
      problems.push(`published package registers ${registered.length} tools; source declares ${expected.length} (missing ${missing.join(", ")})`);
    } else if (registered.length > 0) {
      passed.push(`published package registers all ${registered.length} tools`);
    }
  }
  // 3. A reused version must carry the same CODE (#162).
  //
  // `@paystage/preflight@0.4.3` was published for a metadata change; the address fix then took the same version, npm
  // refused to republish, and the release reported success. This guard compared version numbers — 0.4.3 on both sides —
  // so the check that exists to catch "published ≠ repo" said everything was fine.
  //
  // The comparison is the `dist/` tree, hashed per file: that is what a consumer actually runs. package.json differs by
  // design (repository metadata, publish time) and is excluded; a missing or extra dist file is a difference worth
  // failing on, because it means the tarball was built from a different commit.
  if (version === local.version) {
    const localDir = mkdtempSync(join(tmpdir(), "artifact-local-"));
    try {
      execFileSync("npm", ["pack", "--silent"], { cwd: join(ROOT, "packages", local.name.replace(/^@[^/]+\//, "")), encoding: "utf8", timeout: 120_000, stdio: "pipe" });
      const packageDir = join(ROOT, "packages", local.name.replace(/^@[^/]+\//, ""));
      const localTarball = readdirSync(packageDir).find((f) => f.endsWith(".tgz"));
      if (localTarball !== undefined) {
        execFileSync("tar", ["xzf", join(packageDir, localTarball)], { cwd: localDir });
        rmSync(join(packageDir, localTarball), { force: true });
      }

      const hashDir = (root) => {
        const out = new Map();
        const walk = (rel) => {
          const abs = join(root, rel);
          let entries = [];
          try {
            entries = readdirSync(abs, { withFileTypes: true });
          } catch {
            return;
          }
          for (const entry of entries) {
            const next = rel === "" ? entry.name : `${rel}/${entry.name}`;
            if (entry.isDirectory()) walk(next);
            else out.set(next, createHash("sha256").update(readFileSync(join(root, next))).digest("hex"));
          }
        };
        walk("dist");
        return out;
      };

      const shippedDist = hashDir(pkgDir);
      const localDist = hashDir(join(localDir, "package"));

      if (localDist.size === 0) {
        problems.push("a local `npm pack` produced no dist/ — cannot compare content, and a check that cannot run must not pass");
      } else if (shippedDist.size === 0) {
        problems.push("the published tarball has no dist/ — nothing a consumer can run");
      } else {
        const differing = [...new Set([...shippedDist.keys(), ...localDist.keys()])].filter(
          (file) => shippedDist.get(file) !== localDist.get(file),
        );
        if (differing.length > 0) {
          problems.push(
            `version ${version} is already published but its dist/ differs from this commit (${differing.slice(0, 3).join(", ")}${differing.length > 3 ? `, +${differing.length - 3} more` : ""}) — bump the version; npm will refuse a republish and the release will look successful`,
          );
        } else {
          passed.push(`published dist/ matches this commit (${shippedDist.size} file(s))`);
        }
      }
    } finally {
      rmSync(localDir, { recursive: true, force: true });
    }
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

for (const p of passed) console.log(`  ok    ${p}`);
for (const p of problems) console.log(`  FAIL  ${p}`);
console.log(problems.length === 0 ? `\nartifact: ${pkg}@${version} is what the repo says` : `\nartifact: ${problems.length} mismatch(es) in ${pkg}@${version}`);
process.exit(problems.length === 0 ? 0 : 1);

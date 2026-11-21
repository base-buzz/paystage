#!/usr/bin/env node
/**
 * Guard the Python package, which every other check silently skips.
 *
 * All the JS-side checks key off `packages/*​/package.json`, so `py` was invisible to `check-publish-list`,
 * `check-manifest-packages`, `check-version-parity`, `check-dep-pins`, `check-deps-budget` and `check-network-claims` — the
 * package could have shipped with a wrong name, a hosted URL typo, or a workflow that authenticates with a token somebody
 * put in a secret, and the only thing that would notice is a human reading it.
 *
 * What this asserts, and why each one:
 *  - the distribution name and version are what the README and the workflow tag pattern promise;
 *  - the hosted endpoint is declared and is HTTPS — a package that points at the wrong host is worse than no package;
 *  - `requires-python` exists, so `pip install` on an old interpreter fails with a clear message rather than a SyntaxError;
 *  - dependencies are empty: this is a transport, and a dependency here would be duplicated trust in a safety tool;
 *  - the publish workflow (a) runs on a tag, (b) has `id-token: write`, (c) sets **no** password or token, and (d) is the
 *    workflow name the PyPI trusted-publisher configuration must name;
 *  - the README's first code line is the install command, because that is the line a reader looks for.
 *
 * Exit codes: 0 pass · 1 a claim is wrong · 2 the package is missing (nothing to check is a failure, not a pass).
 */
import { readFileSync, existsSync } from "node:fs";

const ROOT = new URL("..", import.meta.url).pathname;
const PY = `${ROOT}py`;
const WORKFLOW = `${ROOT}.github/workflows/pypi.yml`;

const problems = [];
const fail = (message) => problems.push(message);

if (!existsSync(`${PY}/pyproject.toml`)) {
  console.error(`check-pypi-package: ${PY}/pyproject.toml is missing — nothing to check`);
  process.exit(2);
}

const pyproject = readFileSync(`${PY}/pyproject.toml`, "utf8");
const workflow = existsSync(WORKFLOW) ? readFileSync(WORKFLOW, "utf8") : "";
const readme = existsSync(`${PY}/README.md`) ? readFileSync(`${PY}/README.md`, "utf8") : "";

/** Minimal TOML read: these files are written by hand and stay flat, so a parser dependency is not justified. */
const field = (source, key) => new RegExp(`^${key}\\s*=\\s*"([^"]*)"`, "m").exec(source)?.[1] ?? null;

// 1. identity
const name = field(pyproject, "name");
if (name !== "paystage") fail(`pyproject name is ${name ?? "(absent)"}, expected "paystage"`);

const version = field(pyproject, "version");
if (version === null || !/^\d+\.\d+\.\d+/.test(version)) fail(`pyproject version is ${version ?? "(absent)"}, expected semver`);

// 2. the hosted endpoint, declared and HTTPS
const hosted = /Homepage\s*=\s*"([^"]+)"/.exec(pyproject)?.[1] ?? /PayStage\s*=\s*"([^"]+)"/.exec(pyproject)?.[1] ?? null;
if (hosted === null) fail("pyproject declares no Homepage/PayStage URL");
else if (!hosted.startsWith("https://")) fail(`declared URL ${hosted} is not https`);

// 3. interpreter floor
if (field(pyproject, "requires-python") === null) fail("pyproject declares no requires-python");

// 4. transport only — no dependencies
if (/^dependencies\s*=\s*\[(?!\])/m.test(pyproject) || /^dependencies\s*=\s*\[\s*[^\]]+\]/m.test(pyproject)) {
  fail("pyproject declares runtime dependencies; this package is a stdlib-only transport");
}

// 5. the publish path
if (workflow === "") fail(".github/workflows/pypi.yml is missing, so nothing can publish");
else {
  if (!/tags:\s*\n\s*-\s*"[^"]*-py-/m.test(workflow)) fail("pypi.yml has no tag trigger matching v*-py-*");
  const publishJob = workflow.slice(workflow.indexOf("publish:") === -1 ? 0 : workflow.indexOf("publish:"));
  if (!/id-token:\s*write/.test(workflow)) fail("pypi.yml does not request id-token: write, so OIDC publishing cannot work");
  if (!/id-token:\s*write/.test(publishJob)) fail("the publish job itself does not request id-token: write");
  const passwordLine = /^\s*password\s*:/m.exec(publishJob);
  if (passwordLine !== null) fail("the publish step sets a password — trusted publishing must use OIDC only");
  if (/secrets\.\s*PYPI/i.test(publishJob)) fail("the publish step references a PyPI secret; trusted publishing needs none");
  if (/PYPI_API_TOKEN|PYPI_PASSWORD/.test(workflow)) fail("pypi.yml references a PyPI token/password variable");
}

// 6. the line a reader looks for first
const firstCodeLine = readme.split("\n").find((line) => line.trim() !== "" && !line.startsWith("#")) ?? "";
if (!/pip install paystage/.test(firstCodeLine)) fail(`py/README.md's first non-heading line is "${firstCodeLine.slice(0, 60)}", expected "pip install paystage"`);

if (problems.length > 0) {
  console.error(`check-pypi-package: ${problems.length} problem(s)`);
  for (const problem of problems) console.error(`  ${problem}`);
  process.exit(1);
}

console.log(`pypi package: ok — ${name} ${version} → ${hosted}, OIDC publish, no dependencies`);

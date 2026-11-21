#!/usr/bin/env node
/**
 * One registry namespace, one answer to "is the listing current".
 *
 * The registry used to be split: `xyz.paystage/*` was written only by the manual
 * `registry-dns.yml` (which needed `MCP_REGISTRY_KEY`), while `release.yml` published
 * `io.github.base-buzz/*` with GitHub OIDC. Two namespaces meant two answers, and the
 * green one was the one nobody looked at. The DNS namespace is retired, the OIDC
 * namespace is canonical, and this is the guard that keeps both facts true.
 *
 *   node scripts/check-registry-namespace.mjs
 *   node scripts/check-registry-namespace.mjs --accept-retired   # CI: known-frozen DNS drift is printed, not failed
 *   node scripts/check-registry-namespace.mjs --offline          # structural checks only
 *
 * Rules
 *  1. Documentation must not cite `xyz.paystage/` as current. A file with an explicit
 *     archival/retired header, or a line that itself says retired/frozen/historical, is
 *     allowed to discuss the old name. CHANGELOG.md, RELEASE-*.md and docs/state/*.json
 *     are records and are excluded from the live-document rule.
 *  2. The canonical name must be present where a reader or crawler meets it: README,
 *     the integrations record and its generated page, both server cards, the agent
 *     manifest, llms.txt, the lander and the progress strip. Every published
 *     `server.json` name and `package.json` `mcpName` must be `io.github.base-buzz/*`.
 *  3. `registry-dns.yml` must be inert: manual trigger only, no secrets, no publish.
 *  4. When the network answers, both namespaces are read and every version is printed.
 *     Drift between the canonical entry and its retired counterpart FAILS by default,
 *     so a difference is visible rather than asserted. `--accept-retired` turns the
 *     known-frozen retired entries into a printed FROZEN line instead of a failure;
 *     an unexpected change to a frozen entry still fails. Network failure is a printed
 *     SKIP, never evidence that the namespaces agree.
 *
 * Exit 0 rules pass (or network skipped and structural rules passed) · 1 a rule failed.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const ACCEPT_RETIRED = args.has("--accept-retired");
const OFFLINE = args.has("--offline");

const CANONICAL = "io.github.base-buzz";
const RETIRED = "xyz.paystage";
const problems = [];
const notes = [];

/**
 * The retired namespace is published state, not ours to delete or update from this repo.
 * These are the versions observed when it was retired (2026-11-21). If one moves, the
 * retirement is leaking and the check says so instead of shrugging at "drift".
 */
const FROZEN = {
  "xyz.paystage/mcp": "0.3.2",
  "xyz.paystage/preflight": "0.2.2",
  "xyz.paystage/auth-watch": "0.2.0",
  "xyz.paystage/trade-preflight": "0.2.0",
};

/** Canonical server -> the retired entry it replaced. */
const PAIRS = [
  ["io.github.base-buzz/x402-payment-safety", "xyz.paystage/mcp"],
  ["io.github.base-buzz/preflight", "xyz.paystage/preflight"],
  ["io.github.base-buzz/auth-watch", "xyz.paystage/auth-watch"],
  ["io.github.base-buzz/trade-preflight", "xyz.paystage/trade-preflight"],
];

function trackedFiles() {
  return execFileSync("git", ["ls-files", "-z"], { cwd: ROOT, encoding: "utf8" })
    .split("\0")
    .filter(Boolean);
}

function read(rel) {
  return readFileSync(join(ROOT, rel), "utf8");
}

function isHistoricalRecord(file) {
  return (
    file === "CHANGELOG.md" ||
    /^RELEASE-.*\.md$/.test(file) ||
    file.startsWith("docs/state/") ||
    /\.generated\.json$/.test(file) ||
    /^apps\/console\/\.(open-)?next\//.test(file)
  );
}

/** An explicit header is enough to discuss the retired name in a document. */
function hasArchivalHeader(text) {
  return /(retired|historical|frozen|archived)/i.test(text.slice(0, 1600));
}

const RETIREMENT_WORDS = /(retired|retirement|frozen|historical|archiv|no longer|superseded|old namespace|stale)/i;

const files = trackedFiles();

// Rule 1: no current citation of the retired namespace in documentation.
let historicalMentions = 0;
for (const file of files) {
  if (isHistoricalRecord(file)) continue;
  const documentation = file.endsWith(".md") || file.startsWith("docs/") || file.startsWith("launch/");
  if (!documentation) continue;
  const text = read(file);
  const archival = hasArchivalHeader(text);
  text.split("\n").forEach((line, index) => {
    if (!line.includes(`${RETIRED}/`)) return;
    if (archival || RETIREMENT_WORDS.test(line)) {
      historicalMentions += 1;
      return;
    }
    problems.push(`${file}:${index + 1} cites ${RETIRED}/ as if it were current: ${line.trim().slice(0, 120)}`);
  });
}

// Rule 2: the canonical name is present where a reader or crawler meets it.
const REQUIRED = [
  ["README.md", "search=io.github.base-buzz"],
  ["docs/state/integrations.json", "search=io.github.base-buzz"],
  ["docs/integrations/README.md", "search=io.github.base-buzz"],
  ["apps/hosted/src/routes/well-known-mcp.ts", `name: "${CANONICAL}/`],
  ["apps/console/public/.well-known/mcp.json", `"name":"${CANONICAL}/`],
  ["apps/console/src/lib/agent-manifest.ts", `mcp_registry: "${CANONICAL}/`],
  ["apps/console/src/app/llms.txt/route.ts", `${CANONICAL}/`],
  ["apps/console/src/app/page.tsx", `${CANONICAL}/`],
  ["apps/console/src/components/ProgressStrip.tsx", `search=${CANONICAL}`],
];
for (const [file, needle] of REQUIRED) {
  let text;
  try {
    text = read(file);
  } catch {
    problems.push(`${file} is missing — it is a place the canonical name must appear`);
    continue;
  }
  if (!text.includes(needle)) problems.push(`${file} does not name the canonical registry (${needle} absent)`);
}

// Every server.json and its package.json mcpName agree on one canonical name.
const manifests = files.filter((f) => /^packages\/[^/]+\/server\.json$/.test(f));
if (manifests.length === 0) problems.push("no packages/*/server.json found — cannot verify the canonical namespace");
for (const manifest of manifests) {
  const dir = manifest.slice(0, manifest.lastIndexOf("/"));
  const server = JSON.parse(read(manifest));
  if (!String(server.name ?? "").startsWith(`${CANONICAL}/`)) {
    problems.push(`${manifest}: name is ${JSON.stringify(server.name)}, expected ${CANONICAL}/…`);
  }
  let pkg;
  try {
    pkg = JSON.parse(read(`${dir}/package.json`));
  } catch {
    problems.push(`${dir}/package.json is missing while ${manifest} exists`);
    continue;
  }
  if (pkg.mcpName !== undefined && pkg.mcpName !== server.name) {
    problems.push(`${dir}/package.json: mcpName ${JSON.stringify(pkg.mcpName)} != server.json name ${JSON.stringify(server.name)}`);
  }
  if (pkg.mcpName !== undefined && !String(pkg.mcpName).startsWith(`${CANONICAL}/`)) {
    problems.push(`${dir}/package.json: mcpName ${JSON.stringify(pkg.mcpName)} is not ${CANONICAL}/…`);
  }
}

// Rule 3: the retired workflow is inert and says where publishing went.
const DNS_WORKFLOW = ".github/workflows/registry-dns.yml";
let dnsWorkflow = "";
try {
  dnsWorkflow = read(DNS_WORKFLOW);
} catch {
  notes.push(`${DNS_WORKFLOW} is absent; the retired namespace has no workflow to confuse`);
}
if (dnsWorkflow) {
  // Comments and the human-readable notice describe the old secret by name; only an
  // executable step can use it. Strip comment lines and the heredoc body is prose, so
  // match the commands a workflow would actually run.
  const executable = dnsWorkflow
    .split("\n")
    .filter((line) => !/^\s*#/.test(line))
    .join("\n");
  if (!/workflow_dispatch:/.test(executable)) problems.push(`${DNS_WORKFLOW} must be workflow_dispatch-only`);
  if (/secrets\.|MCP_REGISTRY_KEY|mcp-publisher\s+publish|login\s+dns/.test(executable)) {
    problems.push(`${DNS_WORKFLOW} still contains a secret, DNS login, or a publish step`);
  }
  if (!dnsWorkflow.includes(CANONICAL)) problems.push(`${DNS_WORKFLOW} does not point at the OIDC namespace ${CANONICAL}`);
  const release = read(".github/workflows/release.yml");
  if (!/login github-oidc/.test(release)) problems.push(".github/workflows/release.yml no longer authenticates the registry with github-oidc");
}

// Rule 4: read both namespaces and print what each serves.
function compareVersions(a, b) {
  const pa = String(a).split(/[.-]/);
  const pb = String(b).split(/[.-]/);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const x = pa[i] ?? "0";
    const y = pb[i] ?? "0";
    const nx = Number(x);
    const ny = Number(y);
    if (Number.isFinite(nx) && Number.isFinite(ny)) {
      if (nx !== ny) return nx - ny;
    } else if (x !== y) {
      return x < y ? -1 : 1;
    }
  }
  return 0;
}

async function readNamespace(prefix) {
  const url = `https://registry.modelcontextprotocol.io/v0/servers?search=${encodeURIComponent(prefix)}&limit=100`;
  const response = await fetch(url, {
    signal: AbortSignal.timeout(15_000),
    headers: { accept: "application/json", "user-agent": "PayStage-registry-namespace/1.0" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const body = await response.json();
  const latest = new Map();
  for (const entry of body.servers ?? []) {
    const server = entry.server ?? {};
    if (!String(server.name ?? "").startsWith(`${prefix}/`)) continue;
    const meta = entry._meta?.["io.modelcontextprotocol.registry/official"];
    const current = latest.get(server.name);
    if (!current || compareVersions(server.version, current.version) > 0) {
      latest.set(server.name, {
        version: server.version,
        isLatest: Boolean(meta?.isLatest),
        updatedAt: meta?.updatedAt ?? "unknown",
      });
    }
  }
  return latest;
}

let networkSummary = "Network comparison ran.";
if (OFFLINE) {
  console.log("registry-namespace: network comparison SKIPPED (--offline) — structural rules only");
  networkSummary = "Network comparison SKIPPED (--offline); versions unverified.";
} else {
  let canonicalMap;
  let retiredMap;
  try {
    [canonicalMap, retiredMap] = await Promise.all([readNamespace(CANONICAL), readNamespace(RETIRED)]);
  } catch (error) {
    const reason = String(error?.message ?? error).slice(0, 120);
    console.log(
      `registry-namespace: network comparison SKIPPED — ${reason}. ` +
        "No claim is made here that the two namespaces agree.",
    );
    networkSummary = `Network comparison SKIPPED (${reason}); versions unverified.`;
    canonicalMap = null;
  }

  if (canonicalMap && retiredMap) {
    console.log(`\n  ${CANONICAL} (canonical, OIDC)`);
    const rows = [...canonicalMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    if (rows.length === 0) problems.push(`${CANONICAL} answered but serves no servers`);
    for (const [name, info] of rows) {
      console.log(`    ${name.padEnd(50)} ${info.version.padEnd(10)} latest=${info.isLatest}`);
    }
    console.log(`\n  ${RETIRED} (retired DNS, frozen published state)`);
    const retiredRows = [...retiredMap.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [name, info] of retiredRows) {
      const frozen = FROZEN[name];
      const state = frozen ? (frozen === info.version ? "frozen" : `CHANGED (was ${frozen})`) : "UNEXPECTED";
      console.log(`    ${name.padEnd(50)} ${info.version.padEnd(10)} ${state}`);
      if (!frozen) problems.push(`${name} appeared in the retired namespace; nothing in this repo publishes there`);
      else if (frozen !== info.version) {
        problems.push(`${name} moved from the frozen ${frozen} to ${info.version}; the retirement is leaking`);
      }
    }

    for (const [canonicalName, retiredName] of PAIRS) {
      const canonical = canonicalMap.get(canonicalName);
      const retired = retiredMap.get(retiredName);
      if (!canonical || !retired) continue;
      if (canonical.version === retired.version) {
        notes.push(`${canonicalName} ${canonical.version} and ${retiredName} ${retired.version} agree`);
      } else if (ACCEPT_RETIRED && FROZEN[retiredName] === retired.version) {
        console.log(
          `  FROZEN  ${canonicalName} ${canonical.version} vs ${retiredName} ${retired.version} — ` +
            "retired namespace is frozen; drift printed, not failed",
        );
      } else {
        problems.push(
          `DRIFT: ${canonicalName} serves ${canonical.version}, ${retiredName} serves ${retired.version}` +
            (ACCEPT_RETIRED ? " (and the retired version is not the recorded frozen one)" : ""),
        );
      }
    }

    const releaseText = read(".github/workflows/release.yml");
    const skipped = new Set(
      (/NO_TRUSTED_PUBLISHER="([^"]+)"/.exec(releaseText)?.[1] ?? "").split(/\s+/).filter(Boolean),
    );
    for (const manifest of manifests) {
      const server = JSON.parse(read(manifest));
      // A package release.yml deliberately skips (no npm Trusted Publisher) cannot have a
      // canonical registry entry yet; the manifest is ready, the publish is not available.
      const packageDir = manifest.slice("packages/".length, manifest.indexOf("/server.json"));
      if (skipped.has(packageDir)) {
        notes.push(`${server.name} has no registry entry yet — release.yml skips ${packageDir} (no Trusted Publisher)`);
        continue;
      }
      if (!canonicalMap.has(server.name)) {
        problems.push(`${CANONICAL} does not answer for ${server.name} (declared in ${manifest})`);
      }
    }
  }
}

if (problems.length > 0) {
  console.error("\nregistry-namespace: FAIL");
  for (const problem of problems) console.error(`  · ${problem}`);
  process.exit(1);
}
console.log(
  `\nregistry-namespace: ${notes.length > 0 ? `${notes.length} note(s), ` : ""}` +
    `${historicalMentions} historical mention(s) allowed. ${networkSummary}`,
);
process.exit(0);

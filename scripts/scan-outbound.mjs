#!/usr/bin/env node
/**
 * Outbound scanner — read-only, runs on a timer, writes a candidate queue.
 *
 * Why this exists instead of 120 hourly model prompts: a scan that costs a model turn
 * produces a finding per turn at best and noise at worst. This runs unattended, writes
 * what it found to a queue, and a single daily model turn reads the queue and decides.
 *
 * It never contacts anyone. It never installs or executes a third-party package. Every
 * check below reads published metadata or a 402 challenge; none of them can send a
 * payment or reach a wallet.
 *
 *   node scan-outbound.mjs                 # human-readable
 *   node scan-outbound.mjs --queue <path>  # write candidate queue JSON
 *   node scan-outbound.mjs --json          # machine-readable
 *
 * Exit codes: 0 ran, candidates may or may not exist · 1 a check itself failed · 2 cannot read repo
 *
 * The queue is a *candidate* list, not a contact list. Nothing in it has been sent, and
 * every row still has to clear the runbook bar (docs/runbooks/outbound-contributions.md):
 * a defect with a reproduction, or a measurement with its method.
 */

import { readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const queuePath = argv.includes("--queue") ? argv[argv.indexOf("--queue") + 1] : null;
const REPO = process.env.PAYSTAGE_REPO ?? "/work/paystage"; // hardcoded-path-ok: operator tool, env-overridable fallback

const unscope = (n) => (n.includes("/") ? n.split("/")[1] : n);

async function getJSON(url) {
  const res = await fetch(url, {
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

/** npm's bin rule: 1 bin is used regardless of name; 2+ need one named after the package. */
function classifyBins(name, bin) {
  const bins = typeof bin === "string" ? [unscope(name)] : Object.keys(bin ?? {});
  const expected = unscope(name);
  if (bins.length === 0) return { bins, launchable: false, why: "declares no bin" };
  if (bins.length === 1) return { bins, launchable: true, why: `single bin: ${bins[0]}` };
  if (bins.includes(expected)) return { bins, launchable: true, why: `${bins.length} bins, includes ${expected}` };
  return { bins, launchable: false, why: `${bins.length} bins (${bins.join(", ")}), none named ${expected}` };
}

/** Check 1 — registry sellers whose live 402 contradicts their listing. Reuses the verified script. */
/**
 * A non-zero exit is a finding, not a crash.
 *
 * `execFile` rejects on a non-zero exit, and `verify-registry.mjs` exits 1 **while printing its full report** whenever
 * an entry is dead — so the report was discarded exactly when it had something to say, and the run reported
 * "registry FAILED" with no detail. Same class as reading a 403 as OPEN: an error path interpreted as a result. This
 * keeps stdout from the rejected call and fails only when there is nothing parseable.
 */
async function checkRegistry() {
  try {
    let stdout = "";
    try {
      ({ stdout } = await run("node", ["scripts/verify-registry.mjs", "--json"], { cwd: REPO, timeout: 240_000 }));
    } catch (error) {
      const failed = error;
      if (typeof failed?.stdout !== "string" || failed.stdout.trim() === "") throw failed;
      stdout = failed.stdout;
      process.stderr.write("scan-outbound: registry reported dead entries (exit 1); using its report\n");
    }
    const report = JSON.parse(stdout);
    const mismatches = report.entries
      .filter((e) => !e.ok)
      // our own hosted endpoints are an internal defect, not an outbound candidate
      .filter((e) => !/paystage/i.test(e.name))
      .map((e) => ({ kind: "registry-mismatch", target: e.name, url: e.url, detail: e.reason }));
    return { ok: true, total: report.total, live: report.live, candidates: mismatches };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), candidates: [] };
  }
}

/** Check 2 — MCP packages the documented one-liner cannot launch. Population measurement. */
async function checkMcpBins(limit = 120) {
  try {
    const search = await getJSON(`https://registry.npmjs.org/-/v1/search?text=keywords:mcp-server&size=${limit}`);
    const names = search.objects.map((o) => o.package.name);
    const rows = [];
    let cursor = 0;
    async function worker() {
      while (cursor < names.length) {
        const name = names[cursor++];
        try {
          const m = await getJSON(`https://registry.npmjs.org/${name.replace("/", "%2f")}/latest`);
          rows.push({ name, version: m.version, ...classifyBins(m.name, m.bin),
            repo: (m.repository?.url ?? "").replace(/^git\+/, "").replace(/\.git$/, "") });
        } catch { /* a private or unpublished entry is not a finding */ }
      }
    }
    await Promise.all(Array.from({ length: 10 }, worker));
    const unlaunchable = rows.filter((r) => !r.launchable);

    // Does the package's own documentation use the bare form? Without this filter the queue fills with
    // true-but-useless rows: two of the first three candidates documented `npx -y smithery mcp add …` or no
    // npx at all, so the failing command is not one their users are ever given. A defect nobody can hit is
    // not a report, it is noise with a reproduction attached.
    const relevant = unlaunchable.filter((r) => r.bins.length > 1); // no-bin packages are usually libraries
    const dropped = [];
    const actionable = [];
    await Promise.all(
      relevant.map(async (r) => {
        try {
          const doc = await getJSON(`https://registry.npmjs.org/${r.name.replace("/", "%2f")}`);
          const readme = String(doc.readme ?? "");
          const bare = new RegExp(`npx\\s+(-y\\s+)?${r.name.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`);
          if (readme.length === 0) {
            actionable.push({ ...r, docs: "unreadable" });
          } else if (bare.test(readme)) {
            actionable.push({ ...r, docs: "bare npx documented" });
          } else {
            dropped.push({ target: r.name, why: "docs do not use `npx -y <pkg>`; the failing command is not one users are given" });
          }
        } catch {
          dropped.push({ target: r.name, why: "readme unreadable; cannot show its users type the failing command" });
        }
      }),
    );

    return {
      ok: true,
      measured: rows.length,
      unlaunchable: unlaunchable.length,
      candidates: actionable.map((r) => ({
        kind: "bin-mismatch",
        target: r.name,
        version: r.version,
        repo: r.repo,
        detail: `${r.why} — ${r.docs}`,
      })),
      dropped,
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error), candidates: [] };
  }
}

let registry;
try {
  await readFile(`${REPO}/registry/services.json`, "utf8");
  registry = await checkRegistry();
} catch {
  process.stderr.write("scan-outbound: cannot read registry/services.json — check PAYSTAGE_REPO\n");
  process.exit(2);
}
const bins = await checkMcpBins(Number(process.env.SCAN_LIMIT ?? 120));

const candidates = [...registry.candidates, ...bins.candidates];
const queue = {
  scanned_at: new Date().toISOString(),
  read_only: true,
  contacts_sent: 0,
  checks: {
    registry: { ok: registry.ok, total: registry.total, live: registry.live, error: registry.error },
    mcp_bins: { ok: bins.ok, measured: bins.measured, unlaunchable: bins.unlaunchable, error: bins.error },
  },
  candidates,
  dropped: [...registry.dropped ?? [], ...bins.dropped ?? []],
  note: "Candidates only. Each row must still clear docs/runbooks/outbound-contributions.md before any contact.",
};

if (queuePath) await writeFile(queuePath, `${JSON.stringify(queue, null, 2)}\n`);

if (asJson) {
  process.stdout.write(`${JSON.stringify(queue, null, 2)}\n`);
} else {
  console.log(
    `registry   ${registry.ok ? `${registry.live}/${registry.total} live` : `FAILED: ${registry.error}`}`,
  );
  console.log(
    `mcp bins   ${bins.ok ? `${bins.unlaunchable}/${bins.measured} unlaunchable by \`npx -y <pkg>\`` : `FAILED: ${bins.error}`}`,
  );
  console.log(`candidates ${candidates.length}${queuePath ? ` · queue written to ${queuePath}` : ""}`);
  for (const c of candidates) console.log(`  [${c.kind}] ${c.target} — ${c.detail}`);
}
process.exit(registry.ok && bins.ok ? 0 : 1);

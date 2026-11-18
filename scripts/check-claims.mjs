#!/usr/bin/env node
/**
 * Copy drift check — the claims a stranger reads, against the code that backs them.
 *
 * Every page that numbers something (tools, packages, networks) is a place the number can go stale
 * after the code moves. This has already happened three times: the site said nine tools while the
 * hosted endpoint served one, x402-guard's README warned about missing provenance for two days after
 * it had been fixed, and the hero strip said "5" while nine were registered.
 *
 *   node scripts/check-claims.mjs            # exit 0 clean, 1 drift, 2 cannot read
 *   node scripts/check-claims.mjs --json
 *
 * It reads the truth from source — not from a built artefact, not from the live site — so it runs
 * before the thing it checks could have been deployed.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Derive the repo root from this file's location. A hardcoded /work/paystage worked in the container
// and failed in CI, which is the same class of mistake as a claim copied instead of referenced.
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const problems = [];
const ok = [];

/** Truth: the tools the package actually registers. */
function registeredTools() {
  const src = readFileSync(join(ROOT, 'packages/mcp/src/tools.ts'), 'utf8');
  const block = src.slice(src.indexOf('export const TOOL_NAMES'), src.indexOf(']', src.indexOf('export const TOOL_NAMES')));
  const names = [...block.matchAll(/"([a-z0-9_]+)"/g)].map((m) => m[1]);
  return names;
}

const tools = registeredTools();
if (tools.length === 0) {
  console.error('claims: could not read TOOL_NAMES from packages/mcp/src/tools.ts');
  process.exit(2);
}
ok.push(`package registers ${tools.length} tools`);

/** The number the console renders must equal the number the package registers. */
const lib = readFileSync(join(ROOT, 'apps/console/src/lib/tools.ts'), 'utf8');
const count = Number(/TOOL_COUNT\s*=\s*(\d+)/.exec(lib)?.[1]);
if (count !== tools.length) {
  problems.push(`apps/console/src/lib/tools.ts says ${count} tools; the package registers ${tools.length}`);
} else {
  ok.push(`console constant matches (${count})`);
}

/** Scan the pages a reader actually sees, plus the docs agents read, for a contradicting number. */
const SCAN = ['apps/console/src', 'apps/console/public', 'README.md', 'llms-install.md', 'packages/mcp/README.md'];
const WORD = { 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten' };
const stale = new RegExp(`\\b(${Object.values(WORD).join('|')}|\\d+)\\s+(small\\s+)?(MCP\\s+)?tools\\b`, 'gi');

function walk(path, out = []) {
  const full = join(ROOT, path);
  let st;
  try { st = statSync(full); } catch { return out; }
  if (st.isDirectory()) {
    for (const entry of readdirSync(full)) {
      if (entry === 'node_modules' || entry.startsWith('.')) continue;
      walk(join(path, entry), out);
    }
  } else if (['.tsx', '.ts', '.md', '.txt'].includes(extname(full))) {
    out.push(path);
  }
  return out;
}

const files = SCAN.flatMap((p) => walk(p));
for (const file of files) {
  const text = readFileSync(join(ROOT, file), 'utf8');
  for (const match of text.matchAll(stale)) {
    const raw = match[1].toLowerCase();
    const value = /^\d+$/.test(raw) ? Number(raw) : Object.entries(WORD).find(([, w]) => w === raw)?.[0];
    if (Number(value) === tools.length) continue;
    // CHANGELOG and historical notes are allowed to describe the past.
    if (file.includes('CHANGELOG')) continue;
    const line = text.slice(0, match.index).split('\n').length;
    problems.push(`${file}:${line} says "${match[0].trim()}" but the package registers ${tools.length}`);
  }
}


/**
 * Package-count claims.
 *
 * The adversarial review found "npm 7 packages" on the live site when there were ten — a claim that was
 * true when written and rotted as packages were published. Nothing counted. This does.
 */
function checkPackageCounts() {
  const published = readdirSync(join(ROOT, "packages"))
    .map((dir) => {
      try {
        const pkg = JSON.parse(readFileSync(join(ROOT, "packages", dir, "package.json"), "utf8"));
        return pkg.private === true ? null : pkg.name;
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  const SCAN = ["apps/console/src", "README.md", "llms-install.md"];
  const files = SCAN.flatMap((p) => walk(p));
  for (const file of files) {
    const text = readFileSync(join(ROOT, file), "utf8");
    // Only the shapes that assert something about *our* catalogue. A "three packages" in a sentence about
    // something else is not a claim about it, and a tolerance band was worse than useless: it skipped the
    // real drift (7 against 10) while still matching prose.
    for (const match of text.matchAll(/(\d+)\s+(?:published\s+)?packages\s*(?:·|,|\s+with\s+provenance)/gi)) {
      const claimed = Number(match[1]);
      if (claimed !== published.length) {
        const line = text.slice(0, match.index).split("\n").length;
        problems.push(`${file}:${line} says "${match[0]}" but ${published.length} packages are published`);
      }
    }
  }
  ok.push(`package count consistent (${published.length} published)`);
}

checkPackageCounts();
checkMcpCards();
checkToolDocs();
checkToolAnnotations();


/**
 * Two copies of the server card.
 *
 * The Worker answers `/.well-known/mcp.json` for agents talking to api.paystage.xyz; the site serves a static
 * copy for crawlers that only look at the apex. Same fact in two files, so it is checked rather than trusted.
 */
function checkMcpCards() {
  const worker = readFileSync(join(ROOT, "apps/hosted/src/routes/well-known-mcp.ts"), "utf8");
  const statik = JSON.parse(readFileSync(join(ROOT, "apps/console/public/.well-known/mcp.json"), "utf8"));
  const name = /name:\s*"([^"]+)"/.exec(worker)?.[1];
  if (name !== statik.name) {
    problems.push(`mcp.json name differs: worker "${name}" vs site "${statik.name}"`);
  }
  if (!statik.keywords?.includes("x402")) {
    problems.push("mcp.json keywords lost the words an agent searches with");
  }
  ok.push("mcp.json card consistent");
}


/**
 * Every README that lists tools must list all of them.
 *
 * The npm page for @paystage/mcp documented five of nine for weeks while the endpoint served nine and the
 * registry said nine — the same divergence as mcp.so, except ours to fix. Counting here means a new tool
 * cannot ship undocumented in the place most readers arrive.
 */
function checkToolDocs() {
  const toolsSrc = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
  const names = [...toolsSrc.matchAll(/registerTool\(\s*"([a-z0-9_]+)"/g)].map((m) => m[1]);
  const unique = [...new Set(names)];
  for (const file of ["README.md", "packages/mcp/README.md"]) {
    const text = readFileSync(join(ROOT, file), "utf8");
    // Word boundaries: `includes("evaluate_batch")` matched `evaluate_batch_removed`, so the guard passed
    // while the tool was gone. Proven by renaming it and watching the check stay green.
    const missing = unique.filter((t) => !new RegExp(`\\b${t}\\b`).test(text));
    if (missing.length > 0) {
      problems.push(`${file} documents ${unique.length - missing.length}/${unique.length} tools — missing: ${missing.join(", ")}`);
    }

    // A mention anywhere is not a tool list. The repo README had a nine-tool section *and* a stale five-row
    // table that a reader hits first; counting the table is the only version of this check that would have
    // caught it.
    const tableStart = text.indexOf("| Tool | Status |");
    if (tableStart !== -1) {
      const tableLines = text.slice(tableStart).split("\n");
      const tableRows = [];
      // Walk until the table ends: the first non-table line after at least one row.
      for (const line of tableLines.slice(1)) {
        if (line.startsWith("| `")) tableRows.push(line);
        else if (tableRows.length > 0) break;
      }
      if (tableRows.length !== unique.length) {
        problems.push(`${file}: the "Tools" table lists ${tableRows.length} rows, the server registers ${unique.length}`);
      }
    }
  }
  ok.push(`tool docs complete (${unique.length} tools in both READMEs)`);
}


/**
 * Every tool needs the four annotation fields an MCP host uses as trust badges, and `openWorldHint` must be true only
 * where the tool actually reaches the network — a "read-only" claim that hides a fetch is worse than no annotation.
 */
function checkToolAnnotations() {
  const src = readFileSync(join(ROOT, "packages/mcp/src/tools.ts"), "utf8");
  const NETWORK_TOOLS = new Set([
    "list_outstanding_auths",
    "evaluate_outstanding_auths",
    "evaluate_hip3_trade",   // read-only market query
    "verify_receipt",        // fetches the published key
    "request_testnet_funds", // POSTs to the sepia faucet, which sends a testnet transaction
  ]);
  for (const block of src.split("server.registerTool(").slice(1)) {
    const name = /^\s*"([a-z0-9_]+)"/.exec(block)?.[1];
    if (!name) continue;
    const ann = block.slice(block.indexOf("annotations"), block.indexOf("inputSchema"));
    for (const field of ["title", "readOnlyHint", "destructiveHint", "openWorldHint"]) {
      if (!new RegExp(`${field}:`).test(ann)) problems.push(`${name}: annotation "${field}" missing`);
    }
    const openWorld = /openWorldHint:\s*(true|false)/.exec(ann)?.[1];
    const shouldBeOpen = NETWORK_TOOLS.has(name) ? "true" : "false";
    if (openWorld !== shouldBeOpen) {
      problems.push(`${name}: openWorldHint is ${openWorld}, expected ${shouldBeOpen}${NETWORK_TOOLS.has(name) ? " (it reaches the network)" : ""}`);
    }
  }
  ok.push("tool annotations complete and honest");
}

/**
 * A Mermaid block is a claim about behaviour, and GitHub renders it — nothing else in this repo
 * checks it. #177 drew the pay / review / do_not_pay flow; if a verdict is renamed, the diagram would
 * keep drawing the one the code no longer produces, which is worse than having no diagram.
 *
 * Two directions, because one alone is the failure this repo keeps paying for:
 *   - no invented verdict: every `do_not_*` the diagram names must exist in an evaluator's Decision type
 *   - no missing verdict: every verdict the payment evaluator declares must appear in a diagram
 * A fixed allow-list would only prove the words we already thought of; `do_not_charge` would sail past
 * it, which is exactly how the first version of this check passed while naming a verdict that does not
 * exist.
 */
function checkMermaidVerdicts() {
  const decisionOf = (file) => {
    const src = readFileSync(join(ROOT, file), "utf8");
    const decl = /export type Decision = ([^;]+);/.exec(src)?.[1];
    return decl ? [...decl.matchAll(/"([a-z_]+)"/g)].map((m) => m[1]) : null;
  };
  const payment = decisionOf("packages/preflight/src/evaluate.ts");
  const trade = decisionOf("packages/trade-preflight/src/types.ts");
  if (!payment || !trade) {
    problems.push("could not read a `Decision` type from the evaluators — cannot police the diagrams");
    return;
  }
  const produced = new Set([...payment, ...trade]);

  let readme;
  try {
    readme = readFileSync(join(ROOT, "README.md"), "utf8");
  } catch {
    ok.push("no README to police");
    return;
  }
  const blocks = [...readme.matchAll(/```mermaid\n([\s\S]*?)```/g)].map((m) => m[1]);
  if (blocks.length === 0) {
    ok.push("no mermaid diagrams in the README");
    return;
  }
  const diagram = blocks.join("\n");

  // Direction 1: an invented verdict, whatever it is called.
  const invented = new Set([...diagram.matchAll(/\bdo_not_[a-z_]+\b/g)].map((m) => m[0]).filter((v) => !produced.has(v)));
  for (const verdict of invented) {
    problems.push(`README mermaid names "${verdict}"; the evaluators produce only ${[...produced].join(", ")}`);
  }

  // Direction 2: a verdict the evaluator produces but the diagram does not show.
  for (const verdict of payment) {
    if (!new RegExp(`\\b${verdict}\\b`).test(diagram)) {
      problems.push(`README mermaid never shows "${verdict}", which the payment evaluator produces`);
    }
  }

  if (problems.length === 0) ok.push(`mermaid matches the evaluators (${blocks.length} block(s), shows ${payment.join(", ")})`);
}

checkMermaidVerdicts();

const payload = { ok: problems.length === 0, tools: tools.length, passed: ok, problems };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const line of ok) console.log(`  ok    ${line}`);
  for (const line of problems) console.log(`  DRIFT ${line}`);
  console.log(problems.length === 0 ? `\nclaims: clean (${files.length} files scanned)` : `\nclaims: ${problems.length} drift(s)`);
}
process.exit(problems.length === 0 ? 0 : 1);

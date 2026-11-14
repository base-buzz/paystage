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
import { join, extname } from 'node:path';

const ROOT = '/work/paystage';
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

const payload = { ok: problems.length === 0, tools: tools.length, passed: ok, problems };
if (process.argv.includes('--json')) {
  console.log(JSON.stringify(payload, null, 2));
} else {
  for (const line of ok) console.log(`  ok    ${line}`);
  for (const line of problems) console.log(`  DRIFT ${line}`);
  console.log(problems.length === 0 ? `\nclaims: clean (${files.length} files scanned)` : `\nclaims: ${problems.length} drift(s)`);
}
process.exit(problems.length === 0 ? 0 : 1);

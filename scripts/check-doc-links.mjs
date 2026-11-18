#!/usr/bin/env node
/** Doc-link resolver — pre-push hook for repo-relative markdown inline links. */
import { readFileSync, statSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { execSync } from 'node:child_process';

// Repo root
const REPO_ROOT = '/work/paystage';

function getTrackedMdFiles() {
  try {
    const raw = execSync(`git -C "${REPO_ROOT}" ls-files -- "*.md"`, { encoding: 'utf8' }).trim();
    if (!raw) return new Set();
    return new Set(raw.split('\n').filter(f => f && !f.includes('node_modules')));
  } catch {
    return new Set();
  }
}

function fileExists(p) {
  try { statSync(p); return true; } catch { return false; }
}

function stripAnchor(p) {
  return p.split('#')[0];
}

/** Check if a path is repo-relative (no http/https/#/absolute). */
function isRepoRelativePath(p) {
  if (!p) return false;
  if (p.startsWith('http://') || p.startsWith('https://')) return false;
  if (p.startsWith('/')) return false;
  if (p.startsWith('#')) return false;
  return true;
}

function checkFile(filePath) {
  const absPath = resolve(REPO_ROOT, filePath);
  const fileDir = dirname(absPath);
  const text = readFileSync(absPath, 'utf8');

  // Pattern: Inline markdown links [text](path) — resolved relative to file dir
  // This catches links like [](path) (empty display text) or [text](path)
  const linkRegex = /\[([^\]]*)\]\(([^)]+)\)/g;
  let match;
  while ((match = linkRegex.exec(text)) !== null) {
    let lnk = match[2].trim();
    lnk = stripAnchor(lnk);
    if (!isRepoRelativePath(lnk)) continue;
    const resolved = resolve(fileDir, lnk);
    if (!fileExists(resolved)) {
      console.error(`DRIFT ${filePath}: link []((${lnk})) → ${lnk} (file not found)`);
      process.exit(1);
    }
  }

  // Pattern: Backtick-quoted file references `path/file.ts`
  // Very restrictive: only check `./` or `../` paths with .ts or .js extension
  const backtickRegex = /`([^`]+)`/g;
  while ((match = backtickRegex.exec(text)) !== null) {
    let c = match[1].trim();
    c = stripAnchor(c);
    // Only check paths starting with ./ or ../ with .ts or .js extension
    if (!c.startsWith('./') && !c.startsWith('../')) continue;
    if (!c.endsWith('.ts') && !c.endsWith('.js')) continue;
    const resolved = resolve(REPO_ROOT, c);
    if (!fileExists(resolved)) {
      console.error(`DRIFT ${filePath}: backtick \`${c}\` → file not found`);
      process.exit(1);
    }
  }
}

function main() {
  const mdFiles = getTrackedMdFiles();
  if (mdFiles.size === 0) { console.log('No tracked markdown files.'); process.exit(0); }
  for (const file of mdFiles) { checkFile(file); }
  console.log(`doc-links: all ${mdFiles.size} markdown files have resolving links`);
  process.exit(0);
}

main();
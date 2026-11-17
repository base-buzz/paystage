#!/usr/bin/env node
/**
 * WCAG AA contrast for both themes, computed rather than eyeballed.
 *
 * Dark mode shipped with `--lp-faint` at 4.14:1, just under AA for normal text — invisible in a screenshot and obvious
 * to a calculator. This reads the token blocks out of landing.css and fails on any pair below 4.5:1.
 *
 * Text on the mint **fill** was the gap: the primary button used `#05100c` on `#047857` in light mode, 3.53:1, and it
 * shipped because this file only checked tokens against the canvas and the panel. A token named `--lp-on-<token>` is now
 * text for a fill, checked against that fill instead of against the page — which is the pair a reader actually sees.
 *
 *   node scripts/check-contrast.mjs
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const css = readFileSync(join(ROOT, "apps/console/src/app/landing.css"), "utf8");

const luminance = (hex) => {
  const h = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};

function tokens(block) {
  const out = {};
  for (const m of block.matchAll(/--lp-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) out[m[1]] = m[2];
  return out;
}

const mediaLightStart = css.indexOf("@media (prefers-color-scheme: light)");
const explicitLightStart = css.indexOf('html[data-theme="light"] {');
// The dark block ends at whichever light block comes first. Slicing it to the media query swallowed the explicit light
// block, so `tokens()` returned the light values under the name "dark" — the check was measuring one palette twice.
const darkEnd = explicitLightStart >= 0 && explicitLightStart < mediaLightStart ? explicitLightStart : mediaLightStart;
const darkBlock = css.slice(0, darkEnd); // the tokens live in `:root {` at the top of the file
// Both light blocks must be read. The explicit choice and the system default are two copies of the same palette, and
// checking only the second is how the first can carry a colour nobody measured.
const lightBlocks =
  explicitLightStart >= 0 && explicitLightStart < mediaLightStart
    ? [["light (explicit)", css.slice(explicitLightStart, mediaLightStart)], ["light (system)", css.slice(mediaLightStart)]]
    : [["light", css.slice(mediaLightStart)]];

const problems = [];
for (const [theme, block] of [["dark", darkBlock], ...lightBlocks]) {
  const t = tokens(block);
  if (!t.bg || !t.text) {
    problems.push(`${theme}: could not read --lp-bg / --lp-text from landing.css`);
    continue;
  }
  // Body copy and every token used as text must clear AA (4.5:1) against the page background and against a panel,
  // because cards and the canvas are both places text lands.
  for (const [name, fg] of Object.entries(t)) {
    if (["bg", "panel", "panel-2", "line", "line-soft"].includes(name)) continue;

    // `--lp-on-<fill>` is text drawn on a filled surface, not on the page. Check it against its own fill; checking it
    // against the canvas would fail a colour that is only ever seen inside a button.
    if (name.startsWith("on-")) {
      const fill = t[name.slice(3)];
      if (!fill) {
        problems.push(`${theme}: --lp-${name} names a fill (--lp-${name.slice(3)}) that does not exist`);
        continue;
      }
      const r = ratio(fg, fill);
      if (r < 4.5) problems.push(`${theme}: --lp-${name} on --lp-${name.slice(3)} is ${r.toFixed(2)}:1 (AA needs 4.5 for button text)`);
      continue;
    }

    for (const ground of ["bg", "panel"]) {
      if (!t[ground]) continue;
      const r = ratio(fg, t[ground]);
      if (r < 4.5) problems.push(`${theme}: --lp-${name} on --lp-${ground} is ${r.toFixed(2)}:1 (AA needs 4.5)`);
    }
  }
}

/**
 * A broad anchor colour rule outranks a single-class button modifier by specificity, so the button's own
 * `color` never applies. That is how the primary button drew body ink on mint in both themes — the tokens were
 * correct and the pair was unreadable, which this file could not see because it only compares token values.
 * Cheap static guard: a rule that colours a bare `a` inside `.lp` must exclude the buttons.
 */
const cssNoComments = css.replace(/\/\*[\s\S]*?\*\//g, "");
for (const rule of cssNoComments.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
  if (!/color\s*:/.test(rule[2])) continue;
  for (const raw of rule[1].split(",")) {
    const selector = raw.trim();
    if (!/^\.lp\b/.test(selector)) continue;
    // Only the unscoped rule: `.lp a` or `.lp > a`. A rule scoped to one component (`.lp-faq a`) cannot
    // reach a button in the page furniture and does not outrank anything globally.
    if (!/^\.lp\s*(>\s*)?a$/.test(selector)) continue;
    if (/\.lp-btn/.test(selector)) continue;
    problems.push(`anchor colour rule "${selector}" must exclude .lp-btn — it outranks .lp-btn-primary by specificity`);
  }
}

/**
 * Console text tokens must follow the theme, not sit at fixed light-on-dark values.
 *
 * `globals.css` defines `--text: #e6e8ee` for the console. That is invisible in dark mode and invisible *as
 * text* in light mode: every console page inherited near-white on a light canvas, measured as the `/try`
 * headings disappearing (#e6e8ee on #ffffff). The landing palette is the one that switches, so the console
 * owes it a `var(--lp-…)` reference — and this file can check a variable's shape even though it cannot paint.
 */
const globals = readFileSync(join(ROOT, "apps/console/src/app/globals.css"), "utf8");
for (const token of ["text", "muted"]) {
  const decl = new RegExp(`--${token}:\\s*([^;]+);`).exec(globals)?.[1]?.trim() ?? "";
  if (!decl.startsWith("var(--lp-")) {
    problems.push(`globals.css: --${token} is "${decl}" — a fixed colour, so it cannot follow the theme; use var(--lp-…)`);
  }
}

if (problems.length > 0) {
  for (const p of problems) console.log(`  FAIL ${p}`);
  console.log("contrast: below AA");
  process.exit(1);
}
console.log("contrast: both themes clear AA for every text token on canvas and panel");

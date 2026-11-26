#!/usr/bin/env node
/**
 * The 30-second loop, rendered from the same geometry as the pass (#459).
 *
 * Three scenes, one source, two aspect ratios. Every frame is a deterministic SVG → PNG: same input, same bytes, so a
 * re-cut after a mark change is a `git diff` of images rather than a re-record and a hope. A screen recording would be
 * stale the day the logo changes and nobody would notice; this cannot be, because it is built from the mark's numbers.
 *
 *   node scripts/render-loop.mjs                    # 1080×1080 and 16:9 into brand/loop/
 *   node scripts/render-loop.mjs --fps 4 --seconds 30
 *
 * The numbers in scenes 1 and 2 are **stated examples**, labelled as such in the copy. They are loaded from the file
 * below rather than typed into the renderer so a real measurement can replace them; they are not a market claim.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

/**
 * Fonts before sharp, or every frame is a grid of tofu boxes. Same source the pass renderer uses — Next's compiled
 * Noto Sans — and the same trap: sharp does not see a font without this.
 */
const FONT_CANDIDATES = [
  join(process.cwd(), "scripts/assets/fonts"),
  join(process.cwd(), "apps/console/node_modules/next/dist/compiled/@vercel/og"),
];
const fontDir = FONT_CANDIDATES.find((d) => existsSync(d) && readdirSync(d).some((f) => /\.(ttf|otf)$/i.test(f)));
if (!fontDir) {
  console.error("render-loop: no font found — every frame would be tofu boxes, so this refuses");
  process.exit(2);
}
const confDir = join(tmpdir(), "paystage-loop-fonts");
mkdirSync(confDir, { recursive: true });
const conf = join(confDir, "fonts.conf");
writeFileSync(conf, `<?xml version="1.0"?>\n<!DOCTYPE fontconfig SYSTEM "fonts.dtd">\n<fontconfig>\n  <dir>${fontDir}</dir>\n  <cachedir>${join(confDir, "cache")}</cachedir>\n</fontconfig>\n`);
process.env.FONTCONFIG_FILE = conf;

const { ticketGroup } = await import("./lib/mark.mjs");
const TOKENS = JSON.parse(readFileSync("apps/console/src/lib/pass-tokens.json", "utf8"));
const { ink: INK, deep: DEEP, gold: GOLD, muted: MUTED, red: RED } = TOKENS.palette;
const PAPER = "#FFFFFF";
const SANS = "Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif";

/** The example, in one place. Replace these with a measurement and the animation follows. */
const EXAMPLE = {
  calls: 1840,
  services: 6,
  refusals: 98,
  lostToWrongPayee: 0,
};

const args = process.argv.slice(2);
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? Number(args[i + 1]) : fallback;
};
const FPS = argOf("fps", 4);
const SECONDS = argOf("seconds", 30);
const TOTAL = FPS * SECONDS;

/**
 * The geometry check, run first: an animation of a superseded mark is the most expensive kind of stale, so this refuses
 * to render one.
 */
try {
  execFileSync(process.execPath, ["scripts/check-brand-assets.mjs"], { stdio: "pipe" });
} catch (error) {
  console.error("render-loop: the brand check failed, so this will not render an animation of a mark that is out of date.");
  console.error(String(error.stdout ?? "").split("\n").slice(0, 6).join("\n"));
  process.exit(1);
}

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const t = (x, y, text, size, { colour = INK, weight = 500, spacing = "0.01em", anchor = "start" } = {}) =>
  `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${size}" font-weight="${weight}" letter-spacing="${spacing}"
    text-anchor="${anchor}" fill="${colour}" stroke="${colour}" stroke-width="${size * 0.012}">${esc(text)}</text>`;

const ms = (width, height, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <rect width="${width}" height="${height}" fill="${PAPER}"/>${body}</svg>`;

/** Scene 1 — the month nobody approved, counts climbing. */
function sceneBillShock(w, h, phase) {
  const f = (n) => (n * Math.min(w, h)) / 100;
  const shown = Math.round(EXAMPLE.calls * phase);
  const dots = Array.from({ length: 40 }, (_, i) => {
    const upTo = Math.round(40 * phase);
    if (i >= upTo) return "";
    const col = i % 8;
    const row = Math.floor(i / 8);
    return `<circle cx="${f(10) + col * f(5.4)}" cy="${f(30) + row * f(5.4)}" r="${f(0.9)}" fill="${DEEP}" opacity="0.75"/>`;
  }).join("");
  return ms(
    w,
    h,
    `${t(f(8), f(14), "One month of agent payments", f(6.4), { weight: 700, spacing: "-0.01em" })}
     ${dots}
     ${t(f(8), f(66), `${shown.toLocaleString("en-US")} calls`, f(11), { weight: 700, spacing: "-0.02em" })}
     ${t(f(8), f(74), `${EXAMPLE.services} services · nobody approved any`, f(4.4), { colour: MUTED })}
     ${t(f(8), f(90), "an example, not a measurement", f(2.8), { colour: MUTED })}`,
  );
}

/** Scene 2 — the pass lands, the same month under limits. */
function sceneCaps(w, h, phase) {
  const f = (n) => (n * Math.min(w, h)) / 100;
  const refusals = Math.round(EXAMPLE.refusals * phase);
  // The mark is drawn by the shared module rather than by three hand-written rects here, so the 62%
  // second plate reaches the loop as well (#460). It used to be a local copy of the geometry, which is
  // exactly how a stale mark survives a brand change.
  const mark = ticketGroup({ x: f(8), y: f(24), width: f(9), plate: DEEP, lens: GOLD, surface: PAPER });
  return ms(
    w,
    h,
    `${t(f(8), f(14), "The pass carries the limits", f(6.4), { weight: 700, spacing: "-0.01em" })}
     ${mark}
     ${t(f(8), f(46), `${refusals} refusals`, f(9), { weight: 700, spacing: "-0.02em", colour: INK })}
     ${t(f(8), f(54), `$${EXAMPLE.lostToWrongPayee} lost to a wrong payee`, f(4.6), { colour: MUTED })}
     ${t(f(8), f(62), "every refusal names the rule that fired", f(4.0), { colour: MUTED })}
     ${t(f(8), f(90), "an example, not a measurement", f(2.8), { colour: MUTED })}`,
  );
}

/** Scene 3 — two doors, then the lockup. */
function sceneDoors(w, h, phase) {
  const f = (n) => (n * Math.min(w, h)) / 100;
  const show = phase > 0.35;
  return ms(
    w,
    h,
    `${t(f(8), f(20), "Two ways in", f(6.4), { weight: 700, spacing: "-0.01em" })}
     ${t(f(8), f(32), "Use ours — free", f(7.0), { weight: 700, colour: DEEP })}
     ${t(f(8), f(39), "a hosted pass, issued in a minute", f(3.8), { colour: MUTED })}
     ${show ? t(f(8), f(54), "Or ask your teammate", f(7.0), { weight: 700, colour: DEEP }) : ""}
     ${show ? t(f(8), f(61), "your own branded passes in two minutes", f(3.8), { colour: MUTED }) : ""}
     ${phase > 0.7 ? t(f(8), f(84), "vouchguard", f(5.4), { weight: 700, spacing: "0.24em", colour: INK }) : ""}`,
  );
}

const SIZES = [
  { name: "square", w: 1080, h: 1080 },
  { name: "wide", w: 1920, h: 1080 },
];

mkdirSync("brand/loop", { recursive: true });
const { default: sharp } = await import("sharp");

const written = [];
for (const { name, w, h } of SIZES) {
  for (let frame = 0; frame < TOTAL; frame++) {
    const at = frame / TOTAL;
    const body =
      at < 0.34 ? sceneBillShock(w, h, at / 0.34) : at < 0.67 ? sceneCaps(w, h, (at - 0.34) / 0.33) : sceneDoors(w, h, (at - 0.67) / 0.33);
    const file = join("brand/loop", `${name}-${String(frame).padStart(4, "0")}.png`);
    await sharp(Buffer.from(body)).png().toFile(file);
    written.push(file);
  }
}

writeFileSync(
  "brand/loop/README.md",
  `# The loop\n\nRendered by \`node scripts/render-loop.mjs\` at ${FPS} fps for ${SECONDS}s → ${TOTAL} frames per aspect.\n\n` +
    `\`\`\`bash\n# assemble (ffmpeg is not installed in this container)\nffmpeg -framerate ${FPS} -i square-%04d.png -pix_fmt yuv420p loop-square.mp4\nffmpeg -framerate ${FPS} -i wide-%04d.png -pix_fmt yuv420p loop-wide.mp4\n\`\`\`\n\n` +
    `The numbers in scenes 1 and 2 are a **stated example**, not a measurement: they live in \`EXAMPLE\` at the top of the\n` +
    `script so a real reading can replace them. Re-run after a mark change — the script refuses if the brand check fails,\n` +
    `because an animation of a superseded logo is the most expensive kind of stale.\n`,
);

console.log(`render-loop: ${written.length} frame(s) at ${FPS} fps, ${SECONDS}s, two aspect ratios, in brand/loop/`);
console.log(`render-loop: scenes = bill shock (${EXAMPLE.calls} calls) · caps (${EXAMPLE.refusals} refusals) · two doors`);

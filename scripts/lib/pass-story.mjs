/**
 * The story frames (`/mocks`) that are **not** a pass face.
 *
 * Two kinds live here, and the page labels which is which:
 *
 *  - **screens** — what the human sees at a moment (a refusal, a review, a revoke sheet). Drawn with the same tokens
 *    and type scale as the face, so a reader cannot tell them apart from product;
 *  - **diagrams** — sequences and states, which are not a screen anyone could screenshot. They carry the word
 *    `DIAGRAM` on the frame, because a diagram that pretends to be a screenshot is how a storyboard starts lying.
 *
 * Nothing here is generated from a live endpoint; every value is a fixture, and the page says so.
 */
import TOKENS from "../../apps/console/src/lib/pass-tokens.json" with { type: "json" };

const { ink: INK, paper: PAPER, deep: DEEP, gold: GOLD, muted: MUTED, red: RED } = TOKENS.palette;
const SANS = "Noto Sans, -apple-system, Helvetica Neue, Arial, sans-serif";

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** A label with the frame's type scale. `anchor` is the SVG text-anchor, not a layout decision. */
function t(x, y, text, size, { colour = INK, weight = 500, spacing = "0.01em", anchor = "start" } = {}) {
  return `<text x="${x}" y="${y}" font-family="${SANS}" font-size="${size}" font-weight="${weight}"
    letter-spacing="${spacing}" text-anchor="${anchor}" fill="${colour}">${esc(text)}</text>`;
}

/** The word that keeps a diagram honest. */
function diagramBadge(w) {
  const f = (n) => Math.round(((n * w) / 100) * 100) / 100;
  return `<g>
    <rect x="${f(6)}" y="${f(3)}" width="${f(15)}" height="${f(5)}" rx="${f(1)}" fill="none" stroke="${MUTED}" stroke-width="${f(0.25)}"/>
    ${t(f(13.5), f(6.5), "DIAGRAM", f(3.1), { colour: MUTED, weight: 700, spacing: "0.14em", anchor: "middle" })}
  </g>`;
}

function frame(w, h, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="${PAPER}"/>
  ${body}
</svg>`;
}

const px = (w, n) => Math.round(((n * w) / 100) * 100) / 100;

/**
 * Story 2, frame 1 — **the work nobody watches.** The argument the product is for: forty payments, no notification.
 */
export function invisibleCallsSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const rows = [
    ["09:14:02", "api.weather.dev", "0.004", "pay"],
    ["09:14:07", "search.index.io", "0.002", "pay"],
    ["09:21:44", "inference.cloud", "0.018", "pay"],
    ["09:22:10", "inference.cloud", "0.018", "pay"],
    ["09:38:55", "data.markets", "0.011", "pay"],
    ["09:39:02", "inference.cloud", "0.018", "review"],
    ["10:02:31", "api.weather.dev", "0.004", "pay"],
    ["10:03:00", "unknown-payee.xyz", "0.240", "do_not_pay"],
  ];
  const h = f(14 + rows.length * 8 + 14);
  const rowsSvg = rows
    .map(([at, payee, amount, verdict], i) => {
      const y = f(18 + i * 8);
      const colour = verdict === "pay" ? INK : verdict === "review" ? GOLD : RED;
      const tag = verdict === "pay" ? "paid" : verdict === "review" ? "held for a human" : "refused";
      return `<g>
        ${t(f(6), y, at, f(2.6), { colour: MUTED, weight: 500, spacing: "0.04em", w })}
        ${t(f(18), y, payee, f(3.0), { w })}
        ${t(f(58), y, `$${amount}`, f(3.0), { weight: 600, anchor: "end" })}
        ${t(f(62), y, tag, f(2.6), { colour, weight: 600 })}
      </g>`;
    })
    .join("");
  return frame(
    w,
    h,
    `<rect x="${f(4)}" y="${f(3)}" width="${f(92)}" height="${f(0.4)}" fill="${INK}"/>
     ${t(f(4), f(9), "40 payments today", f(5.0), { weight: 700, spacing: "-0.01em", w })}
     ${t(f(96), f(9), "notifications sent: 0", f(3.0), { colour: MUTED, weight: 500, w, anchor: "end" })}
     ${rowsSvg}
     <rect x="${f(4)}" y="${f(18 + rows.length * 8 + 2)}" width="${f(92)}" height="${f(0.3)}" fill="#CFC9BC"/>
     ${t(f(4), f(18 + rows.length * 8 + 7.5), "The human sees this list only when they go looking.", f(2.6), { colour: MUTED })}
     ${t(f(4), f(18 + rows.length * 8 + 11), "That is the design, not an outage.", f(2.6), { colour: MUTED })}`,
  );
}

/** Story 2, frame 2 — **a refusal at the cap**, shown as what the agent gets, not what a dashboard says. */
export function capRefusalSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(58);
  return frame(
    w,
    h,
    `<rect x="${f(6)}" y="${f(6)}" width="${f(88)}" height="${f(44)}" rx="${f(2.5)}" fill="none" stroke="${RED}" stroke-width="${f(0.45)}"/>
     ${t(f(10), f(13), "do_not_pay", f(5.6), { colour: RED, weight: 700, spacing: "0.02em", w })}
     ${t(f(10), f(19), "amount 0.240 USDC exceeds per-payment cap 0.02 USDC", f(3.0), { w })}
     <rect x="${f(10)}" y="${f(22)}" width="${f(80)}" height="${f(0.25)}" fill="#CFC9BC"/>
     ${t(f(10), f(28), "rule", f(2.6), { colour: MUTED, weight: 600, spacing: "0.08em", w })}
     ${t(f(19), f(28), "velocity.per_payment", f(2.9), { weight: 600, w })}
     ${t(f(10), f(34), "payee", f(2.6), { colour: MUTED, weight: 600, spacing: "0.08em", w })}
     ${t(f(19), f(34), "unknown-payee.xyz (not on the pass's list)", f(2.9), { w })}
     ${t(f(10), f(40), "signature", f(2.6), { colour: MUTED, weight: 600, spacing: "0.08em", w })}
     ${t(f(19), f(40), "not produced — the refusal happens before the account is called", f(2.9), { w })}
     ${t(f(10), f(46), "The agent cannot spend more than the cap by asking nicely. It receives this and stops.", f(2.8), { colour: MUTED, w })}`,
  );
}

/** Story 2, frame 3 — **a review arriving**: the one case that is not a yes or a no, and what it carries. */
export function reviewArrivesSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(52);
  return frame(
    w,
    h,
    `<rect x="${f(6)}" y="${f(6)}" width="${f(88)}" height="${f(11)}" rx="${f(2)}" fill="${GOLD}"/>
     ${t(f(10), f(13), "review", f(4.6), { colour: "#2A2410", weight: 700, w })}
     ${t(f(90), f(13), "a human decides", f(2.8), { colour: "#2A2410", weight: 600, w, anchor: "end" })}
     ${t(f(6), f(24), "inference.cloud asks 0.018 USDC — 90% of today's remaining allowance", f(3.1), { w })}
     ${t(f(6), f(30), "checks run", f(2.6), { colour: MUTED, weight: 600, spacing: "0.08em", w })}
     ${t(f(6), f(35), "policy · payee · amount · velocity · expiry", f(2.9), { w })}
     ${t(f(6), f(41), "checks skipped", f(2.6), { colour: MUTED, weight: 600, spacing: "0.08em", w })}
     ${t(f(6), f(46), "delivery — we do not verify that a seller delivers", f(2.9), { w })}
     ${t(f(6), f(50), "The packet is the deliverable: the rule, the numbers, and what we did not check.", f(2.8), { colour: MUTED, w })}`,
  );
}

/** Story 4, frame 1 — **one action**, and what it says it will do. */
export function revokeActionSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(46);
  return frame(
    w,
    h,
    `${t(f(8), f(11), "Grok Bot", f(6.0), { weight: 700, spacing: "-0.01em", w })}
     ${t(f(8), f(17), "$2.00 each · $20.00 per 24h · expires 31 Jan", f(3.1), { colour: MUTED, w })}
     <rect x="${f(8)}" y="${f(22)}" width="${f(84)}" height="${f(13)}" rx="${f(2.2)}" fill="${RED}"/>
     ${t(f(50), f(30.5), "Stop this pass", f(4.4), { colour: "#FFFFFF", weight: 700, w, anchor: "middle" })}
     ${t(f(8), f(40), "One action. The name comes off the pass, the pass leaves the teammates, and the serial", f(2.9), { colour: MUTED, w })}
     ${t(f(8), f(44), "answers revoked to anyone who checks it — including someone holding the old image.", f(2.9), { colour: MUTED, w })}`,
  );
}

/** Story 4, frame 2 — **deleting the pass is not revoking it.** The most common misunderstanding, drawn. */
export function passDeletedNotRevokedSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(58);
  const col = (x, title, sub) =>
    `${t(x, f(16), title, f(3.2), { weight: 700 })}
     ${t(x, f(21), sub, f(2.4), { colour: MUTED })}`;
  return frame(
    w,
    h,
    `${diagramBadge(w)}
     ${col(f(6), "Remove from wallet", "the image leaves this phone")}
     ${col(f(52), "Revoke the pass", "the serial answers revoked")}
     <rect x="${f(6)}" y="${f(25)}" width="${f(42)}" height="${f(14)}" rx="${f(2)}" fill="none" stroke="#CFC9BC" stroke-width="${f(0.3)}" stroke-dasharray="${f(1.2)} ${f(1)}"/>
     ${t(f(8), f(30.5), "nothing changes", f(2.5), { weight: 600 })}
     ${t(f(8), f(34.5), "on the server:", f(2.5), { weight: 600 })}
     ${t(f(8), f(38), "still active, still spendable", f(2.4), { colour: RED, weight: 600 })}
     <rect x="${f(52)}" y="${f(25)}" width="${f(42)}" height="${f(14)}" rx="${f(2)}" fill="none" stroke="#CFC9BC" stroke-width="${f(0.3)}"/>
     ${t(f(54), f(30.5), "the endpoint", f(2.5), { weight: 600 })}
     ${t(f(54), f(34.5), "answers revoked:", f(2.5), { weight: 600 })}
     ${t(f(54), f(38), "the next payment is refused", f(2.4), { colour: DEEP, weight: 600 })}
     ${t(f(6), f(46), "A stranger with an old screenshot is the case that matters: only revocation", f(2.3), { colour: MUTED })}
     ${t(f(6), f(50), "changes what the endpoint says, so that is the action the page offers —", f(2.3), { colour: MUTED })}
     ${t(f(6), f(54), "and the one the wallet does not.", f(2.3), { colour: MUTED })}`,
  );
}

/** Story 6 — **we cannot reach our own service**; the honest drawn sequence, not a screenshot. */
export function failClosedSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(58);
  const step = (i, label, detail, colour) => {
    const y = f(22 + i * 10);
    return `${t(f(8), y, `${i + 1}`, f(3.4), { colour: MUTED, weight: 700, w })}
      ${t(f(12), y, label, f(3.2), { weight: 600, w })}
      ${detail ? t(f(12), y + f(4), detail, f(2.6), { colour: MUTED, w }) : ""}
      ${i < 2 ? `<path d="M${f(9.5)} ${y + f(1.2)} L${f(9.5)} ${y + f(7)}" stroke="${colour}" stroke-width="${f(0.3)}"/>` : ""}`;
  };
  return frame(
    w,
    h,
    `${diagramBadge(w)}
     ${t(f(8), f(11), "Our service is down.", f(3.4), { weight: 700 })}
     ${t(f(8), f(16), "The payment still does not happen.", f(3.0), { colour: MUTED })}
     ${step(0, "the agent asks for a verdict", "gate.paystage.xyz does not answer", MUTED)}
     ${step(1, "the adapter refuses to sign", "“a gate you cannot reach is not an approval”", RED)}
     ${step(2, "no signature is produced", "nothing reaches the facilitator, nothing settles", DEEP)}
     ${t(f(8), f(52), "Fail closed, on purpose. Treating an unreachable gate as approval", f(2.5), { colour: MUTED })}
     ${t(f(8), f(56), "would turn every outage into an unguarded spending window.", f(2.5), { colour: MUTED })}`,
  );
}

/** Story 6 — **the human cancels the prompt**. Nothing is created, and the agent has nothing to spend. */
export function cancelledSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(44);
  return frame(
    w,
    h,
    `${diagramBadge(w)}
     ${t(f(8), f(13), "Face ID cancelled", f(4.6), { weight: 700, w })}
     ${t(f(8), f(20), "No mandate is issued, so there is no pass to spend and nothing to revoke.", f(3.1), { w })}
     ${t(f(8), f(26), "The agent learns why and stops; it cannot retry its way past a human who said no.", f(3.1), { w })}
     ${t(f(8), f(35), "The interesting case is not the cancellation — it is that the agent keeps asking.", f(2.8), { colour: MUTED, w })}
     ${t(f(8), f(39), "A refusal loop is a bug in the agent, and the pass is what makes it visible.", f(2.8), { colour: MUTED, w })}`,
  );
}

/** Story 6 — **a stale pass image against a live endpoint**: the reason the QR exists. */
export function staleVsRevokedSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(48);
  return frame(
    w,
    h,
    `${diagramBadge(w)}
     ${t(f(8), f(12), "The image says active. The endpoint says revoked.", f(3.8), { weight: 700, w })}
     <rect x="${f(8)}" y="${f(17)}" width="${f(38)}" height="${f(10)}" rx="${f(2)}" fill="${DEEP}"/>
     ${t(f(11), f(23), "screenshot: ACTIVE", f(3.0), { colour: "#FFFFFF", weight: 600, w })}
     <rect x="${f(54)}" y="${f(17)}" width="${f(38)}" height="${f(10)}" rx="${f(2)}" fill="none" stroke="${RED}" stroke-width="${f(0.35)}"/>
     ${t(f(57), f(23), "scan → revoked", f(3.0), { colour: RED, weight: 600, w })}
     ${t(f(8), f(33), "The QR is the authority, not the picture. Whoever is deciding reads the serial, not the card.", f(3.0), { w })}
     ${t(f(8), f(39), "This is also the reason a pass cannot be “verified” offline: an old image is a claim about the past.", f(2.8), { colour: MUTED, w })}
     ${t(f(8), f(45), "Today the endpoint answers “unknown” for every serial, because no store writes mandates yet.", f(2.8), { colour: MUTED, w })}`,
  );
}

/** Story 6 — **an unknown serial**: the stranger's answer, and what it must not be read as. */
export function unknownSerialSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(42);
  return frame(
    w,
    h,
    `${t(f(8), f(12), "unknown", f(5.6), { colour: RED, weight: 700, spacing: "0.02em", w })}
     ${t(f(8), f(19), "We hold no record of this serial.", f(3.2), { w })}
     ${t(f(8), f(25), "Not “valid”, not “invalid” — unknown, which is the honest answer for a serial nobody wrote.", f(3.0), { w })}
     ${t(f(8), f(33), "A seller should treat unknown as do-not-accept for now; that is the same instruction a refusal gets.", f(2.8), { colour: MUTED, w })}
     ${t(f(8), f(38), "The status code is 200 with a body, not 404: an unknown serial is a fact about the record, not a missing page.", f(2.8), { colour: MUTED, w })}`,
  );
}

/** Story 6 — **the free allowance runs out mid-job**, and the answer says which cap it was. */
export function limitExhaustedSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(44);
  return frame(
    w,
    h,
    `<rect x="${f(6)}" y="${f(6)}" width="${f(88)}" height="${f(10)}" rx="${f(2)}" fill="${MUTED}"/>
     ${t(f(10), f(13), "429 · free tier exhausted", f(4.2), { colour: "#FFFFFF", weight: 700, w })}
     ${t(f(6), f(22), "1,000 free calls per day per instance, and this caller used them all.", f(3.1), { w })}
     ${t(f(6), f(28), "The service is working — this is the daily limit, not an outage.", f(3.1), { w })}
     ${t(f(6), f(35), "Continue on the paid endpoint (0.002 USDC per call), or retry after the reset and the", f(2.9), { colour: MUTED, w })}
     ${t(f(6), f(39), "body tells you how many seconds that is. A caller must be able to tell “capped” from “broken”.", f(2.9), { colour: MUTED, w })}`,
  );
}

/** Story 6 — **the cap arrives mid-job**: the boring, common failure, drawn because nobody demos it. */
export function capMidJobSvg({ width = 750 } = {}) {
  const w = Number(width);
  const f = (n) => px(w, n);
  const h = f(46);
  const bar = (y, label, share, colour) =>
    `<rect x="${f(8)}" y="${y}" width="${f(84) * share}" height="${f(4)}" rx="${f(1)}" fill="${colour}"/>
     ${t(f(8), y - f(1.6), label, f(2.7), { colour: MUTED, weight: 600, spacing: "0.06em", w })}`;
  return frame(
    w,
    h,
    `${diagramBadge(w)}
     ${bar(f(16), "TODAY, BEFORE THE JOB", 0.35, DEEP)}
     ${bar(f(28), "THE SAME DAY, AFTER TWELVE CALLS", 0.98, GOLD)}
     ${t(f(8), f(38), "The thirteenth call is refused at the cap. The agent's task fails; the human's money does not.", f(3.0), { w })}
     ${t(f(8), f(43), "A cap that only stops the first payment is not a cap — this is the case the numbers exist for.", f(2.8), { colour: MUTED, w })}`,
  );
}

/* ---------------------------------------------------------------------------------------------------------------
 * Where a frame is rendered.
 *
 * The first version of this storyboard drew screens with no chrome, which made every frame look like it came from the
 * same place. It did not: a preset picker is Safari on an iPhone, the pass is the Wallet app, the biometric prompt is
 * an iOS system sheet owned by the OS, and provisioning is a hand-off between two apps. So every device frame below
 * declares its surface, draws that surface's chrome, and the page prints the surface and the transition beside it.
 * ------------------------------------------------------------------------------------------------------------ */

const PHONE = { w: 420, h: 780, radius: 44, inset: 10 };

/**
 * The Face ID glyph: four rounded corner brackets, two eyes, a nose and a smile.
 *
 * Drawn in a 0..100 space and scaled by `transform`, because computing absolute coordinates for a glyph this small is
 * how the first two attempts produced a "T" with a smile: the brackets and eyes were there, just outside the box.
 */
export function faceIdGlyph({ x, y, size, colour = INK }) {
  const scale = size / 100;
  return `<g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${colour}"
    stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M10 30 L10 18 Q10 10 18 10 L30 10"/>
    <path d="M70 10 L82 10 Q90 10 90 18 L90 30"/>
    <path d="M10 70 L10 82 Q10 90 18 90 L30 90"/>
    <path d="M70 90 L82 90 Q90 90 90 82 L90 70"/>
    <path d="M30 36 L42 36" stroke-width="8"/>
    <path d="M58 36 L70 36" stroke-width="8"/>
    <path d="M50 34 L50 58 L44 62" stroke-width="6.5"/>
    <path d="M34 74 Q50 86 66 74" stroke-width="6.5"/>
  </g>`;
}

/** A 9:41 iPhone status bar — the only chrome every surface shares. */
function statusBar(w, dark = false) {
  const fg = dark ? "#FFFFFF" : INK;
  return `<g>
    ${t(w * 0.09, w * 0.055, "9:41", w * 0.032, { colour: fg, weight: 600 })}
    <rect x="${w * 0.78}" y="${w * 0.032}" width="${w * 0.10}" height="${w * 0.018}" rx="${w * 0.005}" fill="${fg}" opacity="0.9"/>
    <rect x="${w * 0.90}" y="${w * 0.030}" width="${w * 0.045}" height="${w * 0.022}" rx="${w * 0.006}" fill="none" stroke="${fg}" stroke-width="${w * 0.004}" opacity="0.75"/>
  </g>`;
}

/** Safari's bottom URL bar, so a reader can see this is a web page and not the Wallet app. */
function safariBar(w, h, url) {
  const barH = w * 0.085;
  return `<g>
    <rect x="${w * 0.05}" y="${h - barH - w * 0.03}" width="${w * 0.90}" height="${barH}" rx="${barH / 2}" fill="#EDEAE3"/>
    ${t(w * 0.50, h - barH / 2 - w * 0.03 + w * 0.012, url, w * 0.026, { colour: MUTED, weight: 500, anchor: "middle" })}
  </g>`;
}

/**
 * A phone frame with the chrome of one surface.
 *
 *   "safari"  — a web page: status bar, URL bar, white content
 *   "sheet"   — an iOS system sheet: the page dimmed behind, the sheet on top (the OS draws this, not us)
 *   "wallet"  — the Wallet app: black, no browser chrome, the pass floating on it
 */
function deviceFrame({ surface, url = "paystage.xyz/grok-bot", content, w = PHONE.w, h = PHONE.h, caption }) {
  const dark = surface === "wallet";
  const bg = dark ? "#111214" : "#FFFFFF";
  const body = surface === "wallet" ? content : content;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" rx="${PHONE.radius}" fill="${dark ? "#000000" : "#FFFFFF"}"/>
  <clipPath id="screen"><rect x="${PHONE.inset}" y="${PHONE.inset}" width="${w - PHONE.inset * 2}" height="${h - PHONE.inset * 2}" rx="${PHONE.radius - 12}"/></clipPath>
  <g clip-path="url(#screen)">
    <rect x="${PHONE.inset}" y="${PHONE.inset}" width="${w - PHONE.inset * 2}" height="${h - PHONE.inset * 2}" fill="${bg}"/>
    ${body}
  </g>
  <rect x="${PHONE.inset}" y="${PHONE.inset}" width="${w - PHONE.inset * 2}" height="${h - PHONE.inset * 2}" rx="${PHONE.radius - 12}" fill="none" stroke="#00000022" stroke-width="1.5"/>
  ${statusBar(w, dark)}
  ${caption ? t(w * 0.06, h - w * 0.02, caption, w * 0.026, { colour: dark ? "#FFFFFF99" : MUTED }) : ""}
</svg>`.replace(/\$\{body\}/g, body);
}

/* ---- Story 1, the four frames that show the actual sequence ---------------------------------------------------- */

const presets = [
  ["Research", "up to $2.00 each · $20 a day", "reading · APIs", DEEP],
  ["Errands", "up to $0.50 each · $5 a day", "small buys", "#243447"],
  ["Build", "up to $1.00 each · $10 a day", "CI · packages", "#1D4B36"],
  ["Custom…", "set the numbers yourself", "blank form", "#4A2340"],
];

/**
 * The four story-1 frames are **phone screens**, so x and y use different scales: x is a share of the width, y a share
 * of the height. Mixing them is what made the first attempt draw a sheet across the middle of a 780-tall frame.
 */
const screenHelpers = (w, h) => ({
  x: (n) => Math.round(((n * w) / 100) * 100) / 100,
  y: (n) => Math.round(((n * h) / 100) * 100) / 100,
});

/**
 * A four-step strip at the top of each story-1 frame.
 *
 * Without it each screen is a separate picture and a reader has to remember where they are; with it the sequence is
 * legible before reading a word — which is the whole reason the storyboard exists.
 */
function stepStrip(X, Y, current) {
  const steps = ["Pick", "Configure", "Confirm", "Wallet"];
  return steps
    .map((label, i) => {
      const active = i === current;
      const done = i < current;
      const cx = X(9 + i * 24.5);
      const colour = active ? DEEP : done ? DEEP : "#B9B4A8";
      return `<g>
        <circle cx="${cx}" cy="${Y(7.2)}" r="${X(2.6)}" fill="${active ? DEEP : done ? DEEP : "none"}" stroke="${colour}" stroke-width="${X(0.5)}"/>
        ${t(cx, Y(8.4), `${i + 1}`, X(2.6), { colour: active || done ? "#FFFFFF" : "#8A8578", weight: 700, anchor: "middle" })}
        ${t(cx + X(4.4), Y(8.2), label, X(2.7), { colour: active ? INK : MUTED, weight: active ? 700 : 500 })}
      </g>`;
    })
    .join("");
}

/** 1a — Safari, choose the job. Nothing is configured yet: this screen is a starting point, not a decision. */
export function storyPickSvg({ width = PHONE.w, height = PHONE.h } = {}) {
  const { x: X, y: Y } = screenHelpers(width, height);
  const rows = presets
    .map(([title, line, tag, tint], i) => {
      const y = Y(21) + i * Y(9);
      return `<g>
        <rect x="${X(6)}" y="${y}" width="${X(88)}" height="${Y(7.6)}" rx="${X(2.4)}" fill="#FFFFFF" stroke="#E2DED6" stroke-width="1"/>
        <rect x="${X(9)}" y="${y + Y(1.4)}" width="${X(6)}" height="${Y(4.6)}" rx="${X(1.4)}" fill="${tint}"/>
        ${t(X(18), y + Y(3.2), title, X(4.4), { weight: 600 })}
        ${t(X(18), y + Y(5.9), line, X(2.8), { colour: MUTED })}
        ${t(X(90), y + Y(3.2), tag, X(2.5), { colour: MUTED, anchor: "end" })}
        ${t(X(90), y + Y(5.9), "›", X(4.0), { colour: MUTED, anchor: "end" })}
      </g>`;
    })
    .join("");
  return deviceFrame({
    surface: "safari",
    url: "paystage.xyz/new",
    w: width,
    h: height,
    content: `
      ${stepStrip(X, Y, 0)}
      ${t(X(6), Y(15), "Give a teammate a job", X(5.6), { weight: 700, spacing: "-0.01em" })}
      ${t(X(6), Y(18), "Pick the job. The numbers arrive filled in.", X(3.0), { colour: MUTED })}
      ${rows}
      ${t(X(6), Y(61), "Tap one to configure it. Nothing is issued on this screen.", X(2.7), { colour: MUTED })}
      ${safariBar(width, height, "paystage.xyz/new")}`,
  });
}

/** 1b — Safari, configure. The numbers are editable here, and this is where intent becomes concrete. */
export function storyConfigureSvg({ width = PHONE.w, height = PHONE.h } = {}) {
  const { x: X, y: Y } = screenHelpers(width, height);
  const field = (y, label, value, hint) => `
    ${t(X(6), y, label, X(2.6), { colour: MUTED, weight: 600, spacing: "0.08em" })}
    <rect x="${X(6)}" y="${y + Y(1.4)}" width="${X(88)}" height="${Y(6)}" rx="${X(1.6)}" fill="#FFFFFF" stroke="#E2DED6" stroke-width="1"/>
    ${t(X(8.5), y + Y(5.2), value, X(3.8), { weight: 600 })}
    ${hint ? t(X(8.5), y + Y(8.6), hint, X(2.5), { colour: MUTED }) : ""}`;
  return deviceFrame({
    surface: "safari",
    url: "paystage.xyz/new/research",
    w: width,
    h: height,
    content: `
      ${stepStrip(X, Y, 1)}
      ${t(X(6), Y(14), "Research", X(5.4), { weight: 700, spacing: "-0.01em" })}
      ${t(X(6), Y(17), "Sliders, not a blank form. Every one is editable.", X(2.9), { colour: MUTED })}
      ${field(Y(21), "PER PURCHASE", "$2.00")}
      ${field(Y(31), "PER DAY", "$20.00", "resets at 00:00 UTC")}
      ${field(Y(41), "EXPIRES", "31 January 2027")}
      ${field(Y(51), "PAYEES", "any payee the gate can check")}
      <rect x="${X(6)}" y="${Y(63)}" width="${X(88)}" height="${Y(6.5)}" rx="${X(2.2)}" fill="${DEEP}"/>
      ${t(X(50), Y(67.2), "Continue", X(4.2), { colour: "#FFFFFF", weight: 700, anchor: "middle" })}
      ${t(X(6), Y(73), "Next: read back what you are about to grant.", X(2.7), { colour: MUTED })}
      ${safariBar(width, height, "paystage.xyz/new/research")}`,
  });
}

/**
 * 1c — the **confirmation** step, then the system prompt.
 *
 * The order matters, and the first version of this storyboard got it wrong: a person does not pick one of four options
 * and have Face ID fire. They pick, configure, **read back what they are about to grant**, and only then does the OS
 * ask for a face. The sheet is the OS's; the page behind it is ours.
 */
export function storyConfirmSvg({ width = PHONE.w, height = PHONE.h } = {}) {
  const { x: X, y: Y } = screenHelpers(width, height);
  return deviceFrame({
    surface: "sheet",
    url: "paystage.xyz/new/research",
    w: width,
    h: height,
    content: `
      ${stepStrip(X, Y, 2)}
      ${t(X(6), Y(15), "Confirm the pass", X(5.0), { weight: 700, spacing: "-0.01em" })}
      ${t(X(6), Y(18.5), "Grok Bot may spend for you, within these numbers.", X(2.9), { colour: MUTED })}
      <rect x="${X(6)}" y="${Y(21)}" width="${X(88)}" height="${Y(19)}" rx="${X(2.4)}" fill="#FFFFFF" stroke="#E2DED6" stroke-width="1"/>
      ${t(X(9), Y(24), "PER PURCHASE", X(2.4), { colour: MUTED, weight: 600, spacing: "0.08em" })}
      ${t(X(9), Y(28), "$2.00", X(5.0), { weight: 700 })}
      ${t(X(9), Y(31.5), "PER DAY", X(2.4), { colour: MUTED, weight: 600, spacing: "0.08em" })}
      ${t(X(9), Y(35.5), "$20.00", X(5.0), { weight: 700 })}
      ${t(X(9), Y(39), "expires 31 Jan · revocable at any time · cannot tap to pay", X(2.5), { colour: MUTED })}
      <rect x="0" y="${Y(40)}" width="${width}" height="${Y(60)}" fill="#0A0A0A" opacity="0.32"/>
      <rect x="${X(3)}" y="${Y(46)}" width="${X(94)}" height="${Y(48)}" rx="${X(4.4)}" fill="#F7F5F0"/>
      ${faceIdGlyph({ x: X(42), y: Y(50), size: X(16) })}
      ${t(X(50), Y(72), "Confirm with Face ID", X(4.2), { weight: 600, anchor: "middle" })}
      ${t(X(50), Y(75.5), "the pass is issued only if this succeeds", X(2.8), { colour: MUTED, anchor: "middle" })}
      <rect x="${X(8)}" y="${Y(78.5)}" width="${X(84)}" height="${Y(0.25)}" fill="#DAD6CC"/>
      ${t(X(50), Y(83.5), "Cancel", X(3.6), { colour: DEEP, weight: 600, anchor: "middle" })}
      ${t(X(50), Y(90), "iOS draws this sheet. We choose when it appears.", X(2.5), { colour: MUTED, anchor: "middle" })}`,
  });
}

/** 1d — the hand-off: Safari asks Wallet to take the pass. This is the transition, drawn as a transition. */
export function storyProvisionSvg({ width = PHONE.w, height = PHONE.h } = {}) {
  const { x: X, y: Y } = screenHelpers(width, height);
  return deviceFrame({
    surface: "safari",
    url: "paystage.xyz/new/research",
    w: width,
    h: height,
    content: `
      ${stepStrip(X, Y, 3)}
      ${t(X(6), Y(15), "Adding to Apple Wallet", X(4.8), { weight: 700, spacing: "-0.01em" })}
      ${t(X(6), Y(18.5), "The pass is signed, then handed to the Wallet app.", X(2.9), { colour: MUTED })}
      <rect x="${X(10)}" y="${Y(22)}" width="${X(80)}" height="${Y(19)}" rx="${X(3.2)}" fill="${DEEP}"/>
      ${t(X(14), Y(27), "Grok Bot", X(4.6), { colour: "#FFFFFF", weight: 600 })}
      ${t(X(14), Y(30.5), "$2.00 each · $20.00 per 24h", X(2.7), { colour: "#FFFFFFB0" })}
      ${t(X(86), Y(27), "VOUCH", X(3.2), { colour: GOLD, weight: 700, anchor: "end", spacing: "0.12em" })}
      <rect x="${X(10)}" y="${Y(47)}" width="${X(80)}" height="${Y(7)}" rx="${X(2.2)}" fill="#000000"/>
      ${t(X(50), Y(51.6), "Add to Apple Wallet", X(3.8), { colour: "#FFFFFF", weight: 600, anchor: "middle" })}
      <rect x="${X(10)}" y="${Y(56)}" width="${X(80)}" height="${Y(7)}" rx="${X(2.2)}" fill="none" stroke="#CFC9BC" stroke-width="1"/>
      ${t(X(50), Y(60.6), "Not now", X(3.6), { colour: MUTED, weight: 600, anchor: "middle" })}
      ${t(X(6), Y(66), "Safari hands the pass to the Wallet app.", X(2.6), { colour: MUTED })}
      ${t(X(6), Y(69), "After this screen the page holds nothing; the wallet does.", X(2.6), { colour: MUTED })}
      ${safariBar(width, height, "paystage.xyz/new/research")}`,
  });
}

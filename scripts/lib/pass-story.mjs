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

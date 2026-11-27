import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { palette, posterTints } from "@/lib/tokens";
import brand from "../../../../../brand.json";
import { MARK, MARK_COLOURS } from "../../../../../scripts/lib/mark.mjs";

/**
 * `/brand` — the pack, for the SME (or its agent) that is going to fork this (#457).
 *
 * The operator's ask, in his words: it must say plainly that anyone can use the mark under MIT to make their own
 * version, customised for their own SME. So this page is a **recipe**, not a showroom: the licence, the six steps, the
 * exact commands, what you may change, what you must not, the minimum sizes, and the three tests.
 *
 * The pack is the page: every SVG below is served from `/brand/<name>.svg`, drawn by `scripts/lib/mark.mjs` and named by
 * `brand.json`. The zip is assembled at request time from the same two sources. Nothing is a hand-curated folder.
 */
export const metadata: Metadata = {
  title: "Brand",
  description:
    "Use this mark under MIT to make your own version, customised for your own business. Download the pack, the six steps, the commands, what you may change, what you may not, and where the mark must never appear.",
};

const VERSION = "2026-11-28";

const STEPS: { title: string; body: string; command?: string }[] = [
  {
    title: "1 · Fork the repository",
    body: "Everything you need is in the repo. The mark, the renderer and the checks all run offline.",
    command: "git clone https://github.com/base-buzz/paystage && cd paystage && npm install",
  },
  {
    title: "2 · Edit one file",
    body: "name, wordmark, tint, domain and mode live in brand.json and nowhere else. Change those five and the whole kit follows.",
  },
  {
    title: "3 · Render the assets",
    body: "One command runs the kit, the pass, the storyboard, the loop, both checks and the demo pass re-sign — it aborts at the first failure. It needs one TrueType font for the contact-sheet labels: Next&apos;s bundled Noto if the app workspaces are installed, otherwise any font via BRAND_FONT_DIR. Without one it stops and says so rather than drawing tofu boxes — that is the failure we would rather have.",
    command: "npm run brand:rebuild",
  },
  {
    title: "4 · Verify what came out",
    body: "The check asserts geometry, not just file names: 1.71 ±0.02, exactly four concave scallops and two mid notches counted from the source, the nine-path Lucide print at stroke 2, no amber, and every tier file at 142/89/64 plus the 29/58/87 tiles.",
    command: "npm run brand:verify",
  },
  {
    title: "5 · Point it at your deployment",
    body: "Your domain, your worker, your Apple certificate. mode \"apple\" refuses to build without one rather than emitting an unsigned pass.",
    command: "cd apps/vouchguard && npm install && npm run deploy:prod",
  },
  {
    title: "6 · Keep the offer",
    body: "The pass must still say what it is and what it cannot do: a document with a limit, not money, and it cannot tap to pay.",
  },
];

const MAY_CHANGE = [
  "the name and the wordmark",
  "the tint — the accent the site uses; it never enters the mark",
  "the domain and the worker name",
  "the Apple certificate, and whose account it belongs to",
  "the copy, as long as it stays plain and specific",
];

const MUST_NOT = [
  "the mark's geometry — 356 × 208, body inset 5, radius 28, four corner scallops at 0.085 H, two larger mid notches at 0.105 H",
  "the print — Lucide fingerprint-pattern, all nine paths, 24-grid, stroke 2, 58% of H; state is white active, red revoked, grey expired, paper knockout for one colour",
  "the three tiers — full ≥142 px, reduced 64–141 with a thickened print stroke, icon <64 px as the square teal tile",
  "the minimum sizes — lockup 90 px, horizontal lockup 110 px, full ticket 142 px, reduced 64 px",
  "the honesty lines — no custody, no tap to pay, not a payment card",
  "the claim that a seller can verify it without trusting the holder",
];

const SIZES = [
  { asset: "Vertical lockup", width: 90, floor: "90 px wide", below: "below that: the mark alone" },
  { asset: "Horizontal lockup", width: 110, floor: "110 px wide", below: "below that: the mark alone" },
  { asset: "Full ticket", width: 142, floor: "142 px wide", below: "below that: the reduced drawing" },
  { asset: "Reduced ticket", width: 64, floor: "64 px wide", below: "below that: the square tile" },
  { asset: "Icon tile", width: 29, floor: "29 px", below: "PassKit / favicon; the print still reads" },
];

const TESTS = [
  "Three-second test on the pass: a stranger says \"permits payment\", names the limit, names the teammate.",
  "29 px test: the tile reads as a mark — not a letter (V, B, O, 8) and not a smudge.",
  "One-colour test: printed black on white, the ticket still reads and the print is a knockout.",
];

const PACK_FILES = [
  "svg/mark.svg · svg/mark-revoked.svg · svg/mark-expired.svg",
  "svg/mark-mono.svg · svg/mark-icon.svg",
  "svg/lockup-vertical.svg · svg/lockup-horizontal.svg",
  "png/ — the 240/142/89/64 tickets, the 29/58/87 tiles, the revoked and expired proofs",
  "brand.json · README.txt · VERSION",
  "LICENCE (MIT) · LICENCE-LUCIDE (ISC)",
];

const CLEAR_SPACE_SHARE = 0.25;
const CLEAR = MARK.width * CLEAR_SPACE_SHARE;

/** WCAG 2.x relative luminance. Computed on this page so a table of ratios cannot be copied stale. */
function luminance(hex: string): number {
  const raw = hex.replace("#", "");
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(raw.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (hi + 0.05) / (lo + 0.05);
}

const fmt = (value: number) => `${value.toFixed(2)}:1`;
const TEAL = MARK_COLOURS.body;
const PAPER = MARK_COLOURS.paper;
const INK = MARK_COLOURS.ink;
const DEEP = palette.deep;
const TINT = brand.tint;
const GOLD = palette.gold;
const WORST_TINT = posterTints.reduce((worst, tint) =>
  contrast(PAPER, tint) < contrast(PAPER, worst) ? tint : worst,
);

const BACKGROUNDS = [
  {
    name: "Paper",
    hex: PAPER,
    drawing: "full-colour ticket",
    pair: `white print on teal (${TEAL})`,
    ratio: contrast(PAPER, TEAL),
    use: "default on white; the pack's paper proof",
  },
  {
    name: "Deep",
    hex: DEEP,
    drawing: "dark inverse — paper body, ink print",
    pair: `paper body on deep (${DEEP})`,
    ratio: contrast(PAPER, DEEP),
    use: "dark headers and footers only",
  },
  {
    name: "Teammate tint",
    hex: WORST_TINT,
    drawing: "dark inverse — paper body, ink print",
    pair: `paper body on the worst tint (${WORST_TINT})`,
    ratio: contrast(PAPER, WORST_TINT),
    use: "the per-teammate accent surface",
  },
  {
    name: "One-colour",
    hex: INK,
    drawing: "mono ticket — ink body, paper print",
    pair: `ink body on paper (${PAPER})`,
    ratio: contrast(INK, PAPER),
    use: "print, invoice, stamp",
  },
];

const COLOURS = [
  { token: "teal", hex: TEAL, use: "the ticket body; never the state" },
  { token: "paper", hex: PAPER, use: "active print, the page, the paper proof" },
  { token: "revoked", hex: MARK_COLOURS.print.revoked, use: "revoked print only" },
  { token: "expired", hex: MARK_COLOURS.print.expired, use: "expired print only" },
  { token: "tint", hex: TINT, use: "brand.json's site accent; never inside the mark" },
];

function Figure({ src, alt, caption, width, height }: { src: string; alt: string; caption: string; width: number; height: number }) {
  return (
    <figure className="rounded-lg border border-ink/10 bg-paper p-3">
      {/* eslint-disable-next-line @next/next/no-img-element -- the bytes come from our own SVG route, not next/image */}
      <img src={src} alt={alt} width={width} height={height} className="mx-auto h-auto max-w-full" />
      <figcaption className="mt-2 text-center text-xs text-ink/60">{caption}</figcaption>
    </figure>
  );
}

export default function BrandPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <Badge variant="secondary">MIT</Badge>
      <h1 className="mt-4 text-4xl font-bold tracking-tight text-ink">Use this brand for your own business</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink/80">
        The mark, the lockups, the pass artwork and the code that generates them are <strong>MIT licensed</strong>. Take
        them, change the name and the colour, and hand your own team a pass that carries your limits. You do not need to
        ask us, and you do not owe us a credit — though a link is always welcome.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink/60">
        This page is also written for your agent: the same instructions live in{" "}
        <code className="rounded bg-ink/5 px-1 py-0.5">brand/AGENTS.md</code>, and every command below runs verbatim from
        a fresh clone. <span className="font-medium text-ink">Version — {VERSION}</span>. The mark changed five times in
        one night; this string is the spec this pack follows.
      </p>

      {/* 1 · downloads and pictures ---------------------------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Download the pack</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          One zip, assembled when you ask for it from the same module this page renders from (
          <code className="rounded bg-ink/5 px-1 py-0.5">scripts/lib/mark.mjs</code>) and this repo&apos;s{" "}
          <code className="rounded bg-ink/5 px-1 py-0.5">brand.json</code>. It is not a folder somebody zipped by hand,
          and its README repeats the version above.
        </p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <a
            href="/brand/vg-brand-pack.zip"
            download
            className="inline-flex items-center rounded-md bg-deep px-4 py-2 text-sm font-semibold text-paper hover:bg-deep/90"
          >
            Download vg-brand-pack.zip
          </a>
          <span className="text-xs text-ink/60">Version {VERSION} · MIT, except the print (ISC)</span>
        </div>

        <div className="mt-4 grid gap-x-6 gap-y-1 text-sm text-ink/80 sm:grid-cols-2">
          {PACK_FILES.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>

        <h3 className="mt-6 text-base font-semibold text-ink">The masters, individually</h3>
        <p className="mt-1 text-sm text-ink/60">
          Prefer one file to the zip? Each master is a route, not a copy:{" "}
          <a href="/brand/mark.svg" className="text-deep hover:underline">mark.svg</a>,{" "}
          <a href="/brand/lockup-vertical.svg" className="text-deep hover:underline">lockup-vertical.svg</a>,{" "}
          <a href="/brand/lockup-horizontal.svg" className="text-deep hover:underline">lockup-horizontal.svg</a>,{" "}
          <a href="/brand/mark-mono.svg" className="text-deep hover:underline">mark-mono.svg</a>.
        </p>

        <h3 className="mt-8 text-base font-semibold text-ink">The mark and its print states</h3>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Figure src="/brand/mark.svg" width={356} height={208} alt="The ticket mark: a teal cinema ticket with four concave corner scallops, two mid-edge notches and the white Lucide fingerprint print." caption="Active · white print" />
          <Figure src="/brand/mark-revoked.svg" width={356} height={208} alt="The same ticket with the fingerprint print in red, meaning revoked." caption="Revoked · #B42318" />
          <Figure src="/brand/mark-expired.svg" width={356} height={208} alt="The same ticket with the fingerprint print in grey, meaning expired." caption="Expired · #8A8F98" />
          <Figure src="/brand/mark-mono.svg" width={356} height={208} alt="The one-colour ticket: ink body with a paper-white fingerprint knockout." caption="One-colour · ink on paper" />
        </div>

        <h3 className="mt-8 text-base font-semibold text-ink">Both lockups</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Figure src="/brand/lockup-vertical.svg" width={900} height={589} alt={`The ${brand.name} vertical lockup: ticket above, wordmark beneath, the wordmark exactly as wide as the ticket.`} caption="Vertical lockup" />
          <Figure src="/brand/lockup-horizontal.svg" width={1200} height={286} alt={`The ${brand.name} horizontal lockup: ticket left, wordmark right, gap half the ticket's width.`} caption="Horizontal lockup" />
        </div>
      </section>

      {/* 2 · where the mark may not appear --------------------------------------------------------------------------- */}
      <section className="mt-12 rounded-lg border-2 border-red/40 bg-red/[0.04] p-5">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Where the mark may not appear</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/75">
          This is the rule that matters most, because it is the one a fork breaks without noticing. The mark is a record
          of authority, not a payment method.
        </p>
        <ul className="mt-3 space-y-1.5 text-sm leading-relaxed text-ink/80">
          <li>· Never beside Visa, Mastercard or Apple Pay — no payment-scheme mark in the same frame.</li>
          <li>· Never in a &ldquo;pay with&rdquo; row, checklist or button.</li>
          <li>· Never on a checkout button, price tag or &ldquo;buy&rdquo; control.</li>
          <li>· Never on a terminal decal, card reader or card-art mockup.</li>
          <li>· Never inside a payment-scheme lockup, or as the issuer mark on a card.</li>
        </ul>
        <p className="mt-3 text-sm leading-relaxed text-ink/75">
          Beside a card brand the mark reads as &ldquo;accepted here&rdquo; — the exact confusion the product exists to
          prevent. It may appear on the pass face, on documentation that explains the limits, and on the seller&apos;s
          verification screen, always with the honesty line: not a card, holds no money, cannot tap to pay.
        </p>
      </section>

      {/* 3 · clear space --------------------------------------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Clear space</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          Keep <strong>25% of the mark&apos;s width</strong> free on every side. Nothing enters it: no text, no border,
          no edge crop, no other logo. At the master width of {MARK.width} px that is {CLEAR} px on each side.
        </p>
        <div className="mt-4 rounded-lg border border-ink/10 bg-ink/[0.02] p-4">
          <svg
            viewBox={`0 0 ${MARK.width + CLEAR * 2} ${MARK.height + CLEAR * 2}`}
            role="img"
            aria-label={`Clear-space diagram: the ${MARK.width} by ${MARK.height} ticket sits inside a box with ${CLEAR} pixels of empty space on each side.`}
            className="mx-auto w-full max-w-md"
          >
            <rect
              x={1}
              y={1}
              width={MARK.width + CLEAR * 2 - 2}
              height={MARK.height + CLEAR * 2 - 2}
              fill="none"
              stroke="#8A8F98"
              strokeDasharray="8 6"
              strokeWidth={2}
            />
            <rect
              x={CLEAR}
              y={CLEAR}
              width={MARK.width}
              height={MARK.height}
              fill="none"
              stroke="#1A5F7A"
              strokeWidth={2}
            />
            <image href="/brand/mark.svg" x={CLEAR} y={CLEAR} width={MARK.width} height={MARK.height} />
            <text x={CLEAR + MARK.width / 2} y={CLEAR / 2 + 6} textAnchor="middle" fontSize={16} fill="#101322" fontFamily="sans-serif">
              clear space = 0.25 W ({CLEAR} px each side)
            </text>
          </svg>
        </div>
      </section>

      {/* 4 · minimum sizes ------------------------------------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Minimum sizes</h2>
        <p className="mt-2 text-sm text-ink/70">
          No exceptions and no second drawing — below these floors you use the mark alone or you do not show state. The
          clear-space column is 25% of that asset&apos;s floor width on every side.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2">Asset</th>
              <th className="py-2">Floor</th>
              <th className="py-2">Clear space</th>
              <th className="py-2">Below it</th>
            </tr>
          </thead>
          <tbody>
            {SIZES.map(({ asset, width, floor, below }) => (
              <tr key={asset} className="border-b border-ink/5">
                <td className="py-2 text-ink">{asset}</td>
                <td className="py-2 text-ink/80">{floor}</td>
                <td className="py-2 text-ink/70">{Number((width * CLEAR_SPACE_SHARE).toFixed(2))} px</td>
                <td className="py-2 text-ink/60">{below}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* 5 · background matrix --------------------------------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Background matrix</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          Ratios computed from the tokens on this page, not copied. Choose the drawing by the surface, not by mood.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2">Background</th>
              <th className="py-2">Drawing</th>
              <th className="py-2">Measured pair</th>
              <th className="py-2">Ratio</th>
              <th className="py-2">Use</th>
            </tr>
          </thead>
          <tbody>
            {BACKGROUNDS.map((row) => (
              <tr key={row.name} className="border-b border-ink/5">
                <td className="py-2 text-ink">
                  {row.name} <code className="text-xs text-ink/60">{row.hex}</code>
                </td>
                <td className="py-2 text-ink/80">{row.drawing}</td>
                <td className="py-2 text-ink/70">{row.pair}</td>
                <td className="py-2 font-semibold text-ink">{fmt(row.ratio)}</td>
                <td className="py-2 text-ink/60">{row.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 text-xs leading-relaxed text-ink/60">
          The ticket&apos;s own pair — white print on the {TEAL} body — is {fmt(contrast(PAPER, TEAL))}. Amber{" "}
          {GOLD} on teal is {fmt(contrast(GOLD, TEAL))} (the darker amber #D4A843 is {fmt(contrast("#D4A843", TEAL))}):
          both are below the 4.5:1 text floor, so amber is <strong>graphics only, never text</strong>. The dark inverse
          (paper body, ink print) is for deep and teammate-tint surfaces only; it never goes to print — in the
          one-colour master the ticket is the ink and the print is the knockout.
        </p>
      </section>

      {/* 6 · colour tokens ------------------------------------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Colour tokens</h2>
        <p className="mt-2 text-sm text-ink/70">
          Copy these exactly. The tint arrives from <code className="rounded bg-ink/5 px-1 py-0.5">brand.json</code>; the
          other four are the mark&apos;s own and do not follow a theme.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2">Token</th>
              <th className="py-2">Hex</th>
              <th className="py-2">Use</th>
            </tr>
          </thead>
          <tbody>
            {COLOURS.map((row) => (
              <tr key={row.token} className="border-b border-ink/5">
                <td className="py-2 text-ink">{row.token}</td>
                <td className="py-2">
                  <code className="select-all rounded bg-ink/5 px-1.5 py-0.5 font-mono text-ink">{row.hex}</code>
                </td>
                <td className="py-2 text-ink/70">{row.use}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Six steps</h2>
        <ol className="mt-6 space-y-5">
          {STEPS.map((step) => (
            <li key={step.title}>
              <h3 className="text-base font-semibold text-ink">{step.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-ink/70">{step.body}</p>
              {step.command ? (
                <pre className="mt-2 overflow-x-auto rounded-md border border-ink/10 bg-ink/[0.03] px-3 py-2 text-xs text-ink">
                  <code>{step.command}</code>
                </pre>
              ) : null}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">brand.json — the whole surface</h2>
        <p className="mt-2 text-sm text-ink/70">
          Six branding values and two read settings, one file. Nothing else in the code names your brand.
        </p>
        <pre className="mt-4 overflow-x-auto rounded-md border border-ink/10 bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-ink">
          <code>{JSON.stringify(brand, null, 2)}</code>
        </pre>
      </section>

      <div className="mt-12 grid gap-4 sm:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You may change</CardTitle>
            <CardDescription>These are yours.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-ink/80">
              {MAY_CHANGE.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">You must not change</CardTitle>
            <CardDescription>These are what make it the same product.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-1.5 text-sm text-ink/80">
              {MUST_NOT.map((item) => (
                <li key={item}>· {item}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">The three tests</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink/80">
          {TESTS.map((test) => (
            <li key={test}>· {test}</li>
          ))}
        </ul>
      </section>

      {/* 7 · licence and version — the two omissions ---------------------------------------------------------------- */}
      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">Licence and version</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/80">
          Everything in the pack — the ticket, both lockups, the state masters, the tile and the code that renders them —
          is <strong>MIT</strong>. Fork it, rename it, and ship your version. The full text travels in{" "}
          <code className="rounded bg-ink/5 px-1 py-0.5">LICENCE</code>.
        </p>
        <div className="mt-4 rounded-lg border border-ink/20 bg-ink/[0.03] p-4">
          <p className="text-sm font-semibold text-ink">The print is not MIT — it is Lucide, ISC.</p>
          <p className="mt-1 text-sm leading-relaxed text-ink/75">
            The nine-path print is Lucide&apos;s <code className="rounded bg-ink/5 px-1 py-0.5">fingerprint-pattern</code>{" "}
            craft under the <strong>ISC licence</strong>. That is a separate notice, not a footnote, and it travels in{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5">LICENCE-LUCIDE</code>. The ticket is ours; the print is
            Lucide&apos;s. A borrowed shape cannot be our trademark.
          </p>
        </div>
        <p className="mt-4 text-sm leading-relaxed text-ink/80">
          <strong>Version — {VERSION}.</strong> The mark changed five times in one night. This page, the zip&apos;s{" "}
          <code className="rounded bg-ink/5 px-1 py-0.5">README.txt</code> and its{" "}
          <code className="rounded bg-ink/5 px-1 py-0.5">VERSION</code> all carry the same date, so a fork can tell
          which spec it got.
        </p>
      </section>

      <section className="mt-12 rounded-lg border border-ink/10 p-5">
        <h2 className="text-lg font-semibold text-ink">What we are not offering</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          This is a brand and a codebase, not a franchise. There is no certification, no partner programme and no
          approval step — and no licence fee. If you change the name, it is your brand; if you break the honesty lines,
          it is your reputation, not ours. The one thing we ask is that a pass made with this pack still says what it
          cannot do.
        </p>
      </section>

      <p className="mt-10 text-sm text-ink/60">
        Need the technical side instead? <Link href="/docs" className="text-deep hover:underline">Read the docs</Link>.
      </p>
    </main>
  );
}

import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import brand from "../../../../../brand.json";

/**
 * `/brand` — the pack, for the SME (or its agent) that is going to fork this (#457).
 *
 * The operator's ask, in his words: it must say plainly that anyone can use the mark under MIT to make their own
 * version, customised for their own SME. So this page is a **recipe**, not a showroom: the licence, the six steps, the
 * exact commands, what you may change, what you must not, the minimum sizes, and the three tests.
 *
 * Everything on it is checked against `brand/BRAND.md` and `brand/AGENTS.md` rather than retyped here — a pack that
 * disagrees with its own spec is worse than no pack.
 */
export const metadata: Metadata = {
  title: "Brand",
  description:
    "Use this mark under MIT to make your own version, customised for your own business. The six steps, the commands, what you may change, and what you may not.",
};

const STEPS: { title: string; body: string; command?: string }[] = [
  {
    title: "1 · Fork the repository",
    body: "Everything you need is in the repo. The mark, the renderer and the checks all run offline.",
    command: "git clone https://github.com/base-buzz/paystage && cd paystage && npm install",
  },
  {
    title: "2 · Edit one file",
    body: "name, wordmark, tint, domain and mode live in brand.json and nowhere else. Change those five and the whole kit follows.",
    command: "open brand.json",
  },
  {
    title: "3 · Render the assets",
    body: "The mark, lockups, favicons, the pass face and the social card are generated from the mark's geometry, not drawn by hand.",
    command: "npm run brand:render",
  },
  {
    title: "4 · Verify what came out",
    body: "The check asserts geometry, not just file names: two plates, the 38.7% overlap, a lens that survives 29 px, and no zero-byte asset.",
    command: "npm run brand:verify",
  },
  {
    title: "5 · Point it at your deployment",
    body: "Your domain, your worker, your Apple certificate. mode \"apple\" refuses to build without one rather than emitting an unsigned pass.",
    command: "npm run deploy:prod",
  },
  {
    title: "6 · Keep the offer",
    body: "The pass must still say what it is and what it cannot do: a document with a limit, not money, and it cannot tap to pay.",
  },
];

const MAY_CHANGE = [
  "the name and the wordmark",
  "the tint — one accent, used for the lens",
  "the domain and the worker name",
  "the Apple certificate, and whose account it belongs to",
  "the copy, as long as it stays plain and specific",
];

const MUST_NOT = [
  "the mark's geometry — two plates, 62 × 62, radius 15, overlap 24 units (38.7%)",
  "the lens as the only accent — gold active, red revoked, grey expired, paper knockout for one colour",
  "the minimum sizes — lockup 90 px, horizontal lockup 110 px, mark 16 px, lens ≥ 3 px",
  "the honesty lines — no custody, no tap to pay, not a payment card",
  "the claim that a seller can verify it without trusting the holder",
];

const SIZES = [
  ["Vertical lockup", "90 px wide", "below that: the mark alone"],
  ["Horizontal lockup", "110 px wide", "below that: the mark alone"],
  ["The mark", "16 px", "there is no simplified version"],
  ["The lens (state)", "3 px", "below that: do not show state"],
];

const TESTS = [
  "Three-second test on the pass: a stranger says \"permits payment\", names the limit, names the teammate.",
  "29 px test: the mark reads as a mark — not a letter (V, B, O, 8) and not a smudge.",
  "One-colour test: printed black on white, the plates still separate and the lens still reads.",
];

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
        a fresh clone.
      </p>

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
        <p className="mt-2 text-sm text-ink/70">Six values, one file. Nothing else in the code names your brand.</p>
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
        <h2 className="text-2xl font-bold tracking-tight text-ink">Minimum sizes</h2>
        <p className="mt-2 text-sm text-ink/70">
          No exceptions and no second drawing — below these floors you use the mark alone or you do not show state.
        </p>
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs uppercase tracking-wider text-muted">
              <th className="py-2">Asset</th>
              <th className="py-2">Floor</th>
              <th className="py-2">Below it</th>
            </tr>
          </thead>
          <tbody>
            {SIZES.map(([asset, floor, below]) => (
              <tr key={asset} className="border-b border-ink/5">
                <td className="py-2 text-ink">{asset}</td>
                <td className="py-2 text-ink/80">{floor}</td>
                <td className="py-2 text-ink/60">{below}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">The three tests</h2>
        <ul className="mt-3 space-y-2 text-sm leading-relaxed text-ink/80">
          {TESTS.map((test) => (
            <li key={test}>· {test}</li>
          ))}
        </ul>
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

import type { Metadata } from "next";
import Link from "next/link";

import "../landing.css";

export const metadata: Metadata = {
  title: "Docs",
  description:
    "Evaluator in one call, hosted endpoint, receipts that verify offline — and the exact names, because a quickstart with a wrong tool name is not a quickstart.",
};

/**
 * `/docs` (#478) — the page the "quickstart" in our copy pointed at, which answered 404.
 *
 * Written to be *run*, not read: every command here is one we execute ourselves, and each block names the exact package and
 * tool rather than describing them. The three sections are the three things an integrator does in order — evaluate, call the
 * hosted endpoint, verify a receipt — and each ends with what it does **not** do, because that is the part a quickstart
 * usually leaves out and the part that causes support tickets.
 */
export default function DocsPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-4xl font-bold tracking-tight text-ink">Docs</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink/80">
        Three things, in the order you do them: evaluate a payment before signing, call the hosted endpoint if you would rather
        not run anything, and verify a receipt afterwards.
      </p>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">1 · Evaluate before signing</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          The evaluator runs locally. It reads your policy, answers <code>pay</code>, <code>review</code> or{" "}
          <code>do_not_pay</code>, and returns the rule that fired.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-ink/10 bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-ink">
          <code>{`npx -y @paystage/mcp
# then call the tool evaluate_mcp_payment with:
#   { payment_required: {...}, policy: {...} }`}</code>
        </pre>
        <p className="mt-2 text-xs text-ink/50">
          Not in this section: it does not sign, send, or hold a key. A verdict is advice to the thing that signs.
        </p>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-ink">2 · The hosted endpoint</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          The same rules, the same verdicts, charged per call over x402 at 0.002 USDC. A GET-only client sees fewer endpoints
          than exist, so use POST:
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-ink/10 bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-ink">
          <code>{`curl -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \\
  -H 'content-type: application/json' \\
  -d '{"payment_required":{...},"policy":{...}}'
# 402 = pay, retry with the signed authorization
# 200 = the verdict, with the rule that fired`}</code>
        </pre>
        <p className="mt-2 text-xs text-ink/50">
          Not in this section: an uptime promise. It is one Worker; <Link href="/pricing" className="text-deep hover:underline">the pricing page</Link>{" "}
          says so.
        </p>
      </section>

      <section className="mt-12" id="verify">
        <h2 className="text-2xl font-bold tracking-tight text-ink">
          3 · Verify a receipt, and know who verified the payment
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-ink/70">
          Every 402 challenge we emit carries the same statement in{" "}
          <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">accepts[].extra.verifier</code>, so a buyer reads it
          before signing — not after settlement.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-relaxed text-ink/70">
          <li>
            <strong className="text-ink">Who verifies:</strong> PayStage, the service at{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">api.paystage.xyz</code>.
          </li>
          <li>
            <strong className="text-ink">By what key:</strong> the published receipt key set at{" "}
            <a
              href="https://api.paystage.xyz/.well-known/paystage-receipt-key.json"
              className="text-deep hover:underline"
            >
              https://api.paystage.xyz/.well-known/paystage-receipt-key.json
            </a>
            . Each receipt names its <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">kid</code>, so rotating the
            key does not invalidate earlier receipts.
          </li>
          <li>
            <strong className="text-ink">Under what terms:</strong>{" "}
            <a href="https://paystage.xyz/docs#verify" className="text-deep hover:underline">
              https://paystage.xyz/docs#verify
            </a>{" "}
            — this page, and the same wording in that challenge field, are the terms.
          </li>
          <li>
            <strong className="text-ink">Where the result can be re-checked:</strong> the public run bundle at{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">https://api.paystage.xyz/runs/&#123;id&#125;</code>,
            and its signed receipt at{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">
              https://api.paystage.xyz/runs/&#123;id&#125;?format=receipt
            </code>
            . The <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">PAYMENT-RESPONSE</code> settlement header
            carries <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">success</code>,{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">transaction</code> (the payment&rsquo;s on-chain
            hash) and <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">network</code>.
          </li>
        </ul>
        <p className="mt-4 text-sm leading-relaxed text-ink/70">
          Verification covers <strong className="text-ink">authority, not delivery or quality</strong>: the gate checks
          that the payment was authorised by the payer for this payee, asset and amount until a deadline; it does not
          check that what was bought was any good. A receipt proves what was decided, over which inputs, by which key —
          not that the decision was right.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-ink/70">
          One real receipt you can check offline. It was captured from the live service on 2026-11-20, and the key
          beside it is the public half that signed it. The receipt expired five minutes after issue, so the command
          exits 5 — signature valid, but past its own expiry. That distinction is the point.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-md border border-ink/10 bg-ink/[0.03] px-4 py-3 text-xs leading-relaxed text-ink">
          <code>{`curl -sS https://api.paystage.xyz/v1/public/example-receipt.json -o receipt.json
curl -sS https://api.paystage.xyz/v1/public/example-key.json -o key.json
npx -y -p @paystage/mcp paystage-verify receipt.json --key key.json
# 0 valid · 1 invalid · 2 unsigned · 3 unverifiable · 5 expired`}</code>
        </pre>
        <p className="mt-2 text-xs text-ink/50">
          The verifier reads both files and makes no network request. Exit 3 is distinct from exit 1 on purpose:{" "}
          <em>&ldquo;could not check&rdquo;</em> is not <em>&ldquo;forged&rdquo;</em>, and a tool that conflates them is
          worse than no tool.
        </p>
      </section>

      <section className="mt-12 space-y-2 text-sm leading-relaxed text-ink/80">
        <h2 className="text-lg font-semibold text-ink">Where to go next</h2>
        <p>
          · <Link href="/glossary" className="text-deep hover:underline">Glossary</Link> — the AP2 vocabulary we borrow, with
          attribution.
        </p>
        <p>
          · <Link href="/try" className="text-deep hover:underline">Try it</Link> — one call in the browser.
        </p>
        <p>
          · <a href="https://github.com/base-buzz/paystage" className="text-deep hover:underline">The repository</a> — MIT,
          and the only place the source of truth lives.
        </p>
      </section>
    </main>
  );
}

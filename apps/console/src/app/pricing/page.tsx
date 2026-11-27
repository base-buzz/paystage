import type { Metadata } from "next";
import Link from "next/link";

import "../landing.css";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "The packages are free and MIT. The hosted evaluation costs 0.002 USDC per call, charged over x402 — and there is a self-hosted path that costs nothing.",
};

/**
 * `/pricing` for the engine (#477).
 *
 * The price was in the JSON-LD and in `docs/`, and on no page a person reads. Two rules:
 *
 *  1. **state the number** — 0.002 USDC per hosted evaluation — rather than "contact us", because a price a reader has to
 *     ask for is a price they assume is worse than it is;
 *  2. **say what is free beside it**, because most integrators should self-host and the honest answer is that the hosted
 *     endpoint exists for people who would rather not run anything.
 */
export default function PricingPage() {
  return (
    <main className="mx-auto max-w-3xl px-5 py-16">
      <h1 className="text-4xl font-bold tracking-tight text-ink">Pricing</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink/80">
        The packages are free and MIT. The hosted evaluation is a fraction of a cent, because it does almost nothing: it reads
        a policy and answers.
      </p>

      <div className="mt-10 grid gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-ink/10 p-5">
          <h2 className="text-base font-semibold text-ink">Self-hosted — free</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/70">
            Every package is MIT. Install{" "}
            <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">@paystage/mcp</code> or call the evaluator directly, and
            nothing leaves your machine.
          </p>
          <p className="mt-2 text-sm text-ink/50">No account, no key, no network.</p>
        </div>
        <div className="rounded-lg border border-ink/10 bg-ink/[0.02] p-5">
          <h2 className="text-base font-semibold text-ink">Hosted — 0.002 USDC per evaluation</h2>
          <p className="mt-2 text-sm leading-relaxed text-ink/70">
            Charged over x402 per call, settled on Base. Convenience, not a different answer: the same rules, the same
            verdicts.
          </p>
          <p className="mt-2 text-sm text-ink/50">0.002 USDC at $1 ≈ $0.002. Ten thousand calls ≈ $20.</p>
        </div>
      </div>

      <section className="mt-10 space-y-3 text-sm leading-relaxed text-ink/80">
        <h2 className="text-lg font-semibold text-ink">What this is not</h2>
        <p>
          Not a subscription, not per seat, and there is no plan to upgrade to. There is also no service level on the hosted
          endpoint: it is one Worker, and its limits are documented rather than promised.
        </p>
        <h2 className="mt-6 text-lg font-semibold text-ink">If a price changes</h2>
        <p>
          This page and <code className="rounded bg-ink/5 px-1 py-0.5 text-xs">/.well-known/paystage.json</code> carry the
          number, and the manifest is what machines read. A price that changes in one and not the other is a bug, not a
          negotiation.
        </p>
      </section>

      <p className="mt-10 text-sm text-ink/60">
        The SM E-facing side is free while it is in build — see{" "}
        <a href="https://vouchguard.app/pricing" className="text-deep hover:underline">
          vouchguard.app/pricing
        </a>
        .
      </p>
    </main>
  );
}

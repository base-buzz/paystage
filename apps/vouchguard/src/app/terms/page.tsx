import type { Metadata } from "next";

import { brand } from "@/lib/brand-config";

export const metadata: Metadata = {
  title: "Terms",
  description: `What ${brand.name} is, and what it deliberately is not.`,
};

/**
 * `/terms` (#475) — short on purpose. The useful part of a terms page for this product is the list of things it does not
 * do, because those are the assumptions a buyer would otherwise make: that it holds money, that it is a payment
 * instrument, that it stops fraud.
 */
export default function TermsPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Terms</h1>
      <p className="mt-3 text-sm text-ink/60">
        Plain sentences, because the software is small and the assumptions are what need stating.
      </p>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-ink/80">
        <h2 className="text-lg font-semibold text-ink">What this is</h2>
        <p>
          A record of authority: a pass that says who may spend, up to how much, until when, and whether it has been revoked.
          A seller can check it without an account and without trusting the person holding it.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-ink">What it is not</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Not a payment card.</strong> It cannot tap to pay and it is not accepted at a terminal.</li>
          <li><strong>Not custody.</strong> No money is held, moved or routed by this service.</li>
          <li><strong>Not fraud protection.</strong> It limits what an agent may do inside a policy; it does not detect a
            dishonest seller, a stolen pass or a compromised agent.</li>
          <li><strong>Not advice.</strong> Nothing here is financial, legal or tax advice.</li>
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-ink">Software licence</h2>
        <p>
          The software is MIT and the brand kit is MIT with one exception: the fingerprint print in the mark is Lucide, which
          is ISC, and its notice travels with it. See{" "}
          <a href="/brand" className="text-deep hover:underline">the brand page</a> for the full pack and the rules that come
          with it.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-ink">No warranty</h2>
        <p>
          Provided as is, without warranty of any kind. This is a reference instance running in <strong>{brand.mode}</strong>{" "}
          mode: useful for judging the thing, not a service level.
        </p>
      </section>
    </main>
  );
}

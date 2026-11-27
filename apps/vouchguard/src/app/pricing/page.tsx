import type { Metadata } from "next";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { brand } from "@/lib/brand-config";

export const metadata: Metadata = {
  title: "Pricing",
  description: `${brand.name} is free while it is in build. No card, no sales call, and the limits are written here rather than in a footnote.`,
};

/**
 * `/pricing` (#477).
 *
 * The site says the thing is free and had no page saying so — a claim with no address. This one is short because there is
 * one price, and it states the **limits** of the free tier rather than its benefits: a free tier that hides its ceiling is
 * a free tier people stop trusting the day they hit it.
 */
export default function PricingPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <Badge variant="secondary">Free while in build</Badge>
      <h1 className="mt-4 text-4xl font-bold tracking-tight text-ink">No card, no sales call</h1>
      <p className="mt-4 text-lg leading-relaxed text-ink/80">
        {brand.name} is free to use while it is being built. There is no trial clock, no credit card and nothing to cancel.
      </p>

      <Card className="mt-10">
        <CardHeader>
          <CardTitle className="text-base">What you get</CardTitle>
          <CardDescription>Everything the product does, because it is the whole product.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink/80">
          <p>· A pass carrying per-purchase and per-window limits, an expiry, and a revoke.</p>
          <p>· A public page a seller can check, that answers active, revoked, expired or unknown.</p>
          <p>· The brand kit, MIT, if you would rather run your own.</p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle className="text-base">What &ldquo;free&rdquo; does not mean</CardTitle>
          <CardDescription>A free tier that hides its ceiling is one people stop trusting.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-ink/80">
          <p>
            · <strong>No service level.</strong> This is a reference instance in <strong>{brand.mode}</strong> mode, not a
            production service. It can go down, and will.
          </p>
          <p>· <strong>No support contract.</strong> Issues are read; nothing is promised in an hour.</p>
          <p>
            · <strong>No custodian relationship.</strong> We hold no money and move none, so there is nothing for us to
            insure.
          </p>
          <p>
            · <strong>No guarantee about the things not built.</strong> Where a feature is still being built, the page that
            describes it says so.
          </p>
        </CardContent>
      </Card>

      <section className="mt-10 space-y-3 text-sm leading-relaxed text-ink/80">
        <h2 className="text-lg font-semibold text-ink">Why it can be free</h2>
        <p>
          The software is MIT and the expensive part — verification — is a read the seller does without an account. There is
          no per-seat licence to enforce, so there is nothing to charge for while the thing is being judged.
        </p>
        <h2 className="mt-6 text-lg font-semibold text-ink">If it stops being free</h2>
        <p>
          This page will say so before it happens, with the date. A page that changes quietly is worse than a price.
        </p>
      </section>

      <p className="mt-10 text-sm text-ink/60">
        Read <Link href="/terms" className="text-deep hover:underline">the terms</Link> for what this is not, or{" "}
        <Link href="/privacy" className="text-deep hover:underline">the privacy page</Link> for what we hold.
      </p>
    </main>
  );
}

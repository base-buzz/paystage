import type { Metadata } from "next";
import Link from "next/link";

import { brand } from "@/lib/brand-config";

export const metadata: Metadata = {
  title: "Privacy",
  description: `What ${brand.name} holds, how long it keeps it, and what deleting it does — in plain sentences.`,
};

/**
 * `/privacy` for the reference instance (#475).
 *
 * Written to be checkable rather than reassuring: every claim here is something a reader could verify against the API.
 * Two rules shaped it:
 *
 *  1. **describe the deployment we run, not a hypothetical one.** This instance runs in `mode: demo`, and a fork collects
 *     whatever its operator configures. Saying "we collect nothing" while a fork collects everything would be a privacy
 *     page that lies on someone else's behalf.
 *  2. **do not overclaim deletion.** We can delete the mandate and its state. We cannot uninstall a pass from a phone —
 *     only revoke it, which makes it verify as revoked. Those are different verbs and the page says so.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Privacy</h1>
      <p className="mt-3 text-sm text-ink/60">
        {brand.name} is a reference instance of PayStage, running in <strong>{brand.mode}</strong> mode. This page describes
        what <em>this</em> deployment holds. A fork runs its own and may differ.
      </p>

      <section className="mt-10 space-y-4 text-sm leading-relaxed text-ink/80">
        <h2 className="text-lg font-semibold text-ink">What we hold</h2>
        <p>
          A mandate record: a serial, the principal label on the pass (for example a company name), the limits, the expiry,
          the state (active, revoked or expired), and when it was created and changed. That is the record a seller's scan
          reads.
        </p>
        <p className="rounded-md border border-ink/10 bg-ink/[0.03] px-4 py-3">
          <strong>We do not hold</strong> keys, funds, card numbers, payee balances or bank details. A pass carries a
          spending limit; it does not carry money.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-ink">How long</h2>
        <p>
          Until the mandate is revoked or deleted, plus a short period to serve the verification endpoint correctly while a
          revocation propagates. A revoked mandate is kept in a revoked state rather than deleted, because{" "}
          <em>&ldquo;this was revoked&rdquo;</em> is the answer a seller most needs.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-ink">Export and deletion</h2>
        <p>
          The record is readable by serial at the API and is what the export contains. Deleting a mandate removes the row and
          its state; after that, a serial verifies as <strong>unknown</strong>.
        </p>
        <p>
          <strong>What deletion does not do:</strong> a pass already installed in a wallet stays on that phone. We cannot
          uninstall it. We can only revoke it, which makes it verify as revoked — which is the reason to prefer revoking over
          deleting in the first place.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-ink">Who processes it</h2>
        <p>
          For this instance, the database and the web host are third-party processors; they store the mandate record and serve
          the pages. We do not sell or share it, and there is no advertising or analytics network embedded in these pages.
        </p>

        <h2 className="mt-8 text-lg font-semibold text-ink">Contact</h2>
        <p>
          Use the security contact in <Link href="/.well-known/security.txt" className="text-deep hover:underline">
            <code>/.well-known/security.txt</code>
          </Link>{" "}
          for anything sensitive, including a deletion request.
        </p>
      </section>
    </main>
  );
}

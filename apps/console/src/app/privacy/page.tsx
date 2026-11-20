import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";

/**
 * The privacy page.
 *
 * Written against `apps/hosted/src/telemetry.ts` rather than from memory: every field listed here is one the code
 * actually writes, and `scripts/check-privacy.mjs` fails when the two drift. A privacy policy that overstates what
 * we collect is merely dull; one that understates it is a lie with a footer link.
 */
export const metadata: Metadata = {
  title: "Privacy",
  description:
    "What PayStage records when an evaluation is made, what it does not record, and how to have a row removed.",
};

export default function PrivacyPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Privacy</h1>
      <p className="lp-lead">
        PayStage is a payment-safety tool used by agents. Nothing here requires an account: every tool, the free tier, the
        paid path and every receipt work signed out. There are no cookies and no tracking pixels.

        Signing in is optional and exists for one reason — to remember your theme and language on another device. This
        page states exactly what a call records and exactly what an account would store.
      </p>

      <h2>What a call records</h2>
      <p>One row per call, in our own database:</p>
      <ul>
        <li>
          <strong>when</strong> — a timestamp
        </li>
        <li>
          <strong>source</strong> — <code>real</code>, <code>synthetic</code> or <code>test</code>, as the caller
          labels it (unlabelled is recorded as <code>real</code>)
        </li>
        <li>
          <strong>tool</strong> — which of the tools was called
        </li>
        <li>
          <strong>client package</strong> and <strong>client version</strong> — the SDK build that made the call, taken
          from an <code>x-paystage-client</code> header or the user agent when it names one of our packages. This is the
          build, not you: no IP address, no user-agent string, and nothing that identifies a person is stored. It exists
          so a release can be checked against what is actually installed.
        </li>
        <li>
          <strong>decision</strong> and <strong>reason codes</strong> — for example <code>do_not_pay</code> with{" "}
          <code>known drainer</code>
        </li>
        <li>
          <strong>network</strong> — the CAIP-2 id, e.g. <code>eip155:8453</code>
        </li>
        <li>
          <strong>latency</strong> — how long the evaluation took, in milliseconds
        </li>
        <li>
          <strong>amount</strong> and <strong>payee</strong> — the payment being judged, when one was supplied
        </li>
        <li>
          <strong>transaction hash</strong> and <strong>payer address</strong> — only when a settlement happened,
          read from the payment receipt
        </li>
        <li>
          <strong>request id</strong>, <strong>facilitator status</strong>, <strong>error class</strong> — for
          debugging a failure
        </li>
      </ul>

      <h2>What it does not record</h2>
      <ul>
        <li>
          <strong>No IP address.</strong> The free tier counts calls per IP to enforce its daily allowance, but that
          count lives in the Worker's memory and is never written to the database.
        </li>
        <li>
          <strong>No email address, name or password.</strong> Account creation is optional and uses a wallet signature,
          so there is nothing to leak and nothing to reset.
        </li>
        <li>
          <strong>No cookies or device identifiers</strong> on this site.
        </li>
        <li>
          <strong>No request bodies.</strong> We record the payment being judged, never the content of your request
          to the seller.
        </li>
        <li>
          <strong>No private keys.</strong> PayStage never holds one and cannot sign.
        </li>
      </ul>

      <h2>If you choose to sign in</h2>
      <p>
        Optional, and only to carry your preferences between devices. The record is a wallet address and two settings:
      </p>
      <ul>
        <li><strong>wallet address</strong> — the one that signed the message; it is already public on chain</li>
        <li><strong>theme</strong> — <code>system</code>, <code>light</code> or <code>dark</code></li>
        <li><strong>language</strong> — the locale you picked</li>
        <li><strong>updated_at</strong> — when you last changed them</li>
      </ul>
      <p>
        Nothing else is stored, no session cookie identifies you across the site, and <strong>no feature requires it</strong>
        — signing out loses nothing except cross-device sync. Agents are never asked to sign in; the MCP server does not
        read this at all.
      </p>

      <h2>On-chain data is public</h2>
      <p>
        When a payment settles, the transaction — including the payer address, the payee and the amount — is public on
        Base and can never be removed by us or anyone else. Our row simply echoes what the chain already shows.
      </p>

      <h2>Who else sees it</h2>
      <ul>
        <li>Cloudflare — hosts the API and the site</li>
        <li>Supabase — our database</li>
        <li>Coinbase (CDP) — the x402 facilitator that verifies and settles paid calls</li>
      </ul>
      <p>None of them receives anything beyond what is listed above.</p>

      <h2>Removing a row</h2>
      <p>
        Open an issue at{" "}
        <a href="https://github.com/base-buzz/paystage/issues" rel="noopener">
          github.com/base-buzz/paystage/issues
        </a>{" "}
        with the transaction hash or request id and we will delete the row. We cannot delete the on-chain transaction,
        because nobody can.
      </p>

      <h2>Verifying this page</h2>
      <p>
        The claim that matters is the field list above. It is checked against the code by{" "}
        <code>scripts/check-privacy.mjs</code> in the repository, so a field added to telemetry without a line here
        fails CI rather than quietly becoming true.
      </p>

      <p className="lp-prose-back">
        <Link href="/">← back to PayStage</Link> · <Link href="/limits">limits</Link> ·{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/LIMITS.md">LIMITS.md</a>
      </p>
    </main>
  );
}

import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";

/**
 * The terms page.
 *
 * Written to say what the code actually does, not what a terms template would like it to do. The
 * distinction that matters is in "What PayStage does not do": a verdict is advice to a signer, and
 * the gate has no way to enforce a cap or stop a payment the signer chooses to send. Overstating
 * that would be the one lie a footer link can carry.
 */
export const metadata: Metadata = {
  title: "Terms",
  description:
    "What PayStage promises, what it explicitly does not promise, and the MIT licence the software ships under.",
};

export default function TermsPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Terms</h1>
      <p className="lp-lead">
        These terms cover the hosted service at paystage.xyz and the software in the public repository. They are
        deliberately short. They do not create a company, a support contract, or a promise that a payment is safe.
      </p>

      <h2>What PayStage does</h2>
      <p>
        PayStage evaluates a proposed x402 payment — or an outstanding approval, a trade order or a payment rate —
        against a policy you supply, and returns a verdict: <code>pay</code>, <code>review</code> or{" "}
        <code>do_not_pay</code>. Trade tools return <code>allow</code>, <code>review</code> or{" "}
        <code>do_not_trade</code>. Each verdict carries the rule that fired. A <code>do_not_pay</code> is a refusal:
        the gate does not return <code>pay</code> for that request.
      </p>

      <h2>What PayStage does not do</h2>
      <p>
        <strong>A verdict is advisory until a signer enforces it.</strong> PayStage is not the wallet, the smart
        account or the signer. It holds no keys and cannot sign. If the code that signs and sends the payment ignores
        the verdict, the payment can still happen. The spend cap in your policy is a rule this gate checks and
        reports; it is not a limit we enforce on your account. Enforcement belongs to the signer or agent that
        chooses to honour the verdict.
      </p>
      <ul>
        <li>We do not take custody of funds, hold them, move them or settle payments.</li>
        <li>
          We do not issue refunds, reversals or chargebacks. An on-chain payment is irreversible, and we have no
          mechanism to undo one.
        </li>
        <li>
          We do not guarantee that a payee is honest, that a seller delivers, or that a policy is a good policy. A
          payment that passes the gate is only a payment the gate did not refuse.
        </li>
        <li>
          We do not cover payments made outside the gate. An agent that signs without calling it is never evaluated.
        </li>
        <li>We do not hold private keys and cannot sign for you.</li>
      </ul>

      <h2>The service is provided as is</h2>
      <p>
        The hosted service and the software are provided &quot;as is&quot;, without warranty of any kind, express
        or implied, including fitness for a particular purpose. There is no SLA: the hosted API may be unavailable,
        may change, or may stop. We fix what we can, when we can, on a best-effort basis, and we do not promise a
        response time.
      </p>

      <h2>No legal entity, and the licence governs</h2>
      <p>
        The project operates without a legal entity. There is no company to name as a contracting party and no
        jurisdiction we can honestly claim as governing law, so these terms do not assert one. The software is
        released under the MIT licence in{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/LICENSE" rel="noopener">
          LICENSE
        </a>
        ; that licence is the binding grant for the code and it wins over anything written here. If you need terms
        with a counterparty, a governing-law clause or an indemnity, this project cannot give you them.
      </p>
      <p>
        Self-hosting is encouraged. Nothing here restricts the rights the MIT licence gives you, including running a
        modified copy.
      </p>

      <h2>Data and figures</h2>
      <p>
        Numbers we publish carry their provenance and population beside them: what was counted, where it came from
        and the date. They describe what the measurement included, not a guarantee of future results. Where a figure
        has no support, it is not published.
      </p>

      <h2>Changes</h2>
      <p>
        These terms can change when the software changes. The repository&apos;s commit history is the record of
        when. Continuing to use the hosted service after a change means the current page applies.
      </p>

      <p className="lp-prose-back">
        <Link href="/">← back to PayStage</Link> · <Link href="/privacy">privacy</Link> ·{" "}
        <Link href="/support">support</Link> · <Link href="/contact">contact</Link>
      </p>
    </main>
  );
}

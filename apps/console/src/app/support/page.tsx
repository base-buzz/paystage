import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";

/**
 * The support page.
 *
 * Two routes only: the private advisory form for anything exploitable, the public tracker for
 * everything else. The bundle id is the important instruction — it is what makes a verdict
 * recomputable instead of a screenshot of an answer.
 */
export const metadata: Metadata = {
  title: "Support",
  description:
    "How to report a security issue or a wrong verdict, and what response to expect: best effort, no SLA.",
};

export default function SupportPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Support</h1>
      <p className="lp-lead">
        PayStage is maintained by the project team on a best-effort basis. There is no support contract and no SLA.
        These are the routes that get a report to the right place.
      </p>

      <h2>Security issues</h2>
      <p>
        Report a vulnerability privately through GitHub&apos;s security advisory form:{" "}
        <a href="https://github.com/base-buzz/paystage/security/advisories/new" rel="noopener">
          github.com/base-buzz/paystage/security/advisories/new
        </a>
        . Do not open a public issue for an exploitable path.
      </p>
      <p>
        A preflight bypass counts as a security bug. If an unsafe payment is evaluated and still returns{" "}
        <code>pay</code>, report it privately. Include the policy, the request, and the expected versus actual
        decision, as described in{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/SECURITY.md" rel="noopener">
          SECURITY.md
        </a>
        .
      </p>

      <h2>Bugs and verdict questions</h2>
      <p>
        Use the public issue tracker:{" "}
        <a href="https://github.com/base-buzz/paystage/issues" rel="noopener">
          github.com/base-buzz/paystage/issues
        </a>
        .
      </p>
      <p>
        For a verdict that looks wrong, include the <strong>bundle id</strong> — the{" "}
        <code>bundle_id</code> returned by the evaluation. The bundle is the record of the decision: inputs, policy
        hash, verdict and receipt. With it the verdict can be recomputed instead of guessed at. The hosted API
        serves the bundle at <code>GET /runs/&lt;bundle_id&gt;</code>. If you are running a package locally, include
        the tool name, the policy with secrets removed, and the exact input. A report that names the bundle id is
        the fastest one to answer.
      </p>

      <h2>What to expect</h2>
      <p>
        Best effort, from the project team. Security reports are treated first. There is no guaranteed response
        time, no on-call rotation and no SLA; the repository is public, and a fix ships through the normal release
        path when it is ready. For non-security, non-verdict questions, the{" "}
        <Link href="/contact">contact page</Link> has the project mailbox.
      </p>

      <p className="lp-prose-back">
        <Link href="/">← back to PayStage</Link> · <Link href="/privacy">privacy</Link> ·{" "}
        <Link href="/terms">terms</Link> · <Link href="/contact">contact</Link>
      </p>
    </main>
  );
}

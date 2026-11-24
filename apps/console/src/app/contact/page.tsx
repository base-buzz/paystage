import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";

/**
 * The contact page.
 *
 * One published project mailbox and the repository. No personal names, phone numbers or addresses:
 * the project is the contact, and the address here is the same one already published in the hosted
 * API's OpenAPI description rather than a new one invented for this page.
 */
export const metadata: Metadata = {
  title: "Contact",
  description: "The PayStage project mailbox and repository — no personal contact details.",
};

export default function ContactPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Contact</h1>
      <p className="lp-lead">
        One project mailbox and one repository. There are no personal contact details here because the project is
        the contact, not one person.
      </p>

      <h2>Project mailbox</h2>
      <p>
        <a href="mailto:basebuzz69@gmail.com">basebuzz69@gmail.com</a>
      </p>
      <p>
        This is the shared project address already published in the hosted API&apos;s OpenAPI description. It
        reaches the project team.
      </p>

      <h2>Repository</h2>
      <p>
        <a href="https://github.com/base-buzz/paystage" rel="noopener">
          github.com/base-buzz/paystage
        </a>{" "}
        — source, issues and pull requests. For a wrong verdict, include the bundle id as described on{" "}
        <Link href="/support">support</Link>.
      </p>

      <h2>Security</h2>
      <p>
        Do not report a vulnerability by email. Use the private advisory route on{" "}
        <Link href="/support">support</Link>.
      </p>

      <p className="lp-prose-back">
        <Link href="/">← back to PayStage</Link> · <Link href="/privacy">privacy</Link> ·{" "}
        <Link href="/terms">terms</Link> · <Link href="/support">support</Link>
      </p>
    </main>
  );
}

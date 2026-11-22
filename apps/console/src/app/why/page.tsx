import type { Metadata } from "next";
import "../landing.css";
import Link from "next/link";

/**
 * /why — the long version of the argument, for the reader who will check it.
 *
 * Unlisted and noindex, like /lab and /backlog: public because a payments lawyer or a standards
 * reader should be able to find it, not promoted because it is not a landing page.
 *
 * Every external claim carries the link that supports it, and every link on this page was read on
 * 2026-11-22. The date is stated once in the footer. If a sentence could not be sourced it is not
 * here; in particular the page does not describe anyone's motives, and it does not name an
 * organisation that the source does not name.
 */
export const metadata: Metadata = {
  title: "Why x402 needs an independent adjudicator",
  description:
    "The two jobs behind every payment, the 25-year reservation of HTTP 402, the 2026 x402 Foundation launch, and the seat the spec leaves open.",
  alternates: { canonical: "https://paystage.xyz/why" },
  robots: { index: false, follow: false },
};

export default function WhyPage() {
  return (
    <main className="lp-wrap lp-prose">
      <p className="lp-eyebrow">X402 · ORIGIN · GOVERNANCE · THE SEAT</p>
      <h1>Two jobs, and the seat between them</h1>
      <p className="lp-lead">
        A payment does two separate things: it authorises, and it settles. Most of the safety argument
        lives in the gap between them — including the argument for a decision-maker who does not get
        paid when the answer is yes.
      </p>

      <h2>1. The two jobs</h2>
      <p>
        A card payment is not one event. An authorisation reserves an amount on the cardholder&apos;s
        account; capture acts on that authorisation later, and settlement is when the funds actually
        move. Stripe&apos;s own explainer puts it plainly:{" "}
        <a href="https://stripe.com/nz/resources/more/credit-card-payment-authorization-and-transaction-settlement-process">
          capture is when the merchant acquirer initiates the process to act on the authorisation
        </a>
        , and settlement is when the funds are moved. The same page defines the acquirer as the
        institution that processes card payments on behalf of the business — the merchant&apos;s side,
        not the cardholder&apos;s.
      </p>
      <p>
        The two jobs can be separated by days. Stripe&apos;s explainer puts typical authorisation
        lifetimes at{" "}
        <a href="https://stripe.com/nz/resources/more/credit-card-payment-authorization-and-transaction-settlement-process">
          5 to 10 days, sometimes up to 30
        </a>
        ; the authorisation can expire before capture, or{" "}
        <a href="https://docs.stripe.com/payments/place-a-hold-on-a-payment-method">
          be cancelled
        </a>
        . An authorisation is a promise to settle, not the settlement itself.
      </p>
      <p>
        x402 keeps that split. A client signs a payment payload and sends it in the{" "}
        <code>PAYMENT-SIGNATURE</code> header — the authorisation; the facilitator is{" "}
        <a href="https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md">
          the service that handles payment verification and blockchain settlement
        </a>
        . Verification happens before the resource executes; in the default{" "}
        <code>authorization</code> flow, settlement happens after it. The wire format is specified in the{" "}
        <a href="https://github.com/x402-foundation/x402/blob/main/specs/transports-v2/http.md">
          HTTP transport
        </a>
        .
      </p>
      <p>
        So the facilitator plays the role the acquirer plays in a card payment: it is the merchant-side
        party that verifies and settles. In x402, the on-chain transfer is the settlement. And because
        settlement can follow the decision to pay, the payment can still fail at settlement — the spec
        gives settlement its own error state, <code>settlement_pending</code>, for a transaction that
        has been broadcast but whose confirmation is not yet established. A &ldquo;yes&rdquo; before
        signing is not a guarantee that value moved.
      </p>
      <p>
        That gap is why the deciding party matters. If the party that benefits from a yes also decides
        whether yes is allowed, a refusal is not an independent check — it is a commercial preference
        with a signature on it. The seat this page is about is the decision <em>before</em> the
        signature, not the rail that settles afterwards.
      </p>

      <h2>2. The code that waited</h2>
      <p>
        HTTP reserved <code>402 Payment Required</code> in its first HTTP/1.1 specification. RFC 2068,
        published in January 1997, says of 402:{" "}
        <a href="https://www.rfc-editor.org/rfc/rfc2068.html">
          &ldquo;This code is reserved for future use.&rdquo;
        </a>
      </p>
      <p>
        Twenty-five years later the current HTTP semantics specification, RFC 9110, published in June
        2022, still makes the same reservation:{" "}
        <a href="https://www.rfc-editor.org/rfc/rfc9110.html#section-15.5.3">
          &ldquo;The 402 (Payment Required) status code is reserved for future use.&rdquo;
        </a>{" "}
        The reservation was still in force in the current specification; twenty-five years separate
        the two statements.
      </p>
      <p>
        <a href="https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md">
          x402
        </a>{" "}
        is a protocol that puts 402 to work: a server answers with payment terms, the client pays, and
        the request is retried. Whether x402 is the <em>first serious use</em> is not a claim this page
        can prove from the record, so it does not make it. What the record shows is a code reserved in
        1997, still reserved in 2022, and a protocol built on it now.
      </p>

      <h2>3. The 2026 settlement</h2>
      <p>
        On <strong>14 July 2026</strong> the Linux Foundation announced the operational launch of the
        x402 Foundation, with the x402 protocol contributed by Coinbase. The Foundation is now active
        under formal governance, and the announcement says <strong>40 organisations</strong> have joined
        as members.{" "}
        <a href="https://www.linuxfoundation.org/press/linux-foundation-announces-operational-launch-of-x402-foundation-to-standardize-internet-native-payments-for-ai-agents-and-applications">
          Read the Linux Foundation press release.
        </a>
      </p>
      <p>
        The premier members named in that release include Adyen, Amazon Web Services (AWS), American
        Express, Circle, Cloudflare, Coinbase, Fiserv, Google, Mastercard, Monad Foundation, MoonPay,
        Ripple, Shopify, Solana Foundation, Stellar Development Foundation, Stripe and Visa. The scope
        the release describes is payments &ldquo;ranging from traditional cards to stablecoins&rdquo;.
      </p>
      <p>
        The Foundation&apos;s Technical Steering Committee lists{" "}
        <a href="https://github.com/x402-foundation/x402/blob/main/TSC.md">
          Coinbase, Cloudflare and Stripe as participating organisations
        </a>
        . Governance is no longer an intention; it has a date, a stated scope and a membership list.
      </p>

      <h2>4. The industry is filling that seat from several directions</h2>
      <p>
        The same seat is being approached from other directions. On 26 May 2026 the FIDO
        Alliance described the contribution of Google&apos;s Agent Payments Protocol (AP2) and
        Mastercard&apos;s Verifiable Intent — co-developed with Google — into the Alliance, and framed
        them as complementary layers:{" "}
        <a href="https://fidoalliance.org/building-the-trust-layer-for-agentic-payments-with-ap2-and-verifiable-intent/">
          AP2 standardises how consent and delegation are defined and communicated, while Verifiable
          Intent standardises how that consent is represented and verified as evidence
        </a>
        . The Alliance calls the result a trust layer for agentic payments.
      </p>
      <p>
        Visa&apos;s newsroom lists, dated{" "}
        <strong>18 November 2026</strong>,{" "}
        <a href="https://usa.visa.com/about-visa/newsroom/press-releases.html">
          &ldquo;Visa Expands Agentic Ready to Help Scale Trusted AI Commerce Globally&rdquo;
        </a>
        . In that release, Agentic Ready is expanded to the acceptance ecosystem — merchants, payment
        service providers and acquirers — with more than 140 participants, and more than 175 issuers
        already participating across 45 markets.{" "}
        <a href="https://usa.visa.com/about-visa/newsroom/press-releases.releaseId.22986.html">
          Read the release.
        </a>
      </p>
      <p>
        Read together, these efforts address different questions: who authorised the agent, what
        evidence of that authorisation travels with the payment, and which merchants and acquirers can
        process it. They are the industry filling in the layers around the decision. The decision on an
        individual payment, before it is signed, is a separate job.
      </p>

      <h2>5. What the spec already specifies</h2>
      <p>
        The spec does specify where a refusal can happen. The x402 client runs{" "}
        <code>onBeforePaymentCreation</code> before it creates the payload, and a hook may return{" "}
        <code>{`{ abort: true, reason: string }`}</code>; the SDK then aborts creation with that reason.{" "}
        <a href="https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/client/x402Client.ts">
          See the hook and the abort path in x402Client.ts.
        </a>{" "}
        The client can therefore refuse before signing, in code the protocol already defines.
      </p>
      <p>The spec also defines three extensions that give a payment a record, an identity and a catalogue entry:</p>
      <ul>
        <li>
          <a href="https://github.com/x402-foundation/x402/blob/main/specs/extensions/extension-offer-and-receipt.md">
            The offer-and-receipt extension
          </a>{" "}
          adds server-side signatures: a signed offer commits to the terms, and a signed receipt is
          returned only on success. The extension names dispute evidence and auditability among its
          uses.
        </li>
        <li>
          <a href="https://github.com/x402-foundation/x402/blob/main/specs/extensions/payment_identifier.md">
            The payment-identifier extension
          </a>{" "}
          gives the client an idempotency key, so a repeated request can return the cached response
          instead of executing twice, and a reused id with a different payload is refused with{" "}
          <code>409 Conflict</code>.
        </li>
        <li>
          <a href="https://github.com/x402-foundation/x402/blob/main/specs/extensions/bazaar.md">
            The bazaar extension
          </a>{" "}
          lets a resource server declare what it sells so a facilitator can catalogue and index the
          endpoint.
        </li>
      </ul>
      <p>
        <strong>
          Where a decision can be refused, and where the evidence lives, are specified. Who occupies
          that seat is not.
        </strong>{" "}
        The hook is a socket, not a policy. The extensions are places to put a record or a listing, not
        a party obliged to read either.
      </p>

      <h2>6. Why an independent adjudicator is useful as a public good</h2>
      <p>
        PayStage is not a member of the x402 Foundation, and nothing on this page implies endorsement
        by it or by any company named above.
      </p>
      <p>
        What is on offer is deliberately narrow: a read-only preflight that returns <code>pay</code>,{" "}
        <code>review</code> or <code>do_not_pay</code> before anything is signed, with the rule that
        fired attached to the verdict. It holds no keys, moves no funds, sells no listing and takes no
        cut of a payment. The code is{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/LICENSE">MIT licensed</a>, and the
        evaluator can be{" "}
        <a href="https://github.com/base-buzz/paystage#readme">read and self-hosted</a>.
      </p>
      <p>
        The reason to make the decision independent is the same reason to make the record portable:
        a verdict is only worth something to the party that did not choose it if that party can check
        it. Receipts are signed and{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/docs/specs/receipt-spec.md">
          verifiable against the published key
        </a>
        , so a refusal can be inspected by someone who does not trust us — the rule that fired is in
        the verdict, and the signature is under a key anyone can fetch.
      </p>
      <p>
        A public good still has to be paid for. How this one is funded, what is disclosed and what is
        not is recorded in{" "}
        <a href="https://github.com/base-buzz/paystage/blob/main/docs/funding.md">docs/funding.md</a>
        : credits and free model access, described as usage rather than money, with the provenance of
        that description stated.
      </p>

      <p className="lp-prose-back">
        All external links on this page were read on <strong>2026-11-22</strong>. The page is unlisted,
        not secret: it is at a normal path, but no index or agent-facing list names it.{" "}
        <Link href="/">← PayStage</Link> · <Link href="/state-of-x402">State of x402</Link> ·{" "}
        <Link href="/glossary">glossary</Link> ·{" "}
        <a href="https://github.com/base-buzz/paystage">source</a>
      </p>
    </main>
  );
}

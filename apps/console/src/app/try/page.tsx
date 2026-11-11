import type { Metadata } from "next";
import { TryConsole } from "./TryConsole";

export const metadata: Metadata = {
  title: "Try the gate — PayStage",
  description:
    "Send a real x402 payment challenge to the hosted PayStage API and see the verdict. No install, no key, no account.",
};

export default function TryPage() {
  return (
    <main className="lp-wrap" style={{ paddingTop: 48, paddingBottom: 72 }}>
      <h1 style={{ fontSize: 34, lineHeight: 1.15, margin: 0 }}>
        Send a real payment challenge. Get a real verdict.
      </h1>
      <p style={{ marginTop: 14, fontSize: 17, maxWidth: 720, opacity: 0.85 }}>
        This calls the hosted API for real — no mock, no key, no account. Three scenarios
        below, each one a payment an agent could plausibly be asked to sign.
      </p>
      <p style={{ marginTop: 10, fontSize: 14, maxWidth: 720, opacity: 0.6 }}>
        Every call from this page is labelled <code>x-paystage-source: test</code> so it is
        never counted as a real caller. The verdicts are computed by the same evaluator the
        npm packages ship.
      </p>

      <TryConsole />

      <section style={{ marginTop: 48, maxWidth: 720 }}>
        <h2 style={{ fontSize: 20, marginBottom: 8 }}>What you are looking at</h2>
        <p style={{ opacity: 0.8 }}>
          A policy that allows one payee, one asset, one network, and a 0.05 USDC ceiling.
          The <strong>allowed</strong> case passes; the <strong>unknown payee</strong> is
          denied by the allow-list rather than by the amount, which is the case a single
          spend cap cannot catch; the <strong>over-cap</strong> case is denied on amount.
        </p>
        <p style={{ opacity: 0.8 }}>
          The verdict is <code>pay</code>, <code>review</code> or <code>do_not_pay</code>,
          with the rule that fired. A denial happens <em>before</em> anything is signed —
          that is the whole point, and it is what{" "}
          <code>@paystage/x402-guard</code> enforces inside an agent&apos;s payment loop.
        </p>
      </section>
    </main>
  );
}

import type { Metadata } from "next";
import "../landing.css";

export const metadata: Metadata = {
  title: "PayStage for the Vercel AI SDK — pay or refuse, before signing",
  description:
    "Two AI SDK tools that decide whether an x402 payment should be signed, with the rules that fired. Read-only: nothing here signs or spends.",
  alternates: { canonical: "https://paystage.xyz/ai-sdk" },
};

const EXAMPLE = `import { generateText, gateway } from "ai";
import { paystageTools } from "@paystage/ai-sdk";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_networks: ["eip155:8453"],
  unknown_payee: "deny",
};

const { text } = await generateText({
  model: gateway("openai/gpt-5-mini"),
  tools: { ...paystageTools({ policy }), ...yourPaymentTools },
  prompt: "Buy the weather data, but not above 2 cents.",
});`;

export default function AiSdkPage() {
  return (
    <main className="lp">
      <section className="lp-section lp-wrap">
        <p className="lp-kicker">integration</p>
        <h1 className="lp-h1">PayStage for the AI SDK</h1>
        <p className="lp-lead">
          The AI SDK makes it easy to hand a model a wallet and a set of tools. That combination has an
          obvious failure: a model that can pay can pay the wrong party, in the wrong asset, too often.
        </p>
        <p className="lp-body">
          Both tools answer that question inside the same loop that would sign the payment, and
          they are read-only by construction — <strong>nothing here signs, holds a key, or moves
          money</strong>. The tool that decides must not be the tool that spends.
        </p>

        <h2 className="lp-h2">Install</h2>
        <pre className="lp-code"><code>npm install @paystage/ai-sdk ai zod</code></pre>

        <h2 className="lp-h2">Use</h2>
        <pre className="lp-code"><code>{EXAMPLE}</code></pre>

        <h2 className="lp-h2">The tools</h2>
        <table className="lp-table">
          <thead>
            <tr>
              <th>tool</th>
              <th>returns</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><code>paystage_evaluate_payment</code></td>
              <td><code>decision</code> (pay / review / do_not_pay), <code>reasons[]</code>, <code>summary</code></td>
            </tr>
            <tr>
              <td><code>paystage_should_pay</code></td>
              <td><code>allowed</code>, <code>decision</code>, <code>reasons[]</code> — for when reasoning is noise</td>
            </tr>
          </tbody>
        </table>

        <h2 className="lp-h2">What a refusal looks like</h2>
        <p className="lp-body">
          A refusal is data, not an exception: <code>do_not_pay</code> with the rule that fired, so the
          model can explain itself and try a different route. Evaluation is a local computation — not a
          network call, not a paid request — so asking before every payment costs nothing.
        </p>

        <p className="lp-body">
          <a className="lp-link" href="https://www.npmjs.com/package/@paystage/ai-sdk">npm</a> ·{" "}
          <a className="lp-link" href="https://github.com/base-buzz/paystage/tree/main/packages/ai-sdk">source</a> ·{" "}
          <a className="lp-link" href="https://paystage.xyz/">PayStage</a>
        </p>
      </section>
    </main>
  );
}

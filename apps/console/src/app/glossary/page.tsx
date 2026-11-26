import type { Metadata } from "next";
import "../landing.css";

/**
 * `/glossary` — the words we use, and where they come from (#446).
 *
 * We found that two of our own nouns were reinventions. AP2 (the Agent Payments Protocol, published by Google under
 * Apache-2.0) already names them precisely: what we called "the page where a human approves" is a **Trusted
 * Surface**, and what we called "the signed receipt for a verdict" is a **Mandate Receipt**. Reusing their vocabulary
 * costs nothing and saves a reader from learning ours.
 *
 * The attribution is not decoration: this page uses AP2's *words* and implements none of AP2's *protocol*. Saying the
 * second part is what keeps the first from reading as a compatibility claim.
 */
export const metadata: Metadata = {
  title: "Glossary",
  description:
    "The words this project uses for agent payment authority, where each one comes from, and what adopting a vocabulary does not mean.",
};

type Term = { term: string; ours: string; definition: string; ap2: boolean };

const TERMS: Term[] = [
  {
    term: "Trusted Surface",
    ours: "the mandate page",
    definition:
      "A secure, non-agentic interface that renders the mandate's content to the human for authorisation and consent. Ours is the page plus Face ID: the agent cannot draw it, cannot approve it, and cannot retry past a refusal.",
    ap2: true,
  },
  {
    term: "Open Mandate",
    ours: "a pass that can still be narrowed",
    definition:
      "A mandate not yet bound to a particular action, carrying the constraints that a later, narrower mandate must satisfy.",
    ap2: true,
  },
  {
    term: "Closed Mandate",
    ours: "a pass tied to one purchase",
    definition: "A mandate bound to a particular action, presented to a verifier for authorisation.",
    ap2: true,
  },
  {
    term: "Mandate Receipt",
    ours: "the signed verdict",
    definition:
      "A verifier-signed record of the result of an authorisation. Ours is the ES256 receipt that carries the verdict, the rule that fired, and — since this week — the digest of the exact payment it covers.",
    ap2: true,
  },
  {
    term: "Mandate Content",
    ours: "what the page shows",
    definition: "The payload of a mandate as rendered to the human: amounts, payee, expiry, and what the agent may do.",
    ap2: true,
  },
];

export default function GlossaryPage() {
  return (
    <main className="lp-wrap lp-prose">
      <h1>Glossary</h1>
      <p className="lp-lead">
        The words we use for authority over an agent&apos;s spending, and where each one comes from.
      </p>
      <p>
        Several of these are not ours. <strong>AP2</strong> — the Agent Payments Protocol, published by Google under
        Apache-2.0 — names them more precisely than we did, so we use its vocabulary rather than invent a second one.
      </p>

      <table>
        <thead>
          <tr>
            <th>Term</th>
            <th>What we used to call it</th>
            <th>What it means here</th>
          </tr>
        </thead>
        <tbody>
          {TERMS.map((t) => (
            <tr key={t.term}>
              <td>
                <strong>{t.term}</strong>
                {t.ap2 ? (
                  <>
                    {" "}
                    <sup>AP2</sup>
                  </>
                ) : null}
              </td>
              <td>{t.ours}</td>
              <td>{t.definition}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>What adopting the vocabulary does not mean</h2>
      <p>
        It does not mean we implement AP2. We do not issue AP2 mandates, do not speak its transport, and make no
        compatibility claim: our mandate is our own signed envelope, our receipt is ours, and the only thing shared is
        the name for the idea. If we ever implement the protocol, that sentence changes in the same commit.
      </p>
      <p>
        Attribution: the five terms above and their definitions follow{" "}
        <a href="https://ap2-protocol.org/glossary/" rel="noopener">
          AP2&apos;s published glossary
        </a>{" "}
        (fetched 2026-11-26), which is licensed Apache-2.0.
      </p>
    </main>
  );
}

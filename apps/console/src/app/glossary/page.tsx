import type { Metadata } from "next";
import Link from "next/link";
import { GLOSSARY_MARKDOWN } from "@/lib/glossary.generated";

/**
 * The glossary, rendered from `docs/glossary.md`.
 *
 * One source, two surfaces: the repository file is what a contributor edits, this page is what a stranger reads. The
 * markdown is compiled in by `scripts/sync-glossary.mjs` — reading it from disk worked locally and 500'd in production,
 * where the console deploys without the repository.
 */
export const metadata: Metadata = {
  title: "Glossary — PayStage",
  description: "x402, facilitator, settlement, EIP-3009, HIP-3, CAIP-2 and every other term this project uses.",
};

export default function GlossaryPage() {
  const markdown = GLOSSARY_MARKDOWN;
  const sections = markdown.split(/\n## /).slice(1);
  return (
    <main className="lp-wrap lp-prose">
      <h1>Glossary</h1>
      <p className="lp-lead">
        Every term this project uses. If a word appears elsewhere and is missing here, that is a bug in the glossary.
      </p>
      {sections.map((section) => {
        const [heading, ...rest] = section.split("\n");
        const paras = rest.filter(Boolean);
        return (
          <section key={heading}>
            <h2>{heading.trim()}</h2>
            {paras.map((p, i) => (
              <p key={i} dangerouslySetInnerHTML={{ __html: p
                .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
                .replace(/`(.+?)`/g, "<code>$1</code>") }} />
            ))}
          </section>
        );
      })}
      <p className="lp-prose-back">
        <Link href="/">← back to PayStage</Link> · <Link href="/privacy">privacy</Link>
      </p>
    </main>
  );
}

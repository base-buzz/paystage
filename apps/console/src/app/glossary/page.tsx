import type { Metadata } from "next";
import Link from "next/link";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The glossary, rendered from `docs/glossary.md` rather than duplicated here.
 *
 * One source, two surfaces: the repository file is what a contributor edits, and this page is what a stranger reads.
 * A glossary maintained twice is a glossary that disagrees with itself within a month.
 */
export const metadata: Metadata = {
  title: "Glossary — PayStage",
  description: "x402, facilitator, settlement, EIP-3009, HIP-3, CAIP-2 and every other term this project uses.",
};

export default function GlossaryPage() {
  const markdown = readFileSync(join(process.cwd(), "../../docs/glossary.md"), "utf8");
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

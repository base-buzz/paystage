import type { Metadata } from "next";
import Link from "next/link";

import { AskSurvey } from "@/components/ask-survey";
import { NOT_A_LIST, QUESTION, STORAGE_SENTENCE } from "@/lib/ask-survey";
import { readAskSnapshot } from "@/lib/ask-server";

export const metadata: Metadata = {
  title: QUESTION,
  description:
    "One counted question about agent spending limits: yes, no or already do it. The count is public; individual answers are not. This is not a customer list and a click is not a payment.",
};

/**
 * `/ask` (#511) — the one question the directory numbers cannot answer.
 *
 * The page is deliberately plain: the question, three buttons, the count and the date it opened. It reads
 * the count on every request (`force-dynamic`) so a cached "0" cannot stand in for a real count, and when
 * the migration has not been applied it says the counter is not connected rather than showing a number.
 */
export const dynamic = "force-dynamic";

export default async function AskPage() {
  const snapshot = await readAskSnapshot();

  return (
    <main className="mx-auto max-w-2xl px-5 py-16">
      <p className="text-sm text-ink/60">
        <Link href="/" className="text-deep hover:underline">
          VouchGuard
        </Link>
      </p>

      <h1 className="mt-4 text-3xl font-bold tracking-tight text-ink">{QUESTION}</h1>
      <p className="mt-4 text-sm leading-relaxed text-ink/80">
        Three answers: yes · no · already do it. It is one question about whether a visible spending limit is
        something you would put in front of a team&apos;s agent, and the count is the only result we publish.
      </p>
      <p className="mt-4 text-base font-semibold leading-relaxed text-ink">{NOT_A_LIST}</p>

      <AskSurvey snapshot={snapshot} />

      <section className="mt-10 space-y-3 text-sm leading-relaxed text-ink/80">
        <p>{STORAGE_SENTENCE}</p>
        <p>
          There are no cookies, no tracking pixels and no third-party scripts. One request is made when you
          click an answer, and nothing is sent before it.
        </p>
        <p>
          <Link href="/privacy" className="text-deep hover:underline">
            Read the privacy page
          </Link>{" "}
          for what this deployment holds and how to ask for deletion.
        </p>
      </section>
    </main>
  );
}

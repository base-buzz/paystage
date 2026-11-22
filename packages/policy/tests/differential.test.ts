import { isDeepStrictEqual } from "node:util";
import { describe, expect, it } from "vitest";
import { PolicySchema } from "../src/schema.js";
import { policyCorpus, type CorpusCase } from "./corpus.js";
import { ZodPolicySchema } from "./zod-reference.js";

/**
 * The safety net for #181: the hand-written guards must do exactly what zod did.
 *
 * For every document in the corpus — every policy fixture in the repository, plus deterministic
 * mutations of every seed — this asserts three things:
 *
 *   1. **the same decision** — both accept, or both reject;
 *   2. **the same output** — for an accepted document, the parsed policy is deep-equal, including
 *      which optional keys are present and which unknown keys were stripped;
 *   3. **the same message** — for a rejected document, `error.message` is byte-identical. That is
 *      the user-facing `invalid policy:` text, so a divergence here is the regression the swap
 *      could have hidden.
 *
 * zod is a devDependency for this test only. The corpus count is asserted below so a change that
 * silently empties it cannot pass as a green run.
 */

interface Outcome {
  ok: boolean;
  value?: unknown;
  message?: string;
  issues?: unknown;
}

function run(parse: (input: unknown) => unknown, document: unknown): Outcome {
  try {
    return { ok: true, value: parse(document) };
  } catch (error) {
    const failure = error as { message?: string; issues?: unknown };
    return { ok: false, message: failure.message, issues: failure.issues };
  }
}

function compare(testCase: CorpusCase): string | undefined {
  const before = run((input) => ZodPolicySchema.parse(input), testCase.document);
  const after = run((input) => PolicySchema.parse(input), testCase.document);

  if (before.ok !== after.ok) {
    return `decision differs: zod ${before.ok ? "accepted" : "rejected"}, guards ${after.ok ? "accepted" : "rejected"}`;
  }
  if (before.ok) {
    if (!isDeepStrictEqual(before.value, after.value)) {
      return `accepted output differs:\n  zod:    ${JSON.stringify(before.value)}\n  guards: ${JSON.stringify(after.value)}`;
    }
    return undefined;
  }
  if (before.message !== after.message) {
    return `message differs:\n  zod:\n${before.message}\n  guards:\n${after.message}`;
  }
  if (!isDeepStrictEqual(before.issues, after.issues)) {
    return `issue objects differ:\n  zod:    ${JSON.stringify(before.issues)}\n  guards: ${JSON.stringify(after.issues)}`;
  }
  return undefined;
}

describe("differential: hand-written guards vs zod", () => {
  const corpus = policyCorpus();

  it("covers the whole corpus with no divergence", () => {
    expect(corpus.length).toBeGreaterThan(10_000);
    const failures: string[] = [];
    for (const testCase of corpus) {
      const difference = compare(testCase);
      if (difference !== undefined) failures.push(`${testCase.name}: ${difference}`);
    }
    expect(failures.slice(0, 20).join("\n\n")).toBe("");
    expect(failures).toHaveLength(0);
  });

  it("accepts and rejects a non-trivial share of the corpus, so a parse-everything bug cannot pass", () => {
    const outcomes = corpus.map((testCase) => run((input) => PolicySchema.parse(input), testCase.document));
    const accepted = outcomes.filter((outcome) => outcome.ok).length;
    expect(accepted).toBeGreaterThan(0);
    expect(accepted).toBeLessThan(corpus.length);
    // Every fixture that is a real policy parses; every mutation of a required field does not.
    expect(accepted / corpus.length).toBeGreaterThan(0.005);
    expect(accepted / corpus.length).toBeLessThan(0.995);
  });
});

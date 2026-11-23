/**
 * The four third-party utilities in the x402 Foundation's table (#403).
 *
 * The Foundation lists these beside the category PayStage is in, and a reader's first thought is
 * "someone else already does this". This data exists so the page can answer that with a documented
 * difference per row instead of leaving the reader to assume we are a later copy.
 *
 * The rule is the same as the wallet matrix: a claim about a tool comes from a page we opened, with
 * the read date attached, and a question their documentation does not answer is `unassessed` in the
 * copy — never an implied "no". The quotes and the longer notes are in
 * `/work/ops/docs/research/competitors.md`; this file is the short public form.
 */
export interface FoundationUtility {
  readonly name: string;
  readonly url: string;
  /** The date the linked page was read, ISO. */
  readonly readDate: string;
  /** What it does that we do not, in their words or a direct paraphrase. */
  readonly theirs: string;
  /** What we do that it does not; the unassessed part is stated in the sentence. */
  readonly ours: string;
}

export const FOUNDATION_UTILITIES: readonly FoundationUtility[] = [
  {
    name: "AffixIO",
    url: "https://github.com/AffixIO/SDK",
    readDate: "2026-11-24",
    theirs:
      "A policy gate over tool calls, with an HMAC or UltraHonk proof in an ML-DSA-65 signed envelope, durable spend reservations and a human-approval step.",
    ours:
      "An x402 challenge verdict that names the rule and screens the payee against public OFAC and known-drainer lists. Whether AffixIO screens those lists is unassessed: its docs describe configured checks, not list screening.",
  },
  {
    name: "Tanilo x402 Guard",
    url: "https://tanilo.io/docs/x402-guard",
    readDate: "2026-11-24",
    theirs:
      "Matches the offered price to the buyer's own contract terms and enforces a spend cap from the caller's alreadySpent value, under published rules with CC0 test vectors.",
    ours:
      "A default-deny verdict on the challenge itself, without a per-resource terms entry, and a payee screen against public OFAC and known-drainer lists. Whether Tanilo screens those lists is unassessed: its docs list contract terms, not list screening.",
  },
  {
    name: "Hosannaith",
    url: "https://hosannaith.com",
    readDate: "2026-11-24",
    theirs:
      "Probes endpoints continuously and sells uptime, correct-402 and latency scores from accumulated history, with signed ES256 results.",
    ours:
      "A decision on the payment in front of the agent, before the signature exists, with the rule that fired and a signed receipt. We run no probe fleet and publish no uptime score.",
  },
  {
    name: "Teppi",
    url: "https://teppi.xyz",
    readDate: "2026-11-24",
    theirs:
      "Pays for calls itself, keeps the responses and grades delivery, with scorecards, signed receipts and optional pay-on-delivery.",
    ours:
      "A gate that does not buy the call or hold the seller's price, plus a payee screen against public OFAC and known-drainer lists. Whether Teppi screens those lists is unassessed: its docs describe delivery grading, not list screening.",
  },
];

/** The Foundation table these rows were read from. */
export const FOUNDATION_TABLE_URL =
  "https://github.com/x402-foundation/x402/blob/main/docs/dev-tools/third-party-extensions.md";

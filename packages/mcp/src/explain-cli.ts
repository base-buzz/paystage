#!/usr/bin/env node
/**
 * `paystage-explain <receipt.json>` — turn a receipt's machine reasons into sentences.
 *
 * A receipt says *what* was decided and cites the rules. It is written for machines, and the person
 * holding it is usually not the one who wrote the policy: "amount 1 USDC exceeds max_amount 0.05 USDC"
 * is precise and still takes a second pass to read. This prints one sentence per reason, verifies the
 * signature first, and says plainly when the receipt cannot be trusted.
 *
 *   paystage-explain receipt.json          # human output
 *   paystage-explain --json receipt.json   # machine output
 */
import { readFileSync } from "node:fs";
import { verifyReceipt, type ReceiptLike } from "./verify.js";

const args = process.argv.slice(2);
const asJson = args.includes("--json");
const file = args.find((a) => !a.startsWith("-"));

if (!file) {
  console.error("usage: paystage-explain <receipt.json> [--json]");
  process.exit(2);
}

let receipt: ReceiptLike;
try {
  receipt = JSON.parse(readFileSync(file, "utf8")) as ReceiptLike;
} catch (err) {
  console.error(`cannot read ${file}: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
}

/**
 * One rule, one sentence. The patterns mirror what the evaluator emits — a reason this cannot translate
 * is printed as-is rather than paraphrased, because guessing at a refusal's meaning is worse than
 * quoting it.
 */
function humanise(reason: string): string {
  let m: RegExpMatchArray | null;

  if ((m = reason.match(/^amount (\S+) (\w+) exceeds max_amount (\S+) (\w+)$/))) {
    return `It asks for ${m[1]} ${m[2]}, and the policy allows at most ${m[3]} ${m[4]}.`;
  }
  if ((m = reason.match(/^network (\S+) not in allowed_networks$/))) {
    return `It settles on ${m[1]}, which the policy does not list as an allowed network.`;
  }
  if ((m = reason.match(/^asset (\S+) on (\S+) not in allowed_assets$/))) {
    return `The token ${m[1]} on ${m[2]} is not an asset the policy accepts — often a lookalike.`;
  }
  if ((m = reason.match(/^payTo (\S+) not in allowed_pay_to \((deny|review)\)$/))) {
    return m[2] === "deny"
      ? `The payee ${m[1]} is not on the allow-list, and the policy refuses unknown payees.`
      : `The payee ${m[1]} is not on the allow-list, so the policy asks a human to look before paying.`;
  }
  if (reason === "known drainer") {
    return "The payee is on the known-drainer list — a cited list of addresses that take funds without delivering.";
  }
  if ((m = reason.match(/^maxTimeoutSeconds (\d+) exceeds policy max_timeout_seconds (\d+)$/))) {
    return `The payment would stay valid for ${m[1]}s, longer than the ${m[2]}s the policy permits.`;
  }
  if ((m = reason.match(/^invalid atomic amount (\S*)$/))) {
    return `The amount is not a whole number of atomic units ("${m[1] ?? ""}"), so it cannot be priced safely.`;
  }
  return reason;
}

type VerdictView = { ok?: boolean; status: string; reason?: string };
const verdict: VerdictView = await verifyReceipt(receipt as never)
  .then((v) => v as VerdictView)
  .catch((err: unknown) => ({
    ok: false,
    status: "error",
    reason: err instanceof Error ? err.message : String(err),
  }));

const decision = receipt.verdict?.decision ?? "unknown";
const reasons = receipt.verdict?.reasons ?? [];

if (asJson) {
  console.log(JSON.stringify({ decision, reasons, sentences: reasons.map(humanise), verification: verdict }, null, 2));
  process.exit(0);
}

const trust =
  verdict.status === "signed-and-valid"
    ? "signature valid — this receipt is what PayStage issued"
    : verdict.status === "unsigned"
      ? "UNSIGNED — useful as a record of a decision, but it proves nothing about who made it"
      : `CANNOT BE TRUSTED — ${verdict.reason ?? verdict.status}`;

console.log(`Decision: ${decision}`);
console.log(`  ${trust}`);
if (receipt.issued_at) console.log(`  issued ${receipt.issued_at} by ${receipt.service?.name ?? "unknown"}`);
console.log("");

if (reasons.length === 0) {
  console.log("  No rules fired.");
} else {
  for (const r of reasons) console.log(`  · ${humanise(r)}`);
}

if (receipt.verdict?.summary) console.log(`\n  Summary: ${receipt.verdict.summary}`);
console.log("");

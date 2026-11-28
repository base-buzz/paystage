#!/usr/bin/env node
/**
 * `preflight demo` — the zero-spend local quickstart (#309).
 *
 * One bundled policy, a few bundled challenges, and the real `evaluatePayment` from `evaluate.ts`.
 * No fs read, no network, no env: the policy and the challenges are literals below, and the bin is
 * safe to run in a container with the network removed. The output names the rule that actually
 * fired, using the reason codes the evaluator already returns — the demo must not grow a second
 * vocabulary that can drift from the evaluator's.
 *
 * The verdicts are produced by evaluating against `DEMO_POLICY`; nothing here re-implements a rule.
 * `tests/demo.test.ts` asserts the three verdicts and the reason codes, so a change to the
 * evaluator that silently changes what the demo shows fails a test rather than a screenshot.
 */
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type AcceptOption,
  type Decision,
  type PaymentRequest,
} from "./evaluate.js";

/**
 * The package version shown in the demo.
 *
 * Deliberately a literal: reading package.json would be a filesystem access on the demo path, and
 * this bin promises none. `tests/demo.test.ts` compares it with the manifest, so a version bump
 * that forgets this line fails CI instead of printing a stale version forever.
 */
export const PREFLIGHT_VERSION = "0.6.1";

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ALLOWLISTED_PAYEE = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const UNKNOWN_PAYEE = "0x0000000000000000000000000000000000000001";
// From known-drainers.ts: MEW darklist, XRP phishing wallet.
const KNOWN_DRAINER_PAYEE = "0x09750ad360fdb7a2ee23669c4503c974d86d8694";
// From sanctioned-addresses.ts: OFAC SDN "Digital Currency Address - ETH" entry.
const SANCTIONED_PAYEE = "0x038989cbb1710c72b9920dc4fa529158f463e72c";

/**
 * The bundled policy: a small, realistic spending policy for an agent buying API calls.
 *
 * 1.00 USDC per payment, anything over 0.50 USDC needs a human, and a payee that is not on the
 * list is a review rather than a refusal. Defined here, not loaded, on purpose.
 */
export const DEMO_POLICY: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [ALLOWLISTED_PAYEE],
  allowed_assets: [
    {
      symbol: "USDC",
      decimals: 6,
      address: USDC_BASE,
      network: "eip155:8453",
    },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "review",
};

export interface DemoChallenge {
  id: string;
  /** One line for the reader: what this challenge is testing. */
  label: string;
  request: PaymentRequest;
}

function accept(amount: string, payTo: string): AcceptOption {
  return {
    scheme: "exact",
    network: "eip155:8453",
    amount,
    asset: USDC_BASE,
    payTo,
    maxTimeoutSeconds: 60,
  };
}

/**
 * Four challenges covering every verdict the evaluator can return.
 *
 * Amounts are atomic USDC (6 decimals): "50000" is 0.05 USDC.
 */
export const DEMO_CHALLENGES: readonly DemoChallenge[] = Object.freeze([
  {
    id: "allowlisted",
    label: "allowlisted payee, 0.05 USDC",
    request: { x402Version: 2, accepts: [accept("50000", ALLOWLISTED_PAYEE)] },
  },
  {
    id: "unknown-payee",
    label: "payee not on the allowlist, 0.01 USDC",
    request: { x402Version: 2, accepts: [accept("10000", UNKNOWN_PAYEE)] },
  },
  {
    id: "known-drainer",
    label: "known-drainer payee, 0.01 USDC",
    request: { x402Version: 2, accepts: [accept("10000", KNOWN_DRAINER_PAYEE)] },
  },
  {
    id: "sanctioned",
    label: "OFAC-sanctioned payee, 0.01 USDC",
    request: { x402Version: 2, accepts: [accept("10000", SANCTIONED_PAYEE)] },
  },
]);

export interface DemoResult {
  id: string;
  label: string;
  decision: Decision;
  /** The evaluator's own reason codes, in its own words. Empty when no rule fired. */
  reasons: string[];
  request: PaymentRequest;
}

/** Run every bundled challenge through the real evaluator. Pure: no output, no I/O. */
export function runDemo(): DemoResult[] {
  return DEMO_CHALLENGES.map((challenge) => {
    const result = evaluatePayment(challenge.request, DEMO_POLICY);
    return {
      id: challenge.id,
      label: challenge.label,
      decision: result.decision,
      reasons: result.reasons,
      request: challenge.request,
    };
  });
}

/** The rule line for one result. A `pay` has no firing rule — say so rather than invent one. */
export function ruleLine(result: DemoResult): string {
  return result.reasons.length > 0
    ? result.reasons.join("; ")
    : "none — every check in the bundled policy passed";
}

/** Render the whole demo as text. Kept separate from `main` so tests can assert it without a console. */
export function renderDemo(): string {
  const results = runDemo();
  const lines: string[] = [
    `@paystage/preflight ${PREFLIGHT_VERSION} — offline demo`,
    "Offline and free: bundled policy and challenges, no network, no keys, no spend.",
    "",
    "Policy (defined in this file): USDC on eip155:8453, max 1.00 per payment,",
    "human review above 0.50, payee not on the allowlist -> review.",
    "",
  ];

  results.forEach((result, index) => {
    lines.push(`${index + 1}. ${result.label}`);
    lines.push(`   verdict: ${result.decision}`);
    lines.push(`   rule: ${ruleLine(result)}`);
    lines.push("");
  });

  lines.push("Run the same evaluator on your own policy:");
  lines.push('  import { evaluatePayment } from "@paystage/preflight";');
  lines.push('  const policy = JSON.parse(await readFile("policy.json", "utf8"));');
  lines.push("  const result = evaluatePayment(paymentRequired, policy);");
  lines.push("  console.log(result.decision, result.reasons);");
  lines.push(
    "Or run it as an MCP tool: npx -y @paystage/preflight (needs @modelcontextprotocol/server)",
  );
  return lines.join("\n");
}

/** CLI entry. Prints only; never reads a file, the network, or the environment. */
export function main(): void {
  console.log(renderDemo());
}

const invokedPath = process.argv[1] ?? "";
const invokedDirectly = /[\\/](?:demo\.js|demo\.ts|preflight)$/.test(invokedPath);
if (invokedDirectly) {
  const args = process.argv.slice(2);
  const command = args[0] ?? "demo";
  if (command === "demo") {
    main();
  } else {
    console.error(`Unknown command: ${command}`);
    console.error("Usage: preflight demo   (no arguments, no network, no spend)");
    process.exit(2);
  }
}

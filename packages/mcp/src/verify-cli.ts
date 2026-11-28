#!/usr/bin/env node
/**
 * `paystage-verify <file|->` — check a PayStage receipt without trusting PayStage.
 *
 * Fetches the published key, verifies the signature over the canonical payload, and
 * prints one of five verdicts. Exit codes are listed below and in --help.
 * 3 unverifiable (could not check). Distinct codes so a script can tell "forged" from
 * "no key published yet" — collapsing those into one failure would overstate what we
 * know.
 */

import { readFile } from "node:fs/promises";
import {
  DEFAULT_KEY_URL,
  verifyReceipt,
  verifyReceiptChain,
  type ChainVerdict,
  type JwkLike,
  type ReceiptLike,
  type VerifyVerdict,
} from "./verify.js";

const EXIT: Record<VerifyVerdict["status"], number> = {
  "signed-and-valid": 0,
  invalid: 1,
  unsigned: 2,
  unverifiable: 3,
  // New and deliberately distinct: "the receipt is genuine but does not cover the inputs
  // you gave me" is not "this receipt is forged". A script needs to tell those apart.
  "inputs-mismatch": 4,
  // "Genuine but too old to act on" and "genuine but about a different payment" are both distinct from a
  // forgery, and both need their own exit code so a script can retry rather than alarm.
  expired: 5,
  "payment-mismatch": 6,
  // Genuine and coverable, but older than the bound the caller set. A third fact again:
  // "forged" (1), "could not check" (3), and "true but expired" (5).
  stale: 5,
};

function usage(): string {
  return [
    "paystage-verify — check a PayStage verdict receipt",
    "",
    "Usage:",
    "  paystage-verify <receipt.json>        verify a file",
    "  cat receipt.json | paystage-verify -  verify stdin",
    "  paystage-verify --chain <list>        verify a JSON array or JSONL chain and report the first gap",
    "",
    "Options:",
    "  --chain <path> walk a receipt list (JSON array or one JSON receipt per line)",
    "  --key <path>   verify against a local JWK instead of the published one",
    "  --key-url <u>  override the published key endpoint",
    "  --json         machine-readable output",
    "  --request <f>  check the receipt covers this request JSON",
    "  --policy <f>   check the receipt covers this policy JSON",
    "  --max-age <s>  reject a receipt older than this many seconds",
    "  --payment <f>  check the receipt was issued for this payment JSON",
    "",
    "Exit codes:",
    "  0 valid · 1 invalid · 2 unsigned · 3 unverifiable · 4 inputs-mismatch · 5 expired or stale",
    "  6 payment-mismatch · 8 chain-gap (a receipt is missing, reordered or starts mid-chain)",
    "  4 means the receipt is genuine but does not cover the inputs you supplied",
    "  5 means the receipt is genuine but past its own expires_at, or older than --max-age allows",
    "  6 means the receipt is genuine but was issued for a different payment",
    "  8 means the chain has a first gap; the gap names the receipts either side",
  ].join("\n");
}

/** A JSON array, a single receipt object, or one JSON receipt per line. */
function parseReceiptList(raw: string): ReceiptLike[] {
  const trimmed = raw.trim();
  if (trimmed.length === 0) throw new Error("file is empty");
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) return parsed as ReceiptLike[];
    if (parsed !== null && typeof parsed === "object") return [parsed as ReceiptLike];
    throw new Error("top-level JSON is not an object or array");
  } catch (error) {
    // Not one JSON document: try JSONL, but keep the original error when no line parses
    // either, so a malformed array does not get reported as "line 1".
    if (!(error instanceof SyntaxError)) throw error;
  }
  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 0);
  if (lines.length === 0) throw new Error("file is empty");
  return lines.map((line, index) => {
    try {
      return JSON.parse(line) as ReceiptLike;
    } catch {
      throw new Error(`line ${index + 1} is not valid JSON`);
    }
  });
}

function formatChain(chain: ChainVerdict): string {
  if (chain.status === "chain-valid") {
    const lines = [
      `CHAIN VALID — ${chain.count} receipt${chain.count === 1 ? "" : "s"}, head ${chain.head}, no gaps`,
      ...chain.receipts.map((r) => `  [${r.index}] ${r.id}`),
    ];
    if (!chain.anchored) lines.push(`  note: ${chain.note}`);
    return lines.join("\n");
  }
  if (chain.status === "chain-gap") {
    const previous = chain.previous === null ? "(none — this is the head)" : `[${chain.previous.index}] ${chain.previous.id}`;
    const lines = [
      `CHAIN GAP at receipt ${chain.index} — ${chain.reason}`,
      `  previous: ${previous}`,
      `  next:     [${chain.next.index}] ${chain.next.id}`,
      `  expected prev: ${chain.expected_prev}`,
      `  claimed prev:  ${chain.actual_prev ?? "(none)"}`,
    ];
    if (chain.missing_receipt_id !== undefined) lines.push(`  missing receipt id: ${chain.missing_receipt_id}`);
    return lines.join("\n");
  }
  if (chain.status === "chain-invalid") {
    return `CHAIN INVALID at receipt ${chain.index} — ${chain.reason}\n  receipt: ${chain.receipt.id}`;
  }
  return `CHAIN EMPTY — ${chain.reason}`;
}

function chainExitCode(chain: ChainVerdict): number {
  if (chain.status === "chain-valid") return 0;
  if (chain.status === "chain-gap" || chain.status === "chain-empty") return 8;
  if (chain.status === "chain-invalid") {
    if (chain.receipt_verdict.ok) return 1;
    return EXIT[chain.receipt_verdict.status];
  }
  return 1;
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function main(argv: string[]): Promise<number> {
  const args = argv.slice(2);
  if (args.length === 0 || args.includes("-h") || args.includes("--help")) {
    process.stdout.write(`${usage()}\n`);
    return args.length === 0 ? 1 : 0;
  }

  let source: string | undefined;
  let chainPath: string | undefined;
  let keyPath: string | undefined;
  let keyUrl: string | undefined;
  let asJson = false;
  let requestPath: string | undefined;
  let paymentPath: string | undefined;
  let policyPath: string | undefined;
  let maxAgeRaw: string | undefined;

  // One chain. The first version had standalone `if`s for the new flags followed by an
  // `else if` chain, so `--json` matched the first test and then fell through to the
  // positional branch — the flag was read as the receipt path.
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") asJson = true;
    else if (arg === "--request") requestPath = args[++i];
    else if (arg === "--payment") paymentPath = args[++i];
    else if (arg === "--policy") policyPath = args[++i];
    else if (arg === "--key") keyPath = args[++i];
    else if (arg === "--key-url") keyUrl = args[++i];
    else if (arg === "--max-age") maxAgeRaw = args[++i];
    else if (arg === "--chain") chainPath = args[++i];
    else if (arg !== undefined) source = arg;
  }

  if (source === undefined && chainPath === undefined) {
    process.stderr.write("paystage-verify: no receipt given\n");
    return 1;
  }
  if (source !== undefined && chainPath !== undefined) {
    process.stderr.write("paystage-verify: give either a receipt or --chain, not both\n");
    return 1;
  }

  const input = source ?? chainPath;
  let raw: string;
  try {
    raw = input === "-" ? await readStdin() : await readFile(input as string, "utf8");
  } catch (error) {
    process.stderr.write(
      `paystage-verify: cannot read ${input}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 3;
  }

  // --chain is a walk, not a set of input checks: --request/--policy/--payment compare one
  // receipt against one document, and silently applying them to every link would give a
  // confusing verdict. Say so rather than ignore the flags.
  if (chainPath !== undefined && (requestPath !== undefined || policyPath !== undefined || paymentPath !== undefined)) {
    process.stderr.write("paystage-verify: --request, --policy and --payment apply to a single receipt, not --chain\n");
    return 3;
  }

  if (chainPath !== undefined) {
    let receipts: ReceiptLike[];
    try {
      receipts = parseReceiptList(raw);
    } catch (error) {
      process.stderr.write(
        `paystage-verify: ${chainPath} is not a receipt list: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 1;
    }

    const chainOptions: Parameters<typeof verifyReceiptChain>[1] = {};
    if (keyPath !== undefined) {
      try {
        chainOptions.jwk = JSON.parse(await readFile(keyPath, "utf8")) as JwkLike;
      } catch (error) {
        process.stderr.write(
          `paystage-verify: cannot read key ${keyPath}: ${error instanceof Error ? error.message : String(error)}\n`,
        );
        return 3;
      }
    }
    if (keyUrl !== undefined) chainOptions.keyUrl = keyUrl;
    if (maxAgeRaw !== undefined) {
      const seconds = Number(maxAgeRaw);
      if (!Number.isFinite(seconds) || seconds < 0) {
        process.stderr.write(`paystage-verify: --max-age needs a number of seconds, got ${JSON.stringify(maxAgeRaw)}\n`);
        return 3;
      }
      chainOptions.maxAgeSeconds = seconds;
    }

    const chain = await verifyReceiptChain(receipts, chainOptions);
    if (asJson) {
      const sourceDetail = keyPath !== undefined ? `file:${keyPath}` : (keyUrl ?? DEFAULT_KEY_URL);
      process.stdout.write(`${JSON.stringify({ ...chain, key_source_detail: sourceDetail })}\n`);
    } else {
      process.stdout.write(`${formatChain(chain)}\n`);
    }
    return chainExitCode(chain);
  }

  let receipt: ReceiptLike;
  try {
    receipt = JSON.parse(raw) as ReceiptLike;
  } catch {
    process.stderr.write(`paystage-verify: ${input} is not valid JSON\n`);
    return 1;
  }

  const options: Parameters<typeof verifyReceipt>[1] = {};
  if (keyPath !== undefined) {
    try {
      options.jwk = JSON.parse(await readFile(keyPath, "utf8")) as JwkLike;
    } catch (error) {
      process.stderr.write(
        `paystage-verify: cannot read key ${keyPath}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      return 3;
    }
  }
  if (keyUrl !== undefined) options.keyUrl = keyUrl;

  // --request / --policy turn the stated digests into a checked claim. An unreadable file
  // is "could not check" (exit 3), never a pass and never a forgery verdict.
  const readJson = async (p: string): Promise<unknown> => {
    try {
      return JSON.parse(await readFile(p, "utf8")) as unknown;
    } catch (error) {
      process.stdout.write(
        `UNVERIFIABLE — could not read ${p}: ${error instanceof Error ? error.message : String(error)}\n`,
      );
      process.exit(3);
    }
  };
  if (requestPath !== undefined) options.expectedRequest = await readJson(requestPath);
  if (paymentPath !== undefined) {
    const payment = (await readJson(paymentPath)) as { payment?: Record<string, unknown> } & Record<string, unknown>;
    // Accept either a bare payment object or an evaluate-style body with a `payment` key, so a caller can
    // pipe the same file they sent to the endpoint.
    options.payment = (payment.payment ?? payment) as typeof options.payment;
  }
  if (policyPath !== undefined) options.expectedPolicy = await readJson(policyPath);
  if (maxAgeRaw !== undefined) {
    const seconds = Number(maxAgeRaw);
    if (!Number.isFinite(seconds) || seconds < 0) {
      process.stderr.write(`paystage-verify: --max-age needs a number of seconds, got ${JSON.stringify(maxAgeRaw)}\n`);
      return 3;
    }
    options.maxAgeSeconds = seconds;
  }

  const verdict: VerifyVerdict = await verifyReceipt(receipt, options);

  if (asJson) {
    // `key_source` says published-or-supplied; this says WHICH. A machine consumer that
    // cannot tell those apart can be handed a forged receipt and a matching key.
    const source = keyPath !== undefined ? `file:${keyPath}` : (keyUrl ?? DEFAULT_KEY_URL);
    process.stdout.write(`${JSON.stringify({ ...verdict, key_source_detail: source })}\n`);
  } else if (verdict.ok) {
    process.stdout.write(
      [
        "VALID — signature matches the payload",
        `  verdict:   ${verdict.verdict ?? "(none)"}`,
        `  issued_at: ${verdict.issued_at ?? "(none)"}`,
        `  key_id:    ${verdict.key_id ?? "(none)"}`,
        `  key source: ${keyPath ?? keyUrl ?? DEFAULT_KEY_URL}`,
      ].join("\n") + "\n",
    );
  } else {
    process.stdout.write(`${verdict.status.toUpperCase()} — ${verdict.reason}\n`);
  }

  return EXIT[verdict.status];
}

main(process.argv).then(
  (code) => process.exit(code),
  (error) => {
    process.stderr.write(`paystage-verify fatal: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(3);
  },
);

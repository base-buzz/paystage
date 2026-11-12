#!/usr/bin/env node
/**
 * `paystage-verify <file|->` — check a PayStage receipt without trusting PayStage.
 *
 * Fetches the published key, verifies the signature over the canonical payload, and
 * prints one of four verdicts. Exit codes: 0 valid, 1 invalid, 2 unsigned,
 * 3 unverifiable (could not check). Distinct codes so a script can tell "forged" from
 * "no key published yet" — collapsing those into one failure would overstate what we
 * know.
 */

import { readFile } from "node:fs/promises";
import { DEFAULT_KEY_URL, verifyReceipt, type JwkLike, type ReceiptLike, type VerifyVerdict } from "./verify.js";

const EXIT: Record<VerifyVerdict["status"], number> = {
  "signed-and-valid": 0,
  invalid: 1,
  unsigned: 2,
  unverifiable: 3,
  // New and deliberately distinct: "the receipt is genuine but does not cover the inputs
  // you gave me" is not "this receipt is forged". A script needs to tell those apart.
  "inputs-mismatch": 4,
};

function usage(): string {
  return [
    "paystage-verify — check a PayStage verdict receipt",
    "",
    "Usage:",
    "  paystage-verify <receipt.json>        verify a file",
    "  cat receipt.json | paystage-verify -  verify stdin",
    "",
    "Options:",
    "  --key <path>   verify against a local JWK instead of the published one",
    "  --key-url <u>  override the published key endpoint",
    "  --json         machine-readable output",
    "  --request <f>  check the receipt covers this request JSON",
    "  --policy <f>   check the receipt covers this policy JSON",
    "",
    "Exit codes: 0 valid · 1 invalid · 2 unsigned · 3 unverifiable",
  ].join("\n");
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
  let keyPath: string | undefined;
  let keyUrl: string | undefined;
  let asJson = false;
  let requestPath: string | undefined;
  let policyPath: string | undefined;

  // One chain. The first version had standalone `if`s for the new flags followed by an
  // `else if` chain, so `--json` matched the first test and then fell through to the
  // positional branch — the flag was read as the receipt path.
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--json") asJson = true;
    else if (arg === "--request") requestPath = args[++i];
    else if (arg === "--policy") policyPath = args[++i];
    else if (arg === "--key") keyPath = args[++i];
    else if (arg === "--key-url") keyUrl = args[++i];
    else if (arg !== undefined) source = arg;
  }

  if (source === undefined) {
    process.stderr.write("paystage-verify: no receipt given\n");
    return 1;
  }

  let raw: string;
  try {
    raw = source === "-" ? await readStdin() : await readFile(source, "utf8");
  } catch (error) {
    process.stderr.write(
      `paystage-verify: cannot read ${source}: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return 3;
  }

  let receipt: ReceiptLike;
  try {
    receipt = JSON.parse(raw) as ReceiptLike;
  } catch {
    process.stderr.write(`paystage-verify: ${source} is not valid JSON\n`);
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
  if (policyPath !== undefined) options.expectedPolicy = await readJson(policyPath);

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

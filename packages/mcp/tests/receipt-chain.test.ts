import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  buildReceipt,
  receiptDigest,
  RECEIPT_CHAIN_GENESIS,
  type Receipt,
} from "../../../apps/hosted/src/receipt.js";
import { receiptChainId, verifyReceipt, verifyReceiptChain } from "../src/verify.js";

async function keypair() {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  const b64 = Buffer.from(new Uint8Array(pkcs8)).toString("base64");
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as JsonWebKey;
  return { b64, jwk: jwk as never };
}

/**
 * Build a chain the way a stateful issuer would: the first receipt names genesis, every later
 * one names the digest of the receipt immediately before it. Nothing about this ordering is
 * inferred by the verifier — the links are in the signed payloads.
 */
async function chainOf(count: number) {
  const { b64, jwk } = await keypair();
  const receipts: Receipt[] = [];
  for (let index = 0; index < count; index += 1) {
    const prev = index === 0 ? RECEIPT_CHAIN_GENESIS : await receiptDigest(receipts[index - 1]);
    receipts.push(
      await buildReceipt({
        decision: { decision: "pay", reasons: [] },
        request: { sequence: index },
        policy: { version: 1 },
        signingKeyPkcs8B64: b64,
        prev,
        ttlSeconds: 0,
        now: new Date(Date.UTC(2026, 10, 20, 0, 0, index)),
      }),
    );
  }
  return { receipts, jwk, b64 };
}

describe("receipt hash chain (#171)", () => {
  it("verifies a chain of three receipts", async () => {
    const { receipts, jwk } = await chainOf(3);
    const result = await verifyReceiptChain(receipts, { jwk });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("chain-valid");
      expect(result.count).toBe(3);
      expect(result.head).toBe("genesis");
      expect(result.anchored).toBe(true);
      // Three distinct payloads, so three distinct ids: a bug that hashed only the signature
      // or reused the first id would not produce this.
      expect(new Set(result.receipts.map((r) => r.id)).size).toBe(3);
    }
  });

  it("detects and names a deleted receipt in the middle", async () => {
    const { receipts, jwk } = await chainOf(3);
    const [first, middle, last] = receipts;
    const result = await verifyReceiptChain([first, last], { jwk });

    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "chain-gap") {
      expect(result.index).toBe(1);
      // Both sides are named, and the missing receipt is identified by the hash the next
      // receipt claims — not merely by "a gap exists".
      expect(result.previous?.id).toBe(await receiptChainId(first));
      expect(result.next.id).toBe(await receiptChainId(last));
      expect(result.missing_receipt_id).toBe(await receiptChainId(middle));
      expect(result.actual_prev).toBe(await receiptChainId(middle));
      expect(result.expected_prev).toBe(await receiptChainId(first));
    } else {
      throw new Error(`expected chain-gap, got ${JSON.stringify(result)}`);
    }
  });

  it("detects two receipts put in the wrong order", async () => {
    const { receipts, jwk } = await chainOf(3);
    const [first, middle, last] = receipts;
    // Swapping the last two keeps every signature valid; only the links disagree.
    const result = await verifyReceiptChain([first, last, middle], { jwk });

    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "chain-gap") {
      expect(result.index).toBe(1);
      expect(result.previous?.id).toBe(await receiptChainId(first));
      expect(result.next.id).toBe(await receiptChainId(last));
      expect(result.actual_prev).toBe(await receiptChainId(middle));
    } else {
      throw new Error(`expected chain-gap, got ${JSON.stringify(result)}`);
    }
  });

  it("still reports a lone receipt as VALID", async () => {
    const { receipts, jwk } = await chainOf(1);
    const result = await verifyReceipt(receipts[0], { jwk });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.status).toBe("signed-and-valid");
      expect(result.verdict).toBe("pay");
    }
  });

  it("refuses a receipt whose prev was tampered with", async () => {
    const { receipts, jwk } = await chainOf(2);
    const tampered = { ...receipts[1], prev: "f".repeat(64) };
    const single = await verifyReceipt(tampered, { jwk });
    expect(single.ok).toBe(false);
    if (!single.ok) expect(single.status).toBe("invalid");

    const result = await verifyReceiptChain([receipts[0], tampered], { jwk });
    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "chain-invalid") {
      expect(result.index).toBe(1);
      expect(result.receipt.id).toBe(await receiptChainId(tampered));
      if (!result.receipt_verdict.ok) expect(result.receipt_verdict.status).toBe("invalid");
    } else {
      throw new Error(`expected chain-invalid, got ${JSON.stringify(result)}`);
    }
  });
});

describe("pre-chain receipts", () => {
  it("treats a missing prev as pre-chain, never as invalid", async () => {
    const { b64, jwk } = await keypair();
    // An old-format receipt: no prev at all.
    const old = await buildReceipt({
      decision: { decision: "do_not_pay", reasons: [] },
      request: {},
      policy: {},
      signingKeyPkcs8B64: b64,
      ttlSeconds: 0,
    });
    const next = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: {},
      policy: {},
      signingKeyPkcs8B64: b64,
      prev: await receiptDigest(old),
      ttlSeconds: 0,
    });

    // Alone, it is still a valid receipt.
    const single = await verifyReceipt(old, { jwk });
    expect(single.ok).toBe(true);

    // In a chain it is an unanchored head — links from it onward are proved, what came
    // before it is not. That is a valid chain, not a broken one.
    const chained = await verifyReceiptChain([old, next], { jwk });
    expect(chained.ok).toBe(true);
    if (chained.ok) {
      expect(chained.head).toBe("pre-chain");
      expect(chained.anchored).toBe(false);
    }
  });

  it("does not treat a missing prev in the middle of a chain as pre-chain", async () => {
    const { receipts, jwk, b64 } = await chainOf(1);
    // A validly signed receipt that predates chaining, placed after a chained one.
    const unchained = await buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: { sequence: 99 },
      policy: { version: 1 },
      signingKeyPkcs8B64: b64,
      ttlSeconds: 0,
    });
    const result = await verifyReceiptChain([receipts[0], unchained], { jwk });
    expect(result.ok).toBe(false);
    if (!result.ok && result.status === "chain-gap") {
      expect(result.index).toBe(1);
      expect(result.actual_prev).toBeNull();
    } else {
      throw new Error(`expected chain-gap, got ${JSON.stringify(result)}`);
    }
  });
});

describe("issuer/verifier chain-id parity", () => {
  it("hashes the same payload bytes on both sides", async () => {
    const { receipts } = await chainOf(1);
    expect(await receiptChainId(receipts[0])).toBe(await receiptDigest(receipts[0]));
  });
});

describe("verify-cli --chain", () => {
  it("walks a JSON array, then reports a deleted middle receipt with exit 8", async () => {
    const { receipts, jwk } = await chainOf(3);
    const dir = await mkdtemp(join(tmpdir(), "verify-chain-"));
    const keyPath = join(dir, "key.json");
    const chainPath = join(dir, "chain.json");
    await writeFile(keyPath, JSON.stringify(jwk));
    await writeFile(chainPath, JSON.stringify(receipts));

    const exec = promisify(execFile);
    const valid = await exec(process.execPath, [
      "dist/verify-cli.js",
      "--chain",
      chainPath,
      "--key",
      keyPath,
      "--json",
    ]);
    expect(JSON.parse(valid.stdout).status).toBe("chain-valid");

    // Delete the middle receipt; the remaining two are both individually valid.
    await writeFile(chainPath, JSON.stringify([receipts[0], receipts[2]]));
    let gap: { code?: number; stdout?: string } | undefined;
    try {
      await exec(process.execPath, ["dist/verify-cli.js", "--chain", chainPath, "--key", keyPath, "--json"]);
    } catch (error) {
      gap = error as { code?: number; stdout?: string };
    }
    expect(gap?.code).toBe(8);
    const parsed = JSON.parse(String(gap?.stdout ?? "{}")) as { status?: string; index?: number };
    expect(parsed.status).toBe("chain-gap");
    expect(parsed.index).toBe(1);
  });
});

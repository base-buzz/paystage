import { describe, expect, it } from "vitest";
import { hashTypedData, verifyTypedData } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import type { ReceiptLike } from "@paystage/receipt-verify";
import { paymentTermsDigest } from "@paystage/preflight";
// #443: the digest_mismatch case must run against a receipt the deployed receipt builder produces,
// not a hand-written stub. Importing the builder keeps this test honest when the receipt changes.
import { buildReceipt } from "../../../apps/hosted/src/receipt.js";
import {
  createSignerGuard,
  paymentDigest,
  paymentFromTypedData,
  SignerRefusedError,
  type PaymentAuthorization,
  type SignerTypedData,
  type TypedDataSigner,
} from "../src/signer.js";

/**
 * Offline tests: the signer is a throwaway viem local account, the receipt key is generated in
 * process and the gate is a function. Nothing here touches the network or a real key.
 */

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const PAY_TO = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";
const ACCOUNT = privateKeyToAccount(`0x${"11".repeat(32)}`);
const NOW = "2026-11-25T12:00:00.000Z";

function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(",")}}`;
}

function base64Url(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function keypair(kid = "paystage-receipt-v1") {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>;
  const pkcs8 = (await crypto.subtle.exportKey("pkcs8", pair.privateKey)) as ArrayBuffer;
  return {
    privateKey: pair.privateKey,
    b64: Buffer.from(new Uint8Array(pkcs8)).toString("base64"),
    jwk: { ...jwk, kid, use: "sig", alg: "ES256" },
  };
}

type Pair = Awaited<ReturnType<typeof keypair>>;

function receiptBody(
  payment: PaymentAuthorization,
  digest: string,
  decision: "pay" | "review" | "do_not_pay",
  reasons: string[],
): ReceiptLike {
  return {
    v: 1,
    issuer: "paystage",
    issued_at: NOW,
    payment: {
      scheme: payment.scheme,
      network: payment.network,
      asset: payment.asset,
      amount: payment.amount,
      payee: payment.payTo,
    },
    service: { name: "@paystage/hosted", version: "test" },
    verdict: { decision, reasons, summary: `Decision: ${decision}.` },
    // `request_sha256` keeps its spec meaning (the canonical evaluation request); the adapter's
    // binding lives in the new signed `payment_digest` field.
    request_sha256: "c".repeat(64),
    payment_digest: digest,
    policy_sha256: "b".repeat(64),
  };
}

async function issue(
  body: ReceiptLike,
  pair: Pair,
  kid = "paystage-receipt-v1",
): Promise<ReceiptLike> {
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    pair.privateKey,
    new TextEncoder().encode(canonical(body)),
  );
  return { ...body, signed: true, alg: "ECDSA-P256-SHA256", key_id: kid, signature: base64Url(signature) };
}

function typedData(amount: bigint): SignerTypedData {
  return {
    domain: { name: "USD Coin", version: "2", chainId: 8453, verifyingContract: USDC },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      from: ACCOUNT.address,
      to: PAY_TO,
      value: amount,
      validAfter: 0n,
      validBefore: 1_800_000_000n,
      nonce: `0x${"ab".repeat(32)}`,
    },
  };
}

/** The five terms the gate can see, from the typed data the adapter will sign. */
function termsOf(data: SignerTypedData) {
  const payment = paymentFromTypedData(data);
  return {
    scheme: payment.scheme,
    network: payment.network,
    asset: payment.asset,
    amount: payment.amount,
    payee: payment.payTo,
  };
}

/** A signer that records whether a signature was produced; the refusals must leave this at zero. */
function countingSigner() {
  let signatures = 0;
  const account: TypedDataSigner & { address: string } = {
    address: ACCOUNT.address,
    async signTypedData() {
      signatures += 1;
      return "0xsigned";
    },
  };
  return { account, signatures: () => signatures };
}

describe("@paystage/x402-guard/signer", () => {
  it("signs a conforming payment with a local viem account, after verifying a pay receipt", async () => {
    const pair = await keypair();
    const seen: Array<{ digest: string; amount: string }> = [];
    const gate = async (request: { payment: PaymentAuthorization; digest: string }) => {
      seen.push({ digest: request.digest, amount: request.payment.amount });
      const body = receiptBody(request.payment, request.digest, "pay", []);
      return { receipt: await issue(body, pair) };
    };
    const guarded = createSignerGuard(ACCOUNT as unknown as TypedDataSigner, {
      gate,
      jwk: pair.jwk,
    });

    const data = typedData(50_000n); // 0.05 USDC at 6 decimals
    const signature = await guarded.signTypedData(data);

    // The wrapped object still looks like the account @x402/evm expects (address beside the signer).
    expect((guarded as unknown as { address?: string }).address).toBe(ACCOUNT.address);

    expect(seen).toHaveLength(1);
    // #443: the adapter's binding is the payment-terms digest the gate can also compute, not the
    // EIP-712 digest (which needs the nonce/payer/validity fields the receipt cannot know).
    expect(seen[0].digest).toBe(await paymentTermsDigest(termsOf(data)));
    expect(seen[0].digest).not.toBe(paymentDigest(data));
    expect(seen[0].digest).toHaveLength(64);
    expect(seen[0].amount).toBe("50000");
    // The real account signed the exact typed data, not a re-encoded copy.
    const valid = await verifyTypedData({
      address: ACCOUNT.address,
      domain: data.domain,
      types: data.types,
      primaryType: data.primaryType,
      message: data.message,
      signature: signature as `0x${string}`,
    } as never);
    expect(valid).toBe(true);
  });

  it("refuses do_not_pay and names the rule; no signature is produced", async () => {
    const pair = await keypair();
    const { account, signatures } = countingSigner();
    const rule = "amount 50000 exceeds max_amount 0.05 USDC";
    const gate = async (request: { payment: PaymentAuthorization; digest: string }) => {
      const body = receiptBody(request.payment, request.digest, "do_not_pay", [rule]);
      return { receipt: await issue(body, pair) };
    };
    const guarded = createSignerGuard(account, { gate, jwk: pair.jwk });

    const error = await guarded.signTypedData(typedData(50_000n)).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SignerRefusedError);
    expect((error as SignerRefusedError).code).toBe("do_not_pay");
    expect((error as SignerRefusedError).rule).toBe(rule);
    expect((error as Error).message).toContain(rule);
    expect((error as Error).message).toMatch(/do_not_pay \(rule:/);
    expect(signatures()).toBe(0);
  });

  it("fails closed when the gate is unreachable, malformed, or times out", async () => {
    const pair = await keypair();
    const { account, signatures } = countingSigner();
    const data = typedData(50_000n);

    const unreachable = createSignerGuard(account, {
      gate: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:443");
      },
      jwk: pair.jwk,
    });
    const error = await unreachable.signTypedData(data).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SignerRefusedError);
    expect((error as SignerRefusedError).code).toBe("gate_unreachable");
    expect((error as Error).message).toContain("gate unreachable");
    expect((error as Error).message).toContain("a gate you cannot reach is not an approval");

    // A 200 with a body we cannot read is the same absence of a verdict.
    const malformed = createSignerGuard(account, {
      gate: async () => ({}) as never,
      jwk: pair.jwk,
    });
    const malformedError = await malformed.signTypedData(data).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect((malformedError as SignerRefusedError).code).toBe("gate_unreachable");

    // And so is a gate that never answers.
    const timedOut = createSignerGuard(account, {
      gate: () => new Promise(() => {}),
      timeoutMs: 25,
      jwk: pair.jwk,
    });
    const timeoutError = await timedOut.signTypedData(data).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect((timeoutError as SignerRefusedError).code).toBe("gate_unreachable");
    expect((timeoutError as Error).message).toContain("did not answer within 25ms");

    expect(signatures()).toBe(0);
  });

  it("catches a challenge swapped after the verdict was issued (approve digest A, sign digest B)", async () => {
    const pair = await keypair();
    const { account, signatures } = countingSigner();

    const approved = typedData(50_000n); // 0.05 approved
    const swapped = typedData(5_000_000n); // 5.00 attempted
    const approvedDigest = await paymentTermsDigest(termsOf(approved));
    const swappedDigest = await paymentTermsDigest(termsOf(swapped));
    expect(approvedDigest).not.toBe(swappedDigest);

    // The gate approved digest A earlier; it does not re-evaluate. This is the replay shape:
    // a verdict for the cheap payment presented at the signing of the expensive one.
    const approvedPayment = paymentFromTypedData(approved);
    const stale = await issue(receiptBody(approvedPayment, approvedDigest, "pay", []), pair);
    const gate = async () => ({ receipt: stale });
    const guarded = createSignerGuard(account, { gate, jwk: pair.jwk });

    const error = await guarded.signTypedData(swapped).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SignerRefusedError);
    expect((error as SignerRefusedError).code).toBe("digest_mismatch");
    expect((error as SignerRefusedError).coveredDigest).toBe(approvedDigest);
    expect((error as SignerRefusedError).signingDigest).toBe(swappedDigest);
    expect((error as Error).message).toContain(approvedDigest);
    expect((error as Error).message).toContain(swappedDigest);
    expect(signatures()).toBe(0);
  });

  it("keeps hashTypedData available as a diagnostic, distinct from the receipt binding", async () => {
    const data = typedData(50_000n);
    expect(paymentDigest(data)).toBe(hashTypedData(data as never).slice(2).toLowerCase());
    const terms = paymentFromTypedData(data);
    expect(terms).toMatchObject({
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC,
      payTo: PAY_TO,
      amount: "50000",
      from: ACCOUNT.address,
    });
    // #443: these are deliberately different values. The receipt cannot carry the EIP-712 digest
    // because the gate never sees the nonce/payer/validity fields it covers.
    const termsDigest = await paymentTermsDigest({
      scheme: terms.scheme,
      network: terms.network,
      asset: terms.asset,
      amount: terms.amount,
      payee: terms.payTo,
    });
    expect(termsDigest).not.toBe(paymentDigest(data));
  });

  /**
   * #443: the gate's receipt must come from the real builder, not a hand-written fixture. These two
   * cases are the end-to-end contract: a receipt built for the terms being signed is accepted, and a
   * builder receipt for a different amount is refused as `digest_mismatch`.
   */
  async function builtReceipt(pair: Pair, amount: bigint): Promise<ReceiptLike> {
    const payment = paymentFromTypedData(typedData(amount));
    return buildReceipt({
      decision: { decision: "pay", reasons: [] },
      request: { x402Version: 2, accepts: [{ ...payment, payTo: payment.payTo, maxTimeoutSeconds: 300 }] },
      policy: { version: 1 },
      payment: {
        scheme: payment.scheme,
        network: payment.network,
        asset: payment.asset,
        amount: payment.amount,
        payee: payment.payTo,
      },
      signingKeyPkcs8B64: pair.b64,
      ttlSeconds: 0,
      now: new Date(NOW),
      serviceVersion: "test",
    });
  }

  it("signs against a receipt produced by the hosted receipt builder", async () => {
    const pair = await keypair();
    const { account, signatures } = countingSigner();
    const receipt = await builtReceipt(pair, 50_000n);
    expect(receipt.payment_digest).toBe(
      await paymentTermsDigest(termsOf(typedData(50_000n))),
    );

    const guarded = createSignerGuard(account, {
      gate: async () => ({ receipt }),
      jwk: pair.jwk,
    });
    await expect(guarded.signTypedData(typedData(50_000n))).resolves.toBe("0xsigned");
    expect(signatures()).toBe(1);
  });

  it("refuses digest_mismatch against a builder receipt for a different amount", async () => {
    const pair = await keypair();
    const { account, signatures } = countingSigner();
    const receipt = await builtReceipt(pair, 50_000n);

    const guarded = createSignerGuard(account, {
      gate: async () => ({ receipt }),
      jwk: pair.jwk,
    });
    const error = await guarded.signTypedData(typedData(5_000_000n)).then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SignerRefusedError);
    expect((error as SignerRefusedError).code).toBe("digest_mismatch");
    expect((error as SignerRefusedError).coveredDigest).toBe(receipt.payment_digest);
    expect((error as SignerRefusedError).signingDigest).toBe(
      await paymentTermsDigest(termsOf(typedData(5_000_000n))),
    );
    expect(signatures()).toBe(0);
  });
});

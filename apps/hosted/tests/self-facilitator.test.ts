import { randomBytes } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import type { FacilitatorEvmSigner } from "@x402/evm";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";
import {
  USDC_BY_NETWORK,
  createSelfFacilitator,
  paymentIdentifier,
  usdToAtomic,
} from "../src/self-facilitator.js";

/**
 * Unit tests for the facilitator adapter. No network, no gas key, no mainnet: a stub signer
 * implements the package's `FacilitatorEvmSigner` contract, and the payment payload is a real
 * EIP-3009 signature made by a throwaway test account. That is enough to exercise the same
 * scheme code the live facilitator runs.
 */

const NETWORK = "eip155:84532";
const CHAIN_ID = 84532;
const USDC = USDC_BY_NETWORK[NETWORK] as string;
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const OTHER = "0x1111111111111111111111111111111111111111";
const GAS = "0x000000000000000000000000000000000000dEaD";
const TX = `0x${"ab".repeat(32)}` as `0x${string}`;

// A public, synthetic test key. It holds nothing on any network.
const payer = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);

function requirements(overrides: Partial<PaymentRequirements> = {}): PaymentRequirements {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: USDC,
    amount: "2000",
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    extra: { name: "USDC", version: "2" },
    ...overrides,
  } as PaymentRequirements;
}

interface PayloadOverrides {
  requirements?: PaymentRequirements;
  value?: string;
  to?: string;
  validBefore?: number;
  validAfter?: number;
  signatureOverride?: `0x${string}`;
  payerAccount?: typeof payer;
}

async function signedPayload(overrides: PayloadOverrides = {}): Promise<PaymentPayload> {
  const req = overrides.requirements ?? requirements();
  const value = overrides.value ?? "2000";
  const to = overrides.to ?? req.payTo;
  const from = overrides.payerAccount ?? payer;
  const now = Math.floor(Date.now() / 1000);
  const validAfter = overrides.validAfter ?? 0;
  const validBefore = overrides.validBefore ?? now + 300;
  const nonce = `0x${randomBytes(32).toString("hex")}` as `0x${string}`;

  const signature =
    overrides.signatureOverride ??
    (await from.signTypedData({
      domain: { name: "USDC", version: "2", chainId: CHAIN_ID, verifyingContract: USDC as `0x${string}` },
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
        from: from.address,
        to: to as `0x${string}`,
        value: BigInt(value),
        validAfter: BigInt(validAfter),
        validBefore: BigInt(validBefore),
        nonce,
      },
    }));

  return {
    x402Version: 2,
    accepted: req,
    payload: {
      authorization: {
        from: from.address,
        to,
        value,
        validAfter: String(validAfter),
        validBefore: String(validBefore),
        nonce,
      },
      signature,
    },
  };
}

function makeSigner(options: { failWrite?: boolean } = {}) {
  const calls = { write: 0, send: 0, wait: 0 };
  const writeContract = vi.fn(async () => {
    calls.write += 1;
    if (options.failWrite) throw new Error("rpc exploded at https://provider.example/?key=do-not-return");
    return TX;
  });
  const sendTransaction = vi.fn(async () => {
    calls.send += 1;
    return TX;
  });
  const waitForTransactionReceipt = vi.fn(async () => {
    calls.wait += 1;
    return { status: "success" };
  });
  const signer: FacilitatorEvmSigner = {
    getAddresses: () => [GAS],
    readContract: async () => 0n,
    verifyTypedData: async () => true,
    writeContract,
    sendTransaction,
    waitForTransactionReceipt,
    // The asset is a contract; the payer is an EOA. The scheme uses this to pick the
    // signature-check path, so returning the wrong shape here would test the wrong branch.
    getCode: async ({ address }) =>
      address.toLowerCase() === payer.address.toLowerCase() ? undefined : "0x6000",
  };
  return { signer, calls, writeContract, waitForTransactionReceipt };
}

function clientWith(signer: FacilitatorEvmSigner) {
  return createSelfFacilitator({
    signer,
    policy: { payTo: PAY_TO, network: NETWORK, asset: USDC, minimumAmount: "2000" },
  });
}

describe("usdToAtomic", () => {
  it("turns the route price into six-decimal atomic units", () => {
    expect(usdToAtomic("$0.002")).toBe("2000");
    expect(usdToAtomic("0.05")).toBe("50000");
    expect(usdToAtomic("1")).toBe("1000000");
  });

  it("returns zero for an unparseable price rather than inventing a floor", () => {
    expect(usdToAtomic("free")).toBe("0");
    expect(usdToAtomic("$0.002 USDC")).toBe("0");
  });
});

describe("verify", () => {
  it("accepts a valid payload and reports the payer", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const result = await client.verify(await signedPayload(), requirements());
    expect(result.isValid).toBe(true);
    expect(result.payer?.toLowerCase()).toBe(payer.address.toLowerCase());
  });

  it("rejects a tampered signature with invalid_signature", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const payload = await signedPayload();
    const signature = payload.payload.signature as string;
    // Change an r byte, not the trailing v byte: a v of 0 is accepted as parity 0 by some
    // recover implementations and would recover the same signer, which would make this test
    // pass without testing anything.
    const tampered = `${signature.slice(0, 2)}${signature[2] === "0" ? "1" : "0"}${signature.slice(3)}`;
    const result = await client.verify(
      { ...payload, payload: { ...payload.payload, signature: tampered } },
      requirements(),
    );
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("invalid_signature");
  });

  it("rejects a payload paid to someone else with wrong_payee", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const req = requirements();
    const payload = await signedPayload({ requirements: req, to: OTHER });
    const result = await client.verify(payload, req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("wrong_payee");
  });

  it("rejects an authorization below the required amount with insufficient", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const req = requirements();
    const payload = await signedPayload({ requirements: req, value: "1000" });
    const result = await client.verify(payload, req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("insufficient");
  });

  it("rejects an authorization above an exact requirement with wrong_amount", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const req = requirements();
    const payload = await signedPayload({ requirements: req, value: "3000" });
    const result = await client.verify(payload, req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("wrong_amount");
  });

  it("rejects an expired deadline with expired", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const now = Math.floor(Date.now() / 1000);
    const payload = await signedPayload({ validBefore: now - 10 });
    const result = await client.verify(payload, requirements());
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("expired");
  });

  it("rejects a payload for another network with wrong_network", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const req = requirements({ network: "eip155:8453" });
    const payload = await signedPayload({ requirements: req });
    const result = await client.verify(payload, req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("wrong_network");
  });

  it("rejects a different token with wrong_asset", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const req = requirements({ asset: OTHER });
    const payload = await signedPayload({ requirements: req });
    const result = await client.verify(payload, req);
    expect(result.isValid).toBe(false);
    expect(result.invalidReason).toBe("wrong_asset");
  });
});

describe("settle", () => {
  it("returns the transaction hash from one settlement", async () => {
    const { signer, calls } = makeSigner();
    const client = clientWith(signer);
    const req = requirements();
    const result = await client.settle(await signedPayload({ requirements: req }), req);
    expect(result.success).toBe(true);
    expect(result.transaction).toBe(TX);
    expect(result.network).toBe(NETWORK);
    expect(result.payer?.toLowerCase()).toBe(payer.address.toLowerCase());
    expect(calls.write).toBe(1);
  });

  it("settles the same payment id once and returns the first hash on a repeat", async () => {
    const { signer, calls } = makeSigner();
    const client = clientWith(signer);
    const req = requirements();
    const payload = await signedPayload({ requirements: req });
    payload.extensions = {
      "payment-identifier": { info: { required: false, id: "pay_test_0000000001" } },
    };
    expect(paymentIdentifier(payload)).toBe("pay_test_0000000001");

    const first = await client.settle(payload, req);
    const second = await client.settle(payload, req);

    expect(first.success).toBe(true);
    expect(second.success).toBe(true);
    expect(second.transaction).toBe(first.transaction);
    expect(calls.write).toBe(1);
  });

  it("does not deduplicate two different payment ids", async () => {
    const { signer, calls } = makeSigner();
    const client = clientWith(signer);
    const req = requirements();
    const a = await signedPayload({ requirements: req });
    const b = await signedPayload({ requirements: req });
    a.extensions = { "payment-identifier": { info: { required: false, id: "pay_test_0000000002" } } };
    b.extensions = { "payment-identifier": { info: { required: false, id: "pay_test_0000000003" } } };
    await client.settle(a, req);
    await client.settle(b, req);
    expect(calls.write).toBe(2);
  });

  it("returns success:false with a reason instead of throwing when settlement fails", async () => {
    const { signer } = makeSigner({ failWrite: true });
    const client = clientWith(signer);
    const req = requirements();
    const result = await client.settle(await signedPayload({ requirements: req }), req);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("settlement_failed");
    expect(result.transaction).toBe("");
    // The provider URL in the thrown error must not reach the caller.
    expect(JSON.stringify(result)).not.toContain("provider.example");
  });

  it("refuses to settle to a payee that is not ours", async () => {
    const { signer, calls } = makeSigner();
    const client = clientWith(signer);
    const req = requirements({ payTo: OTHER });
    const payload = await signedPayload({ requirements: req, to: OTHER });
    const result = await client.settle(payload, req);
    expect(result.success).toBe(false);
    expect(result.errorReason).toBe("wrong_payee");
    expect(calls.write).toBe(0);
  });
});

describe("getSupported", () => {
  it("advertises the registered network and the gas address", async () => {
    const { signer } = makeSigner();
    const client = clientWith(signer);
    const supported = await client.getSupported();
    expect(supported.kinds).toEqual([
      expect.objectContaining({ x402Version: 2, scheme: "exact", network: NETWORK }),
    ]);
    expect(supported.signers["eip155:*"]).toEqual([GAS]);
  });
});

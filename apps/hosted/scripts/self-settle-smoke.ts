/**
 * One real settlement through the self facilitator, for the runbook's "is it settling?" step.
 *
 * Testnet (eip155:84532) uses the faucet wallet for both roles, because that is the funded
 * Sepolia account this repo already has. Mainnet (eip155:8453) uses the dedicated gas wallet
 * (`FACILITATOR_GAS_PRIVATE_KEY`, gas only) and the loadgen payer key (`LOADGEN_KEY_1`).
 *
 * Usage, with secrets injected by the wrapper (never exported by hand):
 *
 *   # Base Sepolia
 *   PAYSTAGE_NETWORK=eip155:84532 PAYSTAGE_PAYTO=0x… \
 *     /work/ops/bin/with-secret faucet npx vite-node apps/hosted/scripts/self-settle-smoke.ts
 *
 *   # Base mainnet — one transaction, explicitly authorised
 *   PAYSTAGE_NETWORK=eip155:8453 PAYSTAGE_PAYTO=0x… \
 *     /work/ops/bin/with-secret loadgen \
 *     /work/ops/bin/with-secret facilitator-gas \
 *     npx vite-node apps/hosted/scripts/self-settle-smoke.ts
 *
 * No key is printed. Only addresses, the tx hash, gas and the settlement response are.
 */
import { privateKeyToAccount } from "viem/accounts";
import { createPublicClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import {
  USDC_BY_NETWORK,
  createSelfFacilitator,
  signerFromPrivateKey,
} from "../src/self-facilitator.js";
import type { PaymentPayload, PaymentRequirements } from "@x402/core/types";

function key(value: string | undefined, name: string): `0x${string}` {
  if (!value) throw new Error(`missing ${name}; inject it with /work/ops/bin/with-secret`);
  const trimmed = value.trim();
  return (trimmed.startsWith("0x") ? trimmed : `0x${trimmed}`) as `0x${string}`;
}

async function main() {
  const network = process.env.PAYSTAGE_NETWORK ?? "eip155:84532";
  const isSepolia = network === "eip155:84532";
  const chain = isSepolia ? baseSepolia : base;
  const payTo = process.env.PAYSTAGE_PAYTO;
  const asset = USDC_BY_NETWORK[network];
  if (!payTo) throw new Error("missing PAYSTAGE_PAYTO");
  if (!asset) throw new Error(`no USDC address known for ${network}`);

  // The faucet wallet is funded on Sepolia for both gas and payment. On mainnet the two
  // roles are deliberately different: the gas wallet holds gas only, never customer funds.
  const payerKey = key(
    isSepolia ? process.env.FAUCET_SEPOLIA_KEY : process.env.LOADGEN_KEY_1,
    isSepolia ? "FAUCET_SEPOLIA_KEY" : "LOADGEN_KEY_1",
  );
  const gasKey = key(
    isSepolia ? process.env.FAUCET_SEPOLIA_KEY : process.env.FACILITATOR_GAS_PRIVATE_KEY,
    isSepolia ? "FAUCET_SEPOLIA_KEY" : "FACILITATOR_GAS_PRIVATE_KEY",
  );

  const payer = privateKeyToAccount(payerKey);
  const client = createSelfFacilitator({
    signer: signerFromPrivateKey(gasKey, network),
    policy: { payTo, network, asset, minimumAmount: "2000" },
  });

  // Base mainnet USDC's EIP-712 domain name is "USD Coin"; Base Sepolia's is "USDC".
  // Signing the wrong string produces a valid-looking signature that recovers another
  // address, which is exactly the invalid_signature the first mainnet attempt returned.
  const tokenName = isSepolia ? "USDC" : "USD Coin";
  const now = Math.floor(Date.now() / 1000);
  const nonce = `0x${Array.from(crypto.getRandomValues(new Uint8Array(32)))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as `0x${string}`;
  const requirements: PaymentRequirements = {
    scheme: "exact",
    network,
    asset,
    amount: "2000",
    payTo,
    maxTimeoutSeconds: 300,
    extra: { name: tokenName, version: "2" },
  };
  const authorization = {
    from: payer.address,
    to: payTo,
    value: 2000n,
    validAfter: 0n,
    validBefore: BigInt(now + 300),
    nonce,
  };
  const signature = await payer.signTypedData({
    domain: {
      name: tokenName,
      version: "2",
      chainId: isSepolia ? baseSepolia.id : base.id,
      verifyingContract: asset as `0x${string}`,
    },
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
    message: authorization,
  });

  const payload: PaymentPayload = {
    x402Version: 2,
    accepted: requirements,
    payload: {
      authorization: {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value.toString(),
        validAfter: authorization.validAfter.toString(),
        validBefore: authorization.validBefore.toString(),
        nonce: authorization.nonce,
      },
      signature,
    },
    extensions: {
      "payment-identifier": {
        info: { required: false, id: `pay_smoke_${Date.now().toString(36)}` },
      },
    },
  };

  console.log(
    JSON.stringify({
      stage: "prepared",
      network,
      payer: payer.address,
      payTo,
      amountAtomic: requirements.amount,
    }),
  );

  const verified = await client.verify(payload, requirements);
  console.log(JSON.stringify({ stage: "verify", ...verified }));
  if (!verified.isValid) {
    process.exitCode = 2;
    return;
  }

  const settled = await client.settle(payload, requirements);
  console.log(JSON.stringify({ stage: "settle", ...settled }));
  if (!settled.success) {
    process.exitCode = 3;
    return;
  }

  const publicClient = createPublicClient({ chain, transport: http() });
  const receipt = await publicClient.waitForTransactionReceipt({
    hash: settled.transaction as `0x${string}`,
  });
  const gasPrice = receipt.effectiveGasPrice ?? 0n;
  console.log(
    JSON.stringify({
      stage: "receipt",
      transaction: settled.transaction,
      blockNumber: receipt.blockNumber.toString(),
      status: receipt.status,
      gasUsed: receipt.gasUsed.toString(),
      effectiveGasPriceWei: gasPrice.toString(),
      feeWei: (receipt.gasUsed * gasPrice).toString(),
    }),
  );
}

main().catch((error) => {
  // The message is ours or viem's; keys are not part of either. Print the message, never the
  // input env, so a failure cannot dump the secret.
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

/**
 * PayStage in an AgentKit-style loop.
 *
 * AgentKit owns the wallet; this is the part it does not do — deciding whether the payment the agent is about to sign
 * should be signed. The gate is registered on the client hook, so it runs on every payment rather than when the model
 * remembers to ask.
 *
 *   npm i @paystage/x402-guard
 *
 * The wallet address below is the only edit: everything else is the policy.
 */
import { guardFetch } from "@paystage/x402-guard";

const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  // EDIT THIS: the payees your agent may pay.
  allowed_pay_to: ["0x0000000000000000000000000000000000000000"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
} as const;

// `walletClient` comes from whatever AgentKit gives you; the gate only needs it to hand off a payment it approved.
export function guardedFetch(walletClient: unknown) {
  return guardFetch(fetch, {
    policy,
    walletClient: walletClient as never,
    maxValue: "0.05",
    onVerdict: (v) => console.log("paystage:", v.verdict, v.reasonCodes.join(", ")),
  });
}

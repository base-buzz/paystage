import { describe, it, expect } from "vitest";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { privateKeyToAccount } from "viem/accounts";
import { paystageClientHook } from "../src/index.js";

/**
 * `paystageClientHook` against a REAL `@x402/core` client.
 *
 * Every other test in this package feeds `evaluateBeforeCreation` a `PaymentCreationContextLike`
 * we defined ourselves — which proves the hook matches our own interface, not theirs. If core
 * changes the context shape, those tests keep passing and every v2 integration we advertise
 * stops working. This file is the only one that can notice.
 *
 * Note the scope: the client comes from `@x402/core/client`, the wallet path in `x402-guard`'s
 * `guardFetch` wraps `x402-fetch` (unscoped, v1) — different packages, similar names. See
 * runbook rule 7.
 */

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const ALLOWED = "0x1111111111111111111111111111111111111111";
const ATTACKER = "0x9999999999999999999999999999999999999999";

/** Throwaway literal key. Never funded, never used outside this file. */
const throwaway = privateKeyToAccount("0x1111111111111111111111111111111111111111111111111111111111111111");

const policy = (allowedPayTo: string[]) => ({
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_pay_to: allowedPayTo,
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
});

const challenge = (payTo: string) => ({
  x402Version: 2,
  resource: { url: "https://api.example.com/paid" },
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "2000",
      asset: USDC,
      payTo,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
  ],
});

function realClient() {
  return x402Client.fromConfig({
    schemes: [{ network: "eip155:8453", client: new ExactEvmScheme(throwaway) }],
  });
}

describe("paystageClientHook against a real @x402/core client", () => {
  it("aborts creation for a payee the policy does not allow, before anything is signed", async () => {
    const client = realClient();
    const verdicts: string[] = [];
    client.onBeforePaymentCreation(
      paystageClientHook({ policy: policy([ALLOWED]), onVerdict: (v) => verdicts.push(v.verdict) }),
    );

    await expect(client.createPaymentPayload(challenge(ATTACKER))).rejects.toThrow(/not in allowed_pay_to/);
    expect(verdicts).toEqual(["do_not_pay"]);
  });

  it("lets an allowed payment through and creates a signed payload", async () => {
    const client = realClient();
    const verdicts: string[] = [];
    client.onBeforePaymentCreation(
      paystageClientHook({ policy: policy([ALLOWED]), onVerdict: (v) => verdicts.push(v.verdict) }),
    );

    const payload = await client.createPaymentPayload(challenge(ALLOWED));
    expect(verdicts).toEqual(["pay"]);
    expect(typeof payload?.payload?.signature).toBe("string");
  });

  it("reads the context fields core actually passes", async () => {
    // The interface we declare is a guess about someone else's object. Pin the two fields the
    // gate depends on, so a rename in core fails here instead of in a user's integration.
    const client = realClient();
    let seen: Record<string, unknown> = {};
    client.onBeforePaymentCreation(async (ctx) => {
      seen = {
        keys: Object.keys(ctx ?? {}).sort(),
        selectedPayTo: ctx?.selectedRequirements?.payTo,
        hasPaymentRequired: Boolean(ctx?.paymentRequired?.accepts?.length),
      };
      return paystageClientHook({ policy: policy([ALLOWED]) })(ctx);
    });

    await client.createPaymentPayload(challenge(ALLOWED));
    expect(seen.keys).toEqual(["paymentRequired", "selectedRequirements"]);
    expect(seen.selectedPayTo).toBe(ALLOWED);
    expect(seen.hasPaymentRequired).toBe(true);
  });
});

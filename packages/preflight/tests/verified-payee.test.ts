import { describe, expect, it } from "vitest";
import { evaluatePayment } from "../src/evaluate.js";
import { VERIFIED_PAYEES, verifiedPayeeFor } from "../src/verified-payees.js";
import type { Policy } from "@paystage/policy";

/**
 * #164 layer (a): the host in `resource` and the `payTo` in the challenge should agree when we have probed that host.
 *
 * The verdict is `review`, deliberately — a provider rotating its payee is a legitimate event, and a hard refusal there would
 * punish the honest case the registry exists to protect. What must not happen is `pay`.
 */
const entry = VERIFIED_PAYEES[0];
const OTHER = "0x1111111111111111111111111111111111111111";

const policy = (payTo: string) =>
  ({
    version: 1,
    max_amount: { value: "5", asset: "USDC", decimals: 6 },
    allowed_pay_to: [payTo],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" }],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 600,
    unknown_payee: "deny",
  }) as unknown as Policy;

const payment = (payTo: string) =>
  ({
    x402Version: 2,
    resource: { url: `https://${entry.host}/some/endpoint` },
    accepts: [
      {
        scheme: "exact",
        network: "eip155:8453",
        asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
        amount: "1000",
        payTo,
        maxTimeoutSeconds: 300,
      },
    ],
  }) as never;

describe("verified payee binding", () => {
  it("has entries, generated from the published registry", () => {
    expect(VERIFIED_PAYEES.length).toBeGreaterThanOrEqual(5);
    expect(verifiedPayeeFor(entry.host)?.payee).toBe(entry.payee);
  });

  it("pays when the payee matches the verified address for the host", () => {
    const result = evaluatePayment(payment(entry.payee), policy(entry.payee));
    expect(result.accepts?.[0]?.status ?? result.decision).toBe("pay");
  });

  it("reviews — never pays — when the host's record names a different payee", () => {
    const result = evaluatePayment(payment(OTHER), policy(OTHER));
    const status = result.accepts?.[0]?.status ?? result.decision;
    expect(status).toBe("review");
    expect((result.accepts?.[0]?.reasons ?? result.reasons).join(" ")).toMatch(/differs from the verified address/);
  });

  it("does not bind a host we have never probed", () => {
    const onUnknownHost = {
      ...(payment(OTHER) as Record<string, unknown>),
      resource: { url: "https://never-probed.example/x" },
    } as never;
    const result = evaluatePayment(onUnknownHost, policy(OTHER));
    expect(result.accepts?.[0]?.status ?? result.decision).toBe("pay");
  });
});

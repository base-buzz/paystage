import { describe, expect, it } from "vitest";
import { PayStage } from "./PayStage.node.js";

/**
 * The node is exercised through a fake execution context, because what matters is its contract with n8n: which URL it calls,
 * what it returns, and what it does when the gate is unreachable.
 */
const contextFor = (params: Record<string, unknown>, http: (options: unknown) => Promise<unknown>) =>
  ({
    getInputData: () => [{ json: {} }],
    getNodeParameter: (name: string, _i: number, fallback?: unknown) => params[name] ?? fallback,
    helpers: { httpRequest: http },
  }) as never;

describe("PayStage n8n node", () => {
  it("posts the payment and policy to the hosted evaluate endpoint", async () => {
    let seen: { url?: string; body?: unknown } = {};
    const node = new PayStage();
    const [out] = await node.execute.call(
      contextFor(
        { paymentRequired: { accepts: [] }, policy: { version: 1 }, baseUrl: "https://api.paystage.xyz/" },
        async (options) => {
          seen = options as { url?: string; body?: unknown };
          return { decision: "do_not_pay", reasons: ["sanctioned address (OFAC SDN)"] };
        },
      ),
    );
    expect(seen.url).toBe("https://api.paystage.xyz/v1/evaluate_mcp_payment");
    expect(seen.body).toMatchObject({ payment_required: { accepts: [] }, policy: { version: 1 } });
    expect(out[0].json).toMatchObject({ decision: "do_not_pay" });
  });

  it("fails closed when the gate cannot be reached", async () => {
    const node = new PayStage();
    const [out] = await node.execute.call(
      contextFor({ paymentRequired: {}, policy: {} }, async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(out[0].json).toMatchObject({ decision: "unverifiable", fail_closed: true });
    expect(String((out[0].json as { reasons: string[] }).reasons[0])).toContain("could not be reached");
  });

  it("does not translate a refusal into an error, so a workflow can branch on it", async () => {
    const node = new PayStage();
    const [out] = await node.execute.call(
      contextFor({ paymentRequired: {}, policy: {} }, async () => ({ decision: "review", reasons: ["unknown payee"] })),
    );
    expect(out[0].json).toMatchObject({ decision: "review" });
  });
});

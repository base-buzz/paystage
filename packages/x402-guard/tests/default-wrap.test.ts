import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { guardFetch } from "../src/index.js";

/**
 * The documented happy path is `guardFetch(fetch, { policy })` — no `wrap`. Every other test injects `wrap`,
 * so `defaultWrap` was never exercised, and it called a bare `require("x402-fetch")` inside a `"type":"module"`
 * package. `require` is undefined there, the ReferenceError was swallowed by the catch, and a caller with
 * x402-fetch installed was told to install it (#265-adjacent report from the Outreach session, 2026-11-18).
 */

const challenge = (amount: string, payTo: string) =>
  Buffer.from(
    JSON.stringify({
      x402Version: 2,
      accepts: [
        {
          scheme: "exact",
          network: "eip155:8453",
          amount,
          asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
          payTo,
          maxTimeoutSeconds: 300,
        },
      ],
    }),
  ).toString("base64");

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

const policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

describe("defaultWrap", () => {
  it("resolves the optional peer instead of claiming it is missing", async () => {
    // x402-fetch is installed as a devDependency for this test. A bare `require` would throw a
    // ReferenceError here, be swallowed, and surface as "no x402-fetch available. Install x402-fetch".
    const fetchImpl = (async () =>
      new Response("{}", { status: 402, headers: { "payment-required": challenge("2000", PAY_TO) } })) as never;

    const guarded = guardFetch(fetchImpl, { policy: policy as never, walletClient: {} as never });

    // What happens inside x402-fetch is their business and depends on a real wallet; what must not happen is
    // our message claiming the peer is absent. Anything thrown from here on comes from the peer itself.
    let message = "";
    try {
      await guarded("https://example.test/paid");
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).not.toMatch(/no x402-fetch available/i);
  });

  it("the source does not call a bare require in an ESM package", () => {
    const source = readFileSync(fileURLToPath(new URL("../src/index.ts", import.meta.url)), "utf8");
    // `.require(` in a comment is fine; an actual call is not.
    expect(source).not.toMatch(/(^|[^.\w])require\s*\(/m);
  });
});

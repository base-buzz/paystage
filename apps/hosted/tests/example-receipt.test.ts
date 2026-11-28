import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createApp } from "../src/app.js";
import { verifyReceipt, type Receipt } from "../src/receipt.js";
import { EXAMPLE_KEY, EXAMPLE_RECEIPT } from "../src/example-receipt.js";

const env = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_PRICE: "$0.002",
  PAYSTAGE_NETWORK: "eip155:84532" as never,
  FACILITATOR_URL: "https://x402.org/facilitator",
  FREE_TIER_ENABLED: "false",
};

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`../../../packages/receipt-verify/tests/fixtures/${name}`, import.meta.url)), "utf8");

/**
 * #484: the page promises "one receipt a third party can check offline". That promise is
 * only true if the files it serves are (a) the real captured receipt, (b) unchanged, and
 * (c) signature-valid under the key file beside them. This pins all three, so a copy edit to
 * the example cannot quietly turn it into an illustration that does not verify.
 */
describe("public example receipt", () => {
  it("serves the captured live receipt and its key", async () => {
    const app = createApp(env as never, { protect: false });
    const receiptRes = await app.request("/v1/public/example-receipt.json");
    const keyRes = await app.request("/v1/public/example-key.json");
    expect(receiptRes.status).toBe(200);
    expect(keyRes.status).toBe(200);
    expect(await receiptRes.json()).toEqual(JSON.parse(fixture("live-receipt.json")));
    // --key takes a single JWK, so the served key is one entry, not a JWKS.
    const jwks = JSON.parse(fixture("live-jwks.json")) as { keys: Array<Record<string, unknown>> };
    expect(await keyRes.json()).toEqual(jwks.keys[0]);
  });

  it("has a signature that verifies against the key beside it", async () => {
    expect(await verifyReceipt(EXAMPLE_RECEIPT as unknown as Receipt, EXAMPLE_KEY as JsonWebKey)).toBe("valid");
  });
});

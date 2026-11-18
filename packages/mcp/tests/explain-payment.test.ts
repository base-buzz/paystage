import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * #163. A verdict a caller can hand to a human has to say what the payment was.
 *
 * Four of five tested models asked for a decision they could report to their operator. The receipt already carried the
 * reasons and the verdict; what it did not print was the thing the operator is being asked about — the terms — nor a way
 * to check the answer in one command.
 */

function explain(receipt: Record<string, unknown>, args: string[] = []): string {
  const dir = mkdtempSync(join(tmpdir(), "explain-"));
  const file = join(dir, "receipt.json");
  writeFileSync(file, JSON.stringify(receipt));
  return execFileSync("node", ["dist/explain-cli.js", file, ...args], { encoding: "utf8" });
}

const receipt = {
  v: 1,
  issuer: "paystage",
  issued_at: "2026-11-18T06:00:00.000Z",
  service: { name: "@paystage/hosted", version: "test" },
  verdict: { decision: "do_not_pay", reasons: ["amount 12.5 USDC exceeds max_amount 0.05 USDC"] },
  payment: {
    scheme: "exact",
    network: "eip155:8453",
    asset: "USDC",
    amount: "12.5",
    payee: "0x000000000000000000000000000000000000dEaD",
  },
  signed: false,
  alg: "ECDSA-P256-SHA256",
  key_id: "paystage-receipt-v1",
};

describe("paystage-explain, for a human", () => {
  it("prints the terms and the payee the verdict was about", () => {
    const out = explain(receipt);
    expect(out).toContain("asked for: 12.5 USDC on eip155:8453");
    expect(out).toContain("payee: 0x000000000000000000000000000000000000dEaD");
  });

  it("makes checking it one command, with the key that signed it", () => {
    const out = explain(receipt);
    expect(out).toMatch(/Check it yourself: npx -y -p @paystage\/mcp paystage-verify .*receipt\.json/);
    expect(out).toContain("signed with key: paystage-receipt-v1");
  });

  it("does not invent terms when the receipt has none", () => {
    const { payment: _omit, ...withoutPayment } = receipt;
    const out = explain(withoutPayment);
    expect(out).not.toContain("asked for:");
    expect(out).toContain("Decision: do_not_pay");
  });

  it("carries the same facts in --json", () => {
    const parsed = JSON.parse(explain(receipt, ["--json"]));
    expect(parsed.payment.payee).toBe(receipt.payment.payee);
    expect(parsed.verify_with).toMatch(/paystage-verify/);
  });
});

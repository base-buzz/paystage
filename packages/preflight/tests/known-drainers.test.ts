import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  isKnownDrainer,
  isNonReceivable,
  KNOWN_DRAINERS,
  NON_RECEIVABLE,
  SOURCES,
} from "../src/known-drainers.js";
import { evaluatePayment } from "../src/evaluate.js";
import type { Policy } from "@paystage/policy";

const DEAD = "0x000000000000000000000000000000000000dEaD";
const UNKNOWN = "0x1111111111111111111111111111111111111111";
const ALLOWED = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const SEPOLIA = "eip155:84532";
const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [ALLOWED],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: USDC, network: SEPOLIA },
  ],
  allowed_networks: [SEPOLIA],
  max_timeout_seconds: 300,
  unknown_payee: "review",
};

function req(payTo: string) {
  return {
    x402Version: 2 as const,
    accepts: [
      {
        scheme: "exact",
        network: SEPOLIA,
        amount: "2000",
        asset: USDC,
        payTo,
        maxTimeoutSeconds: 60,
      },
    ],
  };
}

describe("known-drainers", () => {
  it("exports curated list with sources", () => {
    expect(KNOWN_DRAINERS.length).toBeGreaterThan(0);
    expect(SOURCES.length).toBeGreaterThan(0);
    for (const s of SOURCES) {
      expect(s.url).toMatch(/^https?:\/\//);
    }
  });

  // 0x…dEaD was in this list until 2026-11-17. It is a sink, not a thief: refuse the payment, but do not
  // publish a false claim about a real address.
  it("does not call the burn address a drainer", () => {
    expect(isKnownDrainer(DEAD)).toBe(false);
    expect(isKnownDrainer(DEAD.toLowerCase())).toBe(false);
  });

  it("recognises non-receivable sinks, case-insensitively", () => {
    expect(isNonReceivable(DEAD)).toBe(true);
    expect(isNonReceivable(DEAD.toLowerCase())).toBe(true);
    expect(isNonReceivable("0x0000000000000000000000000000000000000000")).toBe(true);
    expect(isNonReceivable("")).toBe(false);
    expect(isNonReceivable(UNKNOWN)).toBe(false);
  });

  it("rejects unknown addresses", () => {
    expect(isKnownDrainer(UNKNOWN)).toBe(false);
  });

  it("hard-denies a cited drainer before unknown_payee review", () => {
    // 0xCERT-2026-0230 Base attacker EOA — a real entry, because the point of the test is the list.
    const result = evaluatePayment(req("0x0b5126e1bc27c0de77e02e97945760a674edb034"), policy);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.some((r) => /known drainer/i.test(r))).toBe(true);
  });

  it("refuses a non-receivable sink, with the true reason and not the drainer one", () => {
    const result = evaluatePayment(req(DEAD), policy);
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons.join(" ")).toMatch(/non-receivable/i);
    expect(result.reasons.join(" ")).not.toMatch(/known drainer/i);
  });
});

describe("known-drainers 2026-11-02 + 2026-11-05 + 2026-11-07 refresh", () => {
  const added = [
    "0x0b5126e1bc27c0de77e02e97945760a674edb034",
    "0xcdfe91301356da873562ef513828a60dba1f569d",
    "0x616000e384ef1c2b52f5f3a88d57a3b64f23757e",
    "0xc9002a87e2e3efdcc26cfb0bc9034b919d38fb03",
    "0x101a548bcda171b5f00179aaca0ac32074a2b86a",
    "0x678245175aae05ba3301a7812a38f1a2592a97a8",
    "0x9cc58d06f299f2a37050403eb9c90482f38ee3ad",
    "0x012f89ff307568f8409bbe379ca92ed41bc4d386",
    "0x7bf2037264efbff55bd52777772779c1d9e87695",
    "0x5aff449b63c033df386af0c45384cd20c5918dbf",
    "0xe485e7a70b1131216cb47ca4555c4bbb2c742478",
    "0xb7ec7ef24fd73f3000c651ca9d0fa45b61dcf854",
    "0xb8959aca4e4c796a3bada66833eae60b1bc0bfb2",
    "0xd3565b191b28b49cc517189b984dacdb1ff05304",
    "0xc28cfeee046e1421e9dbfb2cf689074bf9f387e2",
  ];

  it("includes newly cited Base/EVM drain addresses", () => {
    expect(KNOWN_DRAINERS.length).toBe(24);
    for (const a of added) {
      expect(isKnownDrainer(a)).toBe(true);
      expect(isKnownDrainer(a.toUpperCase())).toBe(true);
    }
  });

  it("still rejects an unsourced random address", () => {
    expect(isKnownDrainer(UNKNOWN)).toBe(false);
  });
});

describe("curation guard — the published list may not drift from its own policy", () => {
  // The policy is "public citation, precision over recall, no fixtures". Each of those has failed once, so each
  // gets a check rather than a paragraph.
  const source = readFileSync(new URL("../src/known-drainers.ts", import.meta.url), "utf8");
  const start = source.indexOf("export const KNOWN_DRAINERS");
  const block = source.slice(start, source.indexOf("]);", start));
  const lines = block.split("\n");

  it("every entry is a 20-byte hex address", () => {
    for (const address of KNOWN_DRAINERS) expect(address).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it("publishes no placeholder, fixture or sentinel as a drainer", () => {
    // burn, zero, and any single repeated nibble (0x1111…, 0xdead…): all are fixtures, never thieves.
    const PLACEHOLDER = /^0x0{38}dead$|^0x0{40}$|^0x(.)\1{39}$/i;
    expect(KNOWN_DRAINERS.filter((a) => PLACEHOLDER.test(a))).toEqual([]);
    expect(NON_RECEIVABLE.filter((a) => KNOWN_DRAINERS.includes(a))).toEqual([]);
  });

  it("every entry has a citation comment above it", () => {
    const uncited: string[] = [];
    lines.forEach((line, i) => {
      const hit = /"(0x[0-9a-fA-F]{40})"/.exec(line);
      if (!hit) return;
      const above = lines.slice(Math.max(0, i - 3), i).join("\n");
      if (!/^\s*\/\//m.test(above)) uncited.push(hit[1]);
    });
    expect(uncited).toEqual([]);
  });

  it("has no duplicate entries", () => {
    const lower = KNOWN_DRAINERS.map((a) => a.toLowerCase());
    expect(new Set(lower).size).toBe(lower.length);
  });
});

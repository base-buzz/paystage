import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { parsePolicy } from "@paystage/policy";
import {
  evaluatePayment,
  resetSvmPeer,
  loadSvmPeer,
  type AcceptOption,
  type PaymentRequest,
} from "../src/index";
import type { SvmValidationPeer } from "../src/solana";
import {
  SVM_DEVNET_CAIP2,
  SVM_MAINNET_CAIP2,
  SVM_TESTNET_CAIP2,
} from "../src/solana";

/**
 * The Solana path is the four assertions `@x402/svm@2.32.0` makes on a payment requirement
 * before it builds a payload: supported network, valid mint, valid payee, integer amount.
 * Every assertion below cites the package code in `src/solana.ts`; the tests cover all four
 * passing, each one failing, and both optional-peer states.
 */

const SOL_ASSET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOL_PAYEE = "AQqnMFBwGZEoti85aTVRy8XYpKrho7GaMDx9ZB3CEeKA";

const solanaPolicy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [SOL_PAYEE],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: SOL_ASSET, network: SVM_MAINNET_CAIP2 },
  ],
  allowed_networks: [SVM_MAINNET_CAIP2],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
} as const;

const wildcardPolicy = {
  ...solanaPolicy,
  allowed_networks: ["solana:*"],
} as const;

function solanaAccept(overrides: Partial<AcceptOption> = {}): AcceptOption {
  return {
    scheme: "exact",
    network: SVM_MAINNET_CAIP2,
    amount: "1000",
    asset: SOL_ASSET,
    payTo: SOL_PAYEE,
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

function request(accept: AcceptOption): PaymentRequest {
  return { x402Version: 2, accepts: [accept] };
}

const fakePeer: SvmValidationPeer = {
  normalizeNetwork(network: string) {
    if (![SVM_MAINNET_CAIP2, SVM_DEVNET_CAIP2, SVM_TESTNET_CAIP2].includes(network)) {
      throw new Error(`Unsupported SVM network: ${network}`);
    }
    return network;
  },
  validateSvmAddress(address: string) {
    return address === SOL_ASSET || address === SOL_PAYEE;
  },
};

afterEach(() => {
  resetSvmPeer();
});

describe("Solana requirement assertions", () => {
  it("pays a Solana-shaped payment and records all four assertions", () => {
    const result = evaluatePayment(request(solanaAccept()), solanaPolicy, { svmPeer: null });

    expect(result.decision).toBe("pay");
    expect(result.selectedAccept?.network).toBe(SVM_MAINNET_CAIP2);
    const passed = result.steps
      .filter((step) => step.outcome === "pass")
      .map((step) => step.rule);
    expect(passed).toEqual(
      expect.arrayContaining([
        "solana.network",
        "solana.asset",
        "solana.payee",
        "solana.amount",
      ]),
    );
    expect(result.steps.map((step) => step.rule)).not.toContain("accept.payee_shape");
  });

  it("accepts a policy parsed from the schema with a Solana network, asset and payee", () => {
    const parsed = parsePolicy(solanaPolicy);
    const result = evaluatePayment(request(solanaAccept()), parsed, { svmPeer: null });
    expect(result.decision).toBe("pay");
  });

  it("refuses an unsupported SVM network at solana.network", () => {
    const result = evaluatePayment(
      request(solanaAccept({ network: "solana:11111111111111111111111111111111" })),
      wildcardPolicy,
      { svmPeer: null },
    );
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons[0]).toMatch(/unsupported SVM network/i);
    expect(result.steps.find((step) => step.rule === "solana.network")?.outcome).toBe("fail");
  });

  it("refuses a malformed mint at solana.asset", () => {
    const result = evaluatePayment(
      request(solanaAccept({ asset: "not-a-solana-mint" })),
      solanaPolicy,
      { svmPeer: null },
    );
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons[0]).toMatch(/invalid Solana asset/i);
    expect(result.steps.find((step) => step.rule === "solana.asset")?.outcome).toBe("fail");
  });

  it("refuses a non-Solana payTo at solana.payee", () => {
    const result = evaluatePayment(
      request(solanaAccept({ payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C" })),
      solanaPolicy,
      { svmPeer: null },
    );
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons[0]).toMatch(/invalid Solana payTo/i);
    expect(result.steps.find((step) => step.rule === "solana.payee")?.outcome).toBe("fail");
  });

  it("refuses a non-integer amount at solana.amount", () => {
    const result = evaluatePayment(
      request(solanaAccept({ amount: "1.5" })),
      solanaPolicy,
      { svmPeer: null },
    );
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons[0]).toMatch(/invalid Solana atomic amount/i);
    expect(result.steps.find((step) => step.rule === "solana.amount")?.outcome).toBe("fail");
  });

  it("uses the optional peer's own exports when it is present", () => {
    const result = evaluatePayment(request(solanaAccept()), solanaPolicy, { svmPeer: fakePeer });
    expect(result.decision).toBe("pay");
    expect(result.steps.find((step) => step.rule === "solana.peer")?.outcome).toBe("pass");
    expect(result.steps.find((step) => step.rule === "solana.peer")?.detail).toMatch(
      /@x402\/svm's own normalizeNetwork/,
    );
  });

  it("refuses when the peer's validator rejects the asset", () => {
    const strictPeer: SvmValidationPeer = {
      ...fakePeer,
      validateSvmAddress: (address) => address === SOL_PAYEE,
    };
    const result = evaluatePayment(request(solanaAccept()), solanaPolicy, { svmPeer: strictPeer });
    expect(result.decision).toBe("do_not_pay");
    expect(result.reasons[0]).toMatch(/invalid Solana asset/i);
  });
});

describe("@x402/svm is an optional peer", () => {
  it("is declared optional, not a hard dependency", () => {
    const manifest = JSON.parse(
      readFileSync(new URL("../package.json", import.meta.url), "utf8"),
    ) as {
      dependencies?: Record<string, string>;
      peerDependencies?: Record<string, string>;
      peerDependenciesMeta?: Record<string, { optional?: boolean }>;
    };
    expect(manifest.dependencies?.["@x402/svm"]).toBeUndefined();
    expect(manifest.peerDependencies?.["@x402/svm"]).toBeDefined();
    expect(manifest.peerDependenciesMeta?.["@x402/svm"]?.optional).toBe(true);
  });

  it("loads to null here, without throwing, because it is not installed", async () => {
    resetSvmPeer();
    await expect(loadSvmPeer()).resolves.toBeNull();
  });

  it("still pays with the built-in copy, and says the peer was absent", () => {
    const result = evaluatePayment(request(solanaAccept()), solanaPolicy, { svmPeer: null });
    expect(result.decision).toBe("pay");
    const peerStep = result.steps.find((step) => step.rule === "solana.peer");
    expect(peerStep?.outcome).toBe("skip");
    expect(peerStep?.detail).toMatch(/@x402\/svm was not loaded/i);
    // The four assertions still ran; the absence is a transcript fact, not a silent pass.
    for (const rule of ["solana.network", "solana.asset", "solana.payee", "solana.amount"]) {
      expect(result.steps.find((step) => step.rule === rule)?.outcome).toBe("pass");
    }
  });
});

describe("non-Solana verdict is unchanged", () => {
  it("returns byte-identical EVM pay and review results", () => {
    const baseline = JSON.parse(
      readFileSync(new URL("./fixtures/evm-verdict-baseline.json", import.meta.url), "utf8"),
    ) as {
      policy: Parameters<typeof evaluatePayment>[1];
      pay: ReturnType<typeof evaluatePayment>;
      review: ReturnType<typeof evaluatePayment>;
    };
    const accept = {
      scheme: "exact",
      network: "eip155:84532",
      amount: "10000",
      payTo: "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
      maxTimeoutSeconds: 60,
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    };
    const req = (a: typeof accept): PaymentRequest => ({
      x402Version: 2,
      accepts: [a],
      resource: { url: "mcp://tool/demo" },
    });
    expect(evaluatePayment(req(accept), baseline.policy)).toEqual(baseline.pay);
    expect(evaluatePayment(req({ ...accept, amount: "600000" }), baseline.policy)).toEqual(
      baseline.review,
    );
  });
});

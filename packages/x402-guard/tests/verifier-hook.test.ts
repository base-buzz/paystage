import { describe, it, expect } from "vitest";
import { evaluateVerification, paystageVerifierHook } from "../src/verifier-hook.js";
import { guardFetch } from "../src/index.js";

// A policy tight enough to refuse the second payment on size alone, so the decision is unambiguous.
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const policy = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC, network: "eip155:8453" }],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
  allowed_pay_to: ["0xc64a71e150cd21ebc4b12695850bed6b067743bc"],
};

const requirement = (amountAtomic: string) => ({
  scheme: "exact",
  network: "eip155:8453",
  maxAmountRequired: amountAtomic,
  payTo: "0xc64a71e150cd21ebc4b12695850bed6b067743bc",
  asset: USDC,
  resource: "https://api.example.com/paid",
  description: "probe",
});

const context = (amountAtomic: string) => ({
  paymentPayload: { payload: "signed" },
  requirements: requirement(amountAtomic),
});

describe("x402 verifier hook", () => {
  it("lets a payment inside the policy through", async () => {
    const outcome = await evaluateVerification(context("2000"), { policy });
    expect(outcome).toBeUndefined();
  });

  it("aborts a payment over the cap, before verification", async () => {
    // 1.00 USDC against a 0.05 cap.
    const outcome = await evaluateVerification(context("1000000"), { policy });
    expect(outcome).toMatchObject({ abort: true });
    if (outcome && "abort" in outcome) {
      expect(outcome.reason).toBeTruthy();
      expect(outcome.message).toContain("refused");
    }
  });

  it("refuses when the policy itself is broken — fail closed, not open", async () => {
    // A hook that threw its way to a pass would look like protection and behave like consent.
    const outcome = await evaluateVerification(context("2000"), { policy: null });
    expect(outcome).toMatchObject({ abort: true, reason: "paystage_evaluation_failed" });
  });

  it("refuses a requirement it cannot price", async () => {
    const outcome = await evaluateVerification(
      { paymentPayload: {}, requirements: { ...requirement(""), maxAmountRequired: "" } },
      { policy },
    );
    expect(outcome).toMatchObject({ abort: true, reason: "paystage_unreadable_amount" });
  });

  it("exposes the hook shape @x402/core registers", () => {
    const ext = paystageVerifierHook({ policy });
    expect(ext.key).toBe("paystage-verifier");
    expect(typeof ext.hooks.beforeVerify).toBe("function");
  });
});

describe("builder code", () => {
  it("refuses a malformed code rather than sending it", () => {
    expect(() => guardFetch(fetch, { policy, builderCode: "PayStage!" })).toThrow(/invalid builderCode/);
  });

  it("registers the code on the x402 client it would pay with", () => {
    const registered: unknown[] = [];
    const client = { registerExtension: (ext: unknown) => registered.push(ext) };
    guardFetch(fetch, { policy: { ...policy }, builderCode: "paystage", walletClient: client });
    expect(registered).toHaveLength(1);
    expect(JSON.stringify(registered[0])).toContain("paystage");
  });
});

describe("composition with a third-party facilitator", () => {
  // @payai/facilitator (and any other facilitator package) is configuration: a URL plus auth headers.
  // There is nothing in it to wrap. The seam is the resource server that calls it, which is where
  // beforeVerify runs — so the guard composes with PayAI, CDP or a self-hosted facilitator unchanged.
  it("refuses before the facilitator is ever asked to verify", async () => {
    const calls: string[] = [];
    const facilitator = {
      verify: async () => {
        calls.push("verify");
        return { isValid: true };
      },
      settle: async () => {
        calls.push("settle");
        return { success: true };
      },
    };

    const extension = paystageVerifierHook({ policy });
    const hook = extension.hooks.beforeVerify as (ctx: unknown) => Promise<unknown>;

    // The resource server runs hooks first; a refusal means the facilitator is never reached.
    const outcome = await hook(context("1000000")); // 1.00 USDC against a 0.05 cap
    if (!outcome || !("abort" in (outcome as object))) {
      await facilitator.verify();
    }

    expect(outcome).toMatchObject({ abort: true });
    expect(calls).toEqual([]);
  });
});

describe("verdict persistence", () => {
  it("records a refusal with its reason codes, not just a header", async () => {
    const seen: Array<{ verdict: string; reasonCodes: string[]; payTo?: string }> = [];
    const guarded = guardFetch(
      async () =>
        new Response(JSON.stringify({}), {
          status: 402,
          headers: { "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000000", asset: USDC, payTo: "0xc64a71e150cd21ebc4b12695850bed6b067743bc", maxTimeoutSeconds: 300 }] })).toString("base64") },
        }),
      { policy, onVerdict: (v) => seen.push(v) },
    );

    await guarded("https://api.example.com/paid");
    expect(seen).toHaveLength(1);
    expect(seen[0].verdict).toBe("do_not_pay");
    expect(seen[0].reasonCodes.join(" ")).toMatch(/exceeds max_amount/);
    expect(seen[0].payTo).toBe("0xc64a71e150cd21ebc4b12695850bed6b067743bc");
  });

  it("posts the verdict when a telemetry url is configured, and never blocks the call", async () => {
    const posts: Array<{ url: string; body: string }> = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input).includes("/guard-verdict")) {
        posts.push({ url: String(input), body: String(init?.body) });
        return new Response("{}", { status: 202 });
      }
      return new Response("{}", {
        status: 402,
        headers: { "payment-required": Buffer.from(JSON.stringify({ x402Version: 2, accepts: [{ scheme: "exact", network: "eip155:8453", amount: "1000000", asset: USDC, payTo: "0xc64a71e150cd21ebc4b12695850bed6b067743bc", maxTimeoutSeconds: 300 }] })).toString("base64") },
      });
    };

    const guarded = guardFetch(fetchImpl as typeof fetch, {
      policy,
      telemetryUrl: "https://api.paystage.xyz/v1/guard-verdict",
    });
    await guarded("https://api.example.com/paid");
    await new Promise((r) => setTimeout(r, 20));

    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0].body)).toMatchObject({ verdict: "do_not_pay" });
  });
});

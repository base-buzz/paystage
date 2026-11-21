import { describe, it, expect } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type AcceptOption,
  type EvaluateResult,
  type PaymentRequest,
} from "../src/evaluate";
import { buildEvidenceBundle, type EvidenceBundleInputs } from "../src/evidence";
import { verifyBundle } from "../src/verify-bundle";

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: USDC_SEPOLIA, network: "eip155:84532" },
  ],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
  unknown_payee: "deny",
};

function accept(overrides: Partial<AcceptOption> = {}): AcceptOption {
  return {
    scheme: "exact",
    network: "eip155:84532",
    amount: "10000",
    asset: USDC_SEPOLIA,
    payTo: PAY_TO,
    maxTimeoutSeconds: 60,
    ...overrides,
  };
}

function request(a: AcceptOption = accept()): PaymentRequest {
  return { x402Version: 2, accepts: [a] };
}

const NOW = "2026-11-21T12:00:00.000Z";

function evaluateWith(input: PaymentRequest, p: Policy = policy): EvaluateResult {
  return evaluatePayment(input, p, { now: new Date(NOW) });
}

function inputs(overrides: Partial<EvidenceBundleInputs> = {}): EvidenceBundleInputs {
  return {
    payment_required: request(),
    policy,
    options: { now: NOW },
    ...overrides,
  };
}

describe("buildEvidenceBundle", () => {
  it("returns the four artefacts and a 64-hex bundle id", async () => {
    const bundle = await buildEvidenceBundle(inputs(), evaluateWith(request()));
    expect(bundle.bundle_id).toMatch(/^[0-9a-f]{64}$/);
    expect(bundle.events_jsonl.length).toBeGreaterThan(0);
    expect(bundle.proof.length).toBeGreaterThan(0);
    expect(bundle.summary_md).toContain("Evidence bundle");
    expect(bundle.receipt).toBeUndefined();
  });

  it("is deterministic: the same inputs in a different key order produce the same bundle id", async () => {
    const reordered: Policy = {
      unknown_payee: policy.unknown_payee,
      require_human_above: policy.require_human_above,
      max_timeout_seconds: policy.max_timeout_seconds,
      allowed_networks: [...policy.allowed_networks],
      allowed_assets: policy.allowed_assets.map((a) => ({
        network: a.network,
        address: a.address,
        decimals: a.decimals,
        symbol: a.symbol,
      })),
      allowed_pay_to: [...policy.allowed_pay_to],
      daily_cap: policy.daily_cap,
      max_amount: policy.max_amount,
      version: policy.version,
    };
    const first = await buildEvidenceBundle(inputs(), evaluateWith(request()));
    const second = await buildEvidenceBundle(
      inputs({ policy: reordered }),
      evaluateWith(request(), reordered),
    );
    expect(second.bundle_id).toBe(first.bundle_id);
    expect(second.events_jsonl).toBe(first.events_jsonl);
    expect(second.proof).toBe(first.proof);
    expect(second.summary_md).toBe(first.summary_md);
  });

  it("writes events.jsonl as the evaluator's actual ordered steps", async () => {
    const result = evaluateWith(request());
    const bundle = await buildEvidenceBundle(inputs(), result);
    const lines = bundle.events_jsonl.trimEnd().split("\n").map((line) => JSON.parse(line) as {
      seq: number;
      rule: string;
      outcome: string;
    });
    expect(lines.length).toBe(result.steps.length);
    expect(lines[0]?.seq).toBe(1);
    expect(lines[0]?.rule).toBe("agent.resolve");
    expect(lines.at(-1)?.rule).toBe("result.verdict");
    expect(lines.map((l) => l.seq)).toEqual(lines.map((_, i) => i + 1));
    // A refusal stops before later rules run; the transcript must show fewer steps than a pay.
    const refused = evaluateWith(request(accept({ amount: "2000000" })));
    const refusedBundle = await buildEvidenceBundle(inputs(), refused);
    expect(refusedBundle.events_jsonl.trimEnd().split("\n").length).toBeLessThan(lines.length);
    expect(refusedBundle.events_jsonl).not.toContain("accept.require_human_above");
  });

  it("includes a receipt only when the host supplied one", async () => {
    const receipt = {
      v: 1,
      issuer: "paystage",
      signed: true,
      key_id: "test-key",
      signature: "not-a-real-signature",
    };
    const bundle = await buildEvidenceBundle(
      inputs({ receipt }),
      evaluateWith(request()),
    );
    expect(bundle.receipt).toBeDefined();
    expect(JSON.parse(bundle.receipt as string)).toMatchObject({ signed: true, key_id: "test-key" });
    expect(bundle.proof).not.toContain("not-a-real-signature");
    expect(bundle.summary_md).toContain("signed: true");
  });

  it("serialises named decision fields only, never an arbitrary result property", async () => {
    const result = evaluateWith(request());
    const withSecret = {
      ...result,
      env: { SUPABASE_SERVICE_ROLE_KEY: "SECRET_VALUE_MUST_NOT_APPEAR" },
    } as EvaluateResult;
    const bundle = await buildEvidenceBundle(inputs(), withSecret);
    expect(bundle.proof).not.toContain("SECRET_VALUE_MUST_NOT_APPEAR");
    expect(bundle.summary_md).not.toContain("SECRET_VALUE_MUST_NOT_APPEAR");
    expect(bundle.events_jsonl).not.toContain("SECRET_VALUE_MUST_NOT_APPEAR");
  });
});

describe("verifyBundle", () => {
  it("recomputes the recorded verdict and reports a match", async () => {
    const result = evaluateWith(request());
    const bundle = await buildEvidenceBundle(inputs(), result);
    const verification = await verifyBundle(bundle.proof);
    expect(verification.status).toBe("match");
    expect(verification.ok).toBe(true);
    expect(verification.recomputed_decision).toBe(result.decision);
    expect(verification.problems).toEqual([]);
  });

  it("reports a mismatch when one input is tampered with", async () => {
    const bundle = await buildEvidenceBundle(inputs(), evaluateWith(request()));
    const proof = JSON.parse(bundle.proof) as {
      inputs: { policy: Policy };
    };
    proof.inputs.policy.max_amount.value = "0.000001";
    const verification = await verifyBundle(JSON.stringify(proof));
    expect(verification.ok).toBe(false);
    expect(verification.status).toBe("mismatch");
    expect(verification.checks.bundle_id).toBe("mismatch");
    expect(verification.problems.join(" ")).toMatch(/bundle id mismatch|hash/);
  });

  it("reports not_recomputable when the verdict depended on replay-cache state", async () => {
    const { require_human_above: _omitted, ...withoutHuman } = policy;
    const statefulPolicy: Policy = {
      ...withoutHuman,
      max_amount: { value: "50.00", asset: "USDC", decimals: 6 },
    };
    const first = evaluatePayment(request(), statefulPolicy, {
      now: new Date(NOW),
      paymentIdentifier: "bundle-test-replay",
    });
    expect(first.decision).toBe("pay");
    const second = evaluatePayment(request(), statefulPolicy, {
      now: new Date(NOW),
      paymentIdentifier: "bundle-test-replay",
    });
    expect(second.decision).toBe("review");
    const bundle = await buildEvidenceBundle(
      {
        payment_required: request(),
        policy: statefulPolicy,
        options: { now: NOW, payment_identifier: "bundle-test-replay" },
      },
      second,
    );
    const verification = await verifyBundle(bundle.proof);
    expect(verification.status).toBe("not_recomputable");
    expect(verification.ok).toBe(false);
    expect(verification.problems.join(" ")).toMatch(/replay cache/);
  });
});

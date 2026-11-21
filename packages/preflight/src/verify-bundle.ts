/**
 * Third-party verification of an evidence bundle.
 *
 * Takes the `proof` artefact alone, re-derives the inputs' hashes, re-runs the evaluator
 * against the recorded inputs, and compares the result with the verdict the bundle says
 * was issued. A proof that cannot be recomputed is a souvenir with a hash on it; this is
 * the function that decides whether a bundle deserves the name.
 */

import type { Policy } from "@paystage/policy";
import {
  evaluatePayment,
  type AcceptOption,
  type Decision,
  type EvaluateResult,
  type PaymentRequest,
} from "./evaluate.js";
import {
  EVIDENCE_PROOF_SCHEMA,
  canonicalize,
  renderEventsJsonl,
  sha256Hex,
  verdictDependsOnProcessState,
} from "./evidence.js";

export interface EvidenceProofVerdict {
  decision: Decision;
  reasons: string[];
  summary: string;
  agent?: string;
  selected_accept?: AcceptOption;
  steps_count?: number;
  process_state_dependent?: boolean;
}

export interface EvidenceProof {
  schema: typeof EVIDENCE_PROOF_SCHEMA;
  bundle_id: string;
  inputs: {
    payment_required: PaymentRequest;
    policy: Policy;
    options?: {
      agent_id?: string;
      payment_identifier?: string;
      now?: string;
      dedup_window_ms?: number;
    };
  };
  hashes: {
    payment_required_sha256: string;
    policy_sha256: string;
    options_sha256: string;
    inputs_sha256: string;
    events_sha256: string;
  };
  verdict: EvidenceProofVerdict;
}

export type VerificationStatus = "match" | "mismatch" | "not_recomputable" | "invalid";

export interface BundleVerification {
  ok: boolean;
  status: VerificationStatus;
  bundle_id: string | null;
  computed_bundle_id: string | null;
  expected_decision: Decision | null;
  recomputed_decision: Decision | null;
  checks: {
    bundle_id: "match" | "mismatch" | "not_checked";
    input_hashes: "match" | "mismatch" | "not_checked";
    verdict: "match" | "mismatch" | "not_checked";
  };
  problems: string[];
  /** The evaluator's result for the recorded inputs, so a caller can inspect a mismatch. */
  recomputed: EvaluateResult | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalid(problems: string[]): BundleVerification {
  return {
    ok: false,
    status: "invalid",
    bundle_id: null,
    computed_bundle_id: null,
    expected_decision: null,
    recomputed_decision: null,
    checks: { bundle_id: "not_checked", input_hashes: "not_checked", verdict: "not_checked" },
    problems,
    recomputed: null,
  };
}

function parseProof(proof: string | EvidenceProof): { proof?: EvidenceProof; error?: string } {
  let value: unknown;
  if (typeof proof === "string") {
    try {
      value = JSON.parse(proof);
    } catch {
      return { error: "proof is not valid JSON" };
    }
  } else {
    value = proof;
  }
  if (!isRecord(value)) return { error: "proof must be an object" };
  if (value.schema !== EVIDENCE_PROOF_SCHEMA) {
    return { error: `proof.schema must be ${EVIDENCE_PROOF_SCHEMA}, got ${String(value.schema)}` };
  }
  if (typeof value.bundle_id !== "string") return { error: "proof.bundle_id must be a string" };
  if (!isRecord(value.inputs)) return { error: "proof.inputs must be an object" };
  if (!isRecord(value.inputs.payment_required)) {
    return { error: "proof.inputs.payment_required must be an object" };
  }
  if (!isRecord(value.inputs.policy)) return { error: "proof.inputs.policy must be an object" };
  if (!isRecord(value.hashes)) return { error: "proof.hashes must be an object" };
  if (!isRecord(value.verdict)) return { error: "proof.verdict must be an object" };
  if (typeof value.verdict.decision !== "string") {
    return { error: "proof.verdict.decision must be a string" };
  }
  if (!Array.isArray(value.verdict.reasons)) {
    return { error: "proof.verdict.reasons must be an array" };
  }
  if (typeof value.verdict.summary !== "string") {
    return { error: "proof.verdict.summary must be a string" };
  }
  for (const key of [
    "payment_required_sha256",
    "policy_sha256",
    "options_sha256",
    "inputs_sha256",
    "events_sha256",
  ]) {
    if (typeof (value.hashes as Record<string, unknown>)[key] !== "string") {
      return { error: `proof.hashes.${key} must be a string` };
    }
  }
  const options = value.inputs.options;
  if (options !== undefined && !isRecord(options)) {
    return { error: "proof.inputs.options must be an object when present" };
  }
  return { proof: value as unknown as EvidenceProof };
}

function sameAccept(a: AcceptOption | undefined, b: AcceptOption | undefined): boolean {
  if (a === undefined || b === undefined) return a === b;
  return canonicalize(a) === canonicalize(b);
}

/**
 * Recompute the verdict from a proof and report match / mismatch.
 *
 * Never trusts the proof's hashes: every one is recomputed from the recorded inputs.
 */
export async function verifyBundle(
  proofInput: string | EvidenceProof,
): Promise<BundleVerification> {
  const parsed = parseProof(proofInput);
  if (parsed.proof === undefined) return invalid([parsed.error ?? "proof could not be parsed"]);
  const proof = parsed.proof;
  const problems: string[] = [];

  const { payment_required, policy, options } = proof.inputs;
  let now: Date | undefined;
  if (typeof options?.now === "string") {
    now = new Date(options.now);
    if (Number.isNaN(now.getTime())) {
      return invalid([`proof.inputs.options.now is not a valid date: ${options.now}`]);
    }
  }

  const canonicalInputs: Record<string, unknown> = {
    payment_required,
    policy,
    ...(options === undefined || Object.keys(options).length === 0 ? {} : { options }),
  };
  const computedBundleId = await sha256Hex(canonicalInputs);
  const computed = {
    payment_required_sha256: await sha256Hex(payment_required),
    policy_sha256: await sha256Hex(policy),
    options_sha256: await sha256Hex(options ?? {}),
    inputs_sha256: computedBundleId,
    events_sha256: proof.hashes.events_sha256,
  };

  const bundleIdMatches =
    computedBundleId === proof.bundle_id && computed.inputs_sha256 === proof.hashes.inputs_sha256;
  if (!bundleIdMatches) {
    problems.push(
      `bundle id mismatch: proof says ${proof.bundle_id}, canonical inputs hash to ${computedBundleId}`,
    );
  }
  const otherHashesMatch =
    computed.payment_required_sha256 === proof.hashes.payment_required_sha256 &&
    computed.policy_sha256 === proof.hashes.policy_sha256 &&
    computed.options_sha256 === proof.hashes.options_sha256;
  if (!otherHashesMatch) {
    problems.push("one or more recorded input hashes do not match the inputs in the proof");
  }

  let result: EvaluateResult;
  try {
    result = evaluatePayment(payment_required, policy, {
      ...(options?.agent_id !== undefined ? { agentId: options.agent_id } : {}),
      ...(options?.payment_identifier !== undefined
        ? { paymentIdentifier: options.payment_identifier }
        : {}),
      ...(now !== undefined ? { now } : {}),
      ...(options?.dedup_window_ms !== undefined
        ? { dedupWindowMs: options.dedup_window_ms }
        : {}),
    });
  } catch (error) {
    return {
      ok: false,
      status: "mismatch",
      bundle_id: proof.bundle_id,
      computed_bundle_id: computedBundleId,
      expected_decision: proof.verdict.decision,
      recomputed_decision: null,
      checks: {
        bundle_id: bundleIdMatches ? "match" : "mismatch",
        input_hashes: otherHashesMatch ? "match" : "mismatch",
        verdict: "mismatch",
      },
      problems: [
        ...problems,
        `the evaluator threw on the recorded inputs: ${error instanceof Error ? error.message : String(error)}`,
      ],
      recomputed: null,
    };
  }

  const recomputedEventsHash = await sha256Hex(renderEventsJsonl(result.steps));
  const eventsMatch = recomputedEventsHash === proof.hashes.events_sha256;
  if (!eventsMatch) {
    problems.push(
      "events hash mismatch: the evaluator's recomputed transcript does not match proof.hashes.events_sha256",
    );
  }

  const stateDependent =
    proof.verdict.process_state_dependent === true || verdictDependsOnProcessState(result);
  const timeWindow = (policy as { time_window?: unknown }).time_window;
  const timeDependentWithoutTime = timeWindow !== undefined && now === undefined;
  if (timeDependentWithoutTime) {
    problems.push(
      "the policy has a time_window but proof.inputs.options.now is absent, so a fresh process may judge a different hour",
    );
  }
  if (stateDependent) {
    problems.push(
      "the recorded verdict depended on the in-process payment-identifier replay cache, which proof does not carry",
    );
  }

  const decisionMatches = result.decision === proof.verdict.decision;
  const reasonsMatch = canonicalize(result.reasons) === canonicalize(proof.verdict.reasons);
  const summaryMatches = result.summary === proof.verdict.summary;
  const acceptMatches = sameAccept(result.selectedAccept, proof.verdict.selected_accept);
  const verdictMatches = decisionMatches && reasonsMatch && summaryMatches && acceptMatches;
  if (!decisionMatches) {
    problems.push(
      `verdict mismatch: proof records ${proof.verdict.decision}, recomputation produced ${result.decision}`,
    );
  }
  if (decisionMatches && !reasonsMatch) problems.push("reason list differs from the recorded verdict");
  if (decisionMatches && !summaryMatches) problems.push("summary differs from the recorded verdict");
  if (decisionMatches && !acceptMatches) problems.push("selected accept differs from the recorded verdict");

  const status: VerificationStatus =
    stateDependent || timeDependentWithoutTime
      ? "not_recomputable"
      : bundleIdMatches && otherHashesMatch && eventsMatch && verdictMatches
        ? "match"
        : "mismatch";

  return {
    ok: status === "match",
    status,
    bundle_id: proof.bundle_id,
    computed_bundle_id: computedBundleId,
    expected_decision: proof.verdict.decision,
    recomputed_decision: result.decision,
    checks: {
      bundle_id: bundleIdMatches ? "match" : "mismatch",
      input_hashes: otherHashesMatch ? "match" : "mismatch",
      verdict: verdictMatches ? "match" : "mismatch",
    },
    problems,
    recomputed: result,
  };
}

/** One-line human answer for a CLI or an audit log. */
export function describeVerification(v: BundleVerification): string {
  if (v.status === "match") {
    return `match: bundle ${v.bundle_id} recomputes to ${v.recomputed_decision}`;
  }
  if (v.status === "invalid") {
    return `invalid: ${v.problems.join("; ")}`;
  }
  return `${v.status}: ${v.problems.join("; ")}`;
}

/**
 * Evidence bundles: the record of one decision, not just its verdict.
 *
 * A verdict is useful for the next second. An auditor asking "why was this payment
 * approved, on what inputs, and can I check it myself" needs the transcript, the inputs
 * and their hashes, the signed receipt when one exists, and a summary a human can read.
 * This module builds those four artefacts from data the evaluator already produced.
 *
 * Design constraints:
 *  - The evaluator's `steps` are used verbatim. Re-narrating a verdict from the final
 *    reasons would invent rules that never ran; the evaluator is the only honest source.
 *  - The bundle id is SHA-256 over canonical JSON of the inputs. Same inputs, same id,
 *    on every machine and in every process.
 *  - No clock is read here. If the caller supplies evaluation time it is recorded; if it
 *    does not, nothing pretends the bundle carries a timestamp.
 *  - No secrets are collected. The builder reads named fields; it never serialises an
 *    environment, a policy file path, or a signing key.
 */

import type { Policy } from "@paystage/policy";
import type {
  AcceptOption,
  Decision,
  EvaluateResult,
  EvaluationStep,
  PaymentRequest,
} from "./evaluate.js";

export const EVIDENCE_SCHEMA = "paystage.evidence-bundle.v1";
export const EVIDENCE_PROOF_SCHEMA = "paystage.evidence-proof.v1";

export interface EvidenceBundleOptions {
  agent_id?: string;
  payment_identifier?: string;
  /** Recorded evaluation time. Required for a verdict that depends on a policy time window. */
  now?: string | Date;
  dedup_window_ms?: number;
}

export interface EvidenceBundleInputs {
  payment_required: PaymentRequest;
  policy: Policy;
  options?: EvidenceBundleOptions;
  /** The evaluator's receipt, when the host produced one. Never synthesized here. */
  receipt?: unknown;
}

export interface EvidenceBundle {
  /** SHA-256, lowercase hex, over canonical JSON of the inputs. */
  bundle_id: string;
  /** One canonical-JSON step per line, in the order the evaluator ran them. */
  events_jsonl: string;
  /** Canonical JSON: inputs, their hashes, and the recorded verdict. */
  proof: string;
  /** Canonical JSON receipt, present only when the host supplied one. */
  receipt?: string;
  /** Human-readable record generated from the same data. */
  summary_md: string;
}

/** Exact artefact names a run directory holds. */
export const EVIDENCE_ARTEFACTS = ["events.jsonl", "proof", "receipt", "summary.md"] as const;

/** JSON with recursively sorted keys, no insignificant whitespace, undefined members dropped. */
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(",")}}`;
}

/** The exact `events.jsonl` bytes for a set of evaluator steps: one canonical-JSON step per line. */
export function renderEventsJsonl(steps: EvaluationStep[]): string {
  return steps.length === 0 ? "" : `${steps.map((step) => canonicalize(step)).join("\n")}\n`;
}

function toHex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** SHA-256 over a string as-is, or over canonical JSON for anything else. */
export async function sha256Hex(value: unknown): Promise<string> {
  const text = typeof value === "string" ? value : canonicalize(value);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return toHex(digest);
}

function normaliseNow(now: string | Date | undefined): string | undefined {
  if (now === undefined) return undefined;
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`evidence bundle: options.now is not a valid date: ${String(now)}`);
  }
  return date.toISOString();
}

function normaliseOptions(options: EvidenceBundleOptions | undefined): Record<string, unknown> {
  if (options === undefined) return {};
  const out: Record<string, unknown> = {};
  if (options.agent_id !== undefined) out.agent_id = options.agent_id;
  if (options.payment_identifier !== undefined) out.payment_identifier = options.payment_identifier;
  const now = normaliseNow(options.now);
  if (now !== undefined) out.now = now;
  if (options.dedup_window_ms !== undefined) out.dedup_window_ms = options.dedup_window_ms;
  return out;
}

/**
 * Whether the recorded verdict depended on in-process state a third party cannot hold.
 *
 * The payment-identifier replay check is deliberately stateful. A bundle that hides that
 * would verify as a mismatch in a fresh process for a reason that looks like tampering.
 */
export function verdictDependsOnProcessState(result: EvaluateResult): boolean {
  return result.steps.some(
    (step) =>
      step.rule === "result.payment_identifier" &&
      step.outcome === "review" &&
      /already produced a pay verdict/.test(step.detail),
  );
}

function receiptString(receipt: unknown): string {
  if (typeof receipt === "string") {
    // Accept a serialized receipt, but canonicalise it so the same receipt always hashes
    // and prints the same. An unparseable string is a caller bug, not something to wrap.
    return canonicalize(JSON.parse(receipt));
  }
  return canonicalize(receipt);
}

function receiptFacts(receipt: unknown): { signed: boolean; issuer?: string; keyId?: string } {
  if (receipt === null || typeof receipt !== "object") return { signed: false };
  const r = receipt as Record<string, unknown>;
  return {
    signed: r.signed === true,
    ...(typeof r.issuer === "string" ? { issuer: r.issuer } : {}),
    ...(typeof r.key_id === "string" ? { keyId: r.key_id } : {}),
  };
}

function summaryMarkdown(input: {
  bundleId: string;
  result: EvaluateResult;
  inputs: Record<string, unknown>;
  hashes: Record<string, string>;
  receipt?: unknown;
}): string {
  const { bundleId, result, hashes, receipt } = input;
  const lines: string[] = [];
  lines.push(`# Evidence bundle ${bundleId}`);
  lines.push("");
  lines.push(`Decision: **${result.decision}**`);
  lines.push("");
  lines.push(result.summary);
  lines.push("");

  if (result.selectedAccept) {
    const a: AcceptOption = result.selectedAccept;
    lines.push("## Selected payment");
    lines.push("");
    lines.push(`- payee: \`${a.payTo}\``);
    lines.push(`- network: \`${a.network}\``);
    lines.push(`- asset: \`${a.asset}\``);
    lines.push(`- amount (atomic): \`${a.amount}\``);
    lines.push(`- timeout: ${a.maxTimeoutSeconds}s`);
    lines.push("");
  }

  lines.push("## Reasons");
  lines.push("");
  if (result.reasons.length === 0) {
    lines.push("No rule produced a reason; the decision was derived from the accept results.");
  } else {
    for (const reason of result.reasons) lines.push(`- ${reason}`);
  }
  lines.push("");

  lines.push("## Rules that ran, in order");
  lines.push("");
  lines.push("| # | rule | scope | outcome | detail |");
  lines.push("|---|---|---|---|---|");
  for (const step of result.steps) {
    const detail = step.detail.replace(/\|/g, "\\|");
    const index = step.accept_index === undefined ? "" : ` [accept ${step.accept_index}]`;
    lines.push(`| ${step.seq} | \`${step.rule}\`${index} | ${step.scope} | ${step.outcome} | ${detail} |`);
  }
  lines.push("");

  lines.push("## Inputs and hashes");
  lines.push("");
  lines.push("| input | sha256 |");
  lines.push("|---|---|");
  lines.push(`| payment_required | \`${hashes.payment_required_sha256}\` |`);
  lines.push(`| policy | \`${hashes.policy_sha256}\` |`);
  lines.push(`| options | \`${hashes.options_sha256}\` |`);
  lines.push(`| all inputs (bundle id) | \`${hashes.inputs_sha256}\` |`);
  lines.push("");

  lines.push("## Receipt");
  lines.push("");
  if (receipt === undefined) {
    lines.push("No receipt was produced for this evaluation, so the bundle contains none.");
  } else {
    const facts = receiptFacts(receipt);
    lines.push(`- signed: ${facts.signed ? "true" : "false"}`);
    if (facts.issuer !== undefined) lines.push(`- issuer: ${facts.issuer}`);
    if (facts.keyId !== undefined) lines.push(`- key_id: ${facts.keyId}`);
    lines.push("");
    lines.push(
      facts.signed
        ? "Verify the signature with the published key before treating the verdict as authentic."
        : "This receipt is unsigned; it binds the verdict to the inputs but does not authenticate the issuer.",
    );
  }
  lines.push("");

  lines.push("## Recompute this verdict");
  lines.push("");
  lines.push("The `proof` artefact contains the inputs, their hashes and the recorded verdict.");
  lines.push("Recompute with:");
  lines.push("");
  lines.push("```sh");
  lines.push("npx -y -p @paystage/preflight paystage-verify-bundle proof.json");
  lines.push("```");
  lines.push("");
  if (verdictDependsOnProcessState(result)) {
    lines.push(
      "**Caveat:** this verdict was changed by the in-process payment-identifier replay cache. " +
        "A fresh process cannot reproduce it from `proof` alone; the cache state is not an input.",
    );
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Build the four artefacts for one evaluation.
 *
 * The result must be the evaluator's own result for these exact inputs. The builder does
 * not re-run the evaluator, so it cannot paper over a mismatch between the two.
 */
export async function buildEvidenceBundle(
  inputs: EvidenceBundleInputs,
  result: EvaluateResult,
): Promise<EvidenceBundle> {
  if (!Array.isArray(result.steps)) {
    // A result from an evaluator that does not emit steps is not a record of what ran.
    throw new Error(
      "evidence bundle: the evaluator result has no steps; upgrade @paystage/preflight rather than reconstructing them",
    );
  }

  const options = normaliseOptions(inputs.options);
  const canonicalInputs: Record<string, unknown> = {
    payment_required: inputs.payment_required,
    policy: inputs.policy,
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };

  const paymentRequiredHash = await sha256Hex(inputs.payment_required);
  const policyHash = await sha256Hex(inputs.policy);
  const optionsHash = await sha256Hex(options);
  const bundleId = await sha256Hex(canonicalInputs);

  const eventsJsonl = renderEventsJsonl(result.steps);
  const eventsHash = await sha256Hex(eventsJsonl);

  const hashes = {
    payment_required_sha256: paymentRequiredHash,
    policy_sha256: policyHash,
    options_sha256: optionsHash,
    inputs_sha256: bundleId,
    events_sha256: eventsHash,
  };

  const proof = {
    schema: EVIDENCE_PROOF_SCHEMA,
    bundle_id: bundleId,
    inputs: canonicalInputs,
    hashes,
    verdict: {
      decision: result.decision as Decision,
      reasons: result.reasons,
      summary: result.summary,
      ...(result.agent !== undefined ? { agent: result.agent } : {}),
      ...(result.selectedAccept !== undefined ? { selected_accept: result.selectedAccept } : {}),
      steps_count: result.steps.length,
      ...(verdictDependsOnProcessState(result) ? { process_state_dependent: true } : {}),
    },
  };

  const receipt =
    inputs.receipt === undefined || inputs.receipt === null
      ? undefined
      : receiptString(inputs.receipt);

  return {
    bundle_id: bundleId,
    events_jsonl: eventsJsonl,
    proof: canonicalize(proof),
    ...(receipt === undefined ? {} : { receipt }),
    summary_md: summaryMarkdown({
      bundleId,
      result,
      inputs: canonicalInputs,
      hashes,
      ...(inputs.receipt === undefined ? {} : { receipt: inputs.receipt }),
    }),
  };
}

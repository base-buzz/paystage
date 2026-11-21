/**
 * Errors an agent can act on, in one shape (RFC 9457 Problem Details).
 *
 * An autonomous caller cannot ask a clarifying question. A bare `{"error":"invalid_json"}` tells it that something was
 * wrong and nothing about whether to retry, what to change, or which field to look at — so it either gives up or retries
 * the same call, which is the retry storm the numbers below exist to prevent.
 *
 * Every problem carries:
 *  - `type` / `title` / `status` / `detail` / `instance` — RFC 9457's fields, so a generic client can render it;
 *  - `is_retriable` — whether trying again could ever work. Wrong input is not retriable; an upstream timeout is;
 *  - `retry_after_seconds` — only when retriable, so a client does not have to guess a backoff;
 *  - `field` and `fix` — where the fault is and the sentence to follow.
 *
 * `content-type` is `application/problem+json`, and the legacy `error` string stays in the body for one release: every
 * client written against the old shape keys on it.
 */

export interface ProblemDetails {
  type: string;
  title: string;
  status: number;
  detail: string;
  instance?: string;
  /** A machine name that survives wording changes. Kept equal to the old `error` value on purpose. */
  error: string;
  is_retriable: boolean;
  retry_after_seconds?: number;
  /** The parameter that caused it, when there is one. */
  field?: string;
  /** What to change in the next call, in the imperative. */
  fix?: string;
}

const BASE = "https://paystage.xyz/errors";

export function problem(input: {
  status: number;
  /** Stable machine name; also the legacy `error` value. */
  code: string;
  title: string;
  detail: string;
  instance?: string;
  retriable?: boolean;
  retryAfterSeconds?: number;
  field?: string;
  fix?: string;
}): ProblemDetails {
  const isRetriable = input.retriable === true;
  return {
    type: `${BASE}/${input.code}`,
    title: input.title,
    status: input.status,
    detail: input.detail,
    ...(input.instance !== undefined ? { instance: input.instance } : {}),
    error: input.code,
    is_retriable: isRetriable,
    // Only on a retriable problem: a number beside `is_retriable: false` invites a retry the caller should not make.
    ...(isRetriable && input.retryAfterSeconds !== undefined ? { retry_after_seconds: input.retryAfterSeconds } : {}),
    ...(input.field !== undefined ? { field: input.field } : {}),
    ...(input.fix !== undefined ? { fix: input.fix } : {}),
  };
}

/** Named problems for the cases this service actually returns, so the wording and the flag cannot drift apart. */
export const PROBLEMS = {
  invalidJson: (instance?: string) =>
    problem({
      status: 400,
      code: "invalid_json",
      title: "Request body is not valid JSON",
      detail: "The request body could not be parsed as JSON.",
      retriable: false,
      fix: "Send a body that parses as JSON (check for a trailing comma or an unquoted key), then retry once.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  missingPaymentRequired: (instance?: string) =>
    problem({
      status: 400,
      code: "missing_payment_required",
      title: "payment_required is required",
      detail: "The body has no payment_required object, so there is no payment to judge.",
      retriable: false,
      field: "payment_required",
      fix: "Pass the decoded x402 challenge: the object a server returned under `accepts` in its 402 response.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  agentIdType: (instance?: string) =>
    problem({
      status: 400,
      code: "agent_id_must_be_a_string",
      title: "agent_id must be a string",
      detail: "agent_id was present but not a string.",
      retriable: false,
      field: "agent_id",
      fix: "Send agent_id as a JSON string, or omit it entirely when the policy has no per-agent budgets.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  missingWallet: (instance?: string) =>
    problem({
      status: 400,
      code: "missing_wallet",
      title: "wallet is required",
      detail: "The body has no wallet address to inspect authorisations for.",
      retriable: false,
      field: "wallet",
      fix: "Pass the 0x-prefixed address whose outstanding allowances you want listed.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  evaluationFailed: (message: string, instance?: string) =>
    problem({
      status: 400,
      code: "evaluation_failed",
      title: "The policy or payment could not be evaluated",
      detail: message,
      retriable: false,
      fix: "The message names the field and the rule. Fix that field; retrying the same body will fail the same way.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  upstreamTimeout: (instance?: string) =>
    problem({
      status: 503,
      code: "upstream_timeout",
      title: "The payment facilitator did not answer in time",
      detail: "PayStage evaluates locally, but the facilitator probe before it timed out.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. Nothing was charged and no receipt was issued.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  unknownFormat: (format: string, instance?: string) =>
    problem({
      status: 400,
      code: "unknown_bundle_format",
      title: "Unknown bundle format",
      detail: `format=${format} is not one of json, events, proof, receipt, summary, or the default markdown bundle.`,
      retriable: false,
      field: "format",
      fix: "Use ?format=json for all four artefacts, or ?format=events|proof|receipt|summary for one, or no format for the human-readable bundle.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  unknownRun: (id: string, instance?: string) =>
    problem({
      status: 404,
      code: "run_not_found",
      title: "No evidence bundle with that id",
      detail: `No stored bundle has the id ${id}. The id is the SHA-256 of the canonical inputs; check that it was copied whole.`,
      retriable: false,
      field: "id",
      fix: "Use the bundle_id returned by the evaluation call that produced this record, or omit the request if it was never stored.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  receiptNotIssued: (id: string, instance?: string) =>
    problem({
      status: 404,
      code: "receipt_not_issued",
      title: "This bundle has no receipt",
      detail: `Bundle ${id} was recorded without a receipt, so there is nothing to serve at ?format=receipt.`,
      retriable: false,
      field: "format",
      fix: "Use ?format=json and read receipt:null, or check the bundle's summary for why no receipt was produced.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  storageNotConfigured: (instance?: string) =>
    problem({
      status: 503,
      code: "storage_not_configured",
      title: "Evidence bundle storage is not configured",
      detail:
        "This deployment has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so there is nowhere to read a bundle from. The bundle table and its migration exist in the repo; the deployment is what is missing.",
      retriable: false,
      fix: "Configure the two Supabase bindings and apply supabase/migrations/*_evidence_bundles.sql, then retry. Do not read this as an unknown id.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  storageUnavailable: (instance?: string) =>
    problem({
      status: 503,
      code: "storage_unavailable",
      title: "Evidence bundle storage did not answer",
      detail: "The bundle store rejected the read. The bundle may exist; this response cannot say.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. An empty bundle is never substituted for a failed read.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  invalidAddress: (instance?: string) =>
    problem({
      status: 400,
      code: "invalid_address",
      title: "That is not an EVM address",
      detail: "The path segment must be a 0x-prefixed, 40-hex-character EVM address.",
      retriable: false,
      field: "address",
      fix: "Pass the address you want observations for as 0x followed by 40 hex characters.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  payeeStorageNotConfigured: (instance?: string) =>
    problem({
      status: 503,
      code: "payee_storage_not_configured",
      title: "Payee observation storage is not configured",
      detail:
        "This deployment has no SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY, so there is nowhere to read observations from. Do not read this as an address with no observations.",
      retriable: false,
      fix: "Configure the two Supabase bindings and apply supabase/migrations/*_payee_observations.sql, then retry.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  payeeStorageUnavailable: (instance?: string) =>
    problem({
      status: 503,
      code: "payee_storage_unavailable",
      title: "Payee observation storage did not answer",
      detail: "The observation store rejected the read. This address may have observations; this response cannot say.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. An empty observation list is never substituted for a failed read.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  payeeStoreCorrupt: (instance?: string) =>
    problem({
      status: 503,
      code: "payee_store_corrupt",
      title: "A stored observation could not be read",
      detail:
        "At least one stored row is not a valid observation (unknown field or wrong value type). It was not dropped, because a missing row would look like a fact that was never observed.",
      retriable: false,
      fix: "Fix the offending row in payee_observations; the collector must write only the fields the classifier recognises.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  faucetAlreadyFunded: (resetsAt: string, hours: number, instance?: string) =>
    problem({
      status: 429,
      code: "faucet_already_funded",
      title: "This address has already been funded today",
      detail: `The faucet drips once per address per 24 hours. This address resets at ${resetsAt}.`,
      retriable: true,
      retryAfterSeconds: Math.max(60, hours * 3600),
      fix: "Wait until resetsAt, or drip to a different address — one you control, not one you generate per call.",
      ...(instance !== undefined ? { instance } : {}),
    }),
} as const;

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

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
  invalidMandate: (detail: string, instance?: string) =>
    problem({
      status: 400,
      code: "invalid_mandate",
      title: "The mandate input is malformed",
      detail,
      retriable: false,
      field: "mandate",
      fix: "Send `mandate: { mandate, history?, revocations? }` with the signed envelope and arrays for history/revocations, or omit the field to evaluate without a mandate.",
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
  invalidSerial: (serial: string, instance?: string) =>
    problem({
      status: 400,
      code: "invalid_serial",
      title: "That is not a mandate serial",
      detail: `The path segment ${JSON.stringify(serial)} is not a serial this endpoint accepts.`,
      retriable: false,
      field: "serial",
      fix: "Pass either the short code from the pass face (vch- followed by exactly three alphanumerics, e.g. vch-7F3) or the full URL-safe serial (vch_ followed by 22-64 characters).",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateOrgUnitInvalid: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_org_unit_invalid",
      title: "That is not an org unit this tenant can use",
      detail: reason,
      retriable: false,
      field: "org_unit",
      fix: "Send a lowercase slash-separated path whose first segment is the mint tenant, e.g. paystage/engineering/platform; or omit the field — a mandate with no unit is the tenant root.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  /**
   * The roll-up (#471) is a public read, so a bad unit is a client error and an unreadable store is a
   * 503. Neither is allowed to arrive as a zero total: a zero that means "not read" is the number this
   * endpoint exists to avoid.
   */
  rollupUnitRequired: (instance?: string) =>
    problem({
      status: 400,
      code: "rollup_unit_required",
      title: "The roll-up needs a unit",
      detail: "No `unit` query parameter was supplied, so there is no subtree to total.",
      retriable: false,
      field: "unit",
      fix: "Call /v1/public/rollup?unit=<tenant> (or <tenant>/<division>/...) with a path whose first segment is the tenant.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  rollupInvalidUnit: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "rollup_invalid_unit",
      title: "That is not an org unit path",
      detail: reason,
      retriable: false,
      field: "unit",
      fix: "Use lowercase slash-separated segments, 1-63 chars of a-z, 0-9 and '-' each, starting and ending alphanumeric, e.g. paystage/engineering/platform. The first segment is the tenant.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  rollupSourceUnavailable: (instance?: string) =>
    problem({
      status: 503,
      code: "rollup_source_unavailable",
      title: "The roll-up source did not answer",
      detail:
        "The mandate or event store rejected the read. No total is returned, because zero is not a safe substitute for 'could not read'.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. Do not read this as an empty division.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateSourceUnavailable: (instance?: string) =>
    problem({
      status: 503,
      code: "mandate_source_unavailable",
      title: "The mandate source did not answer",
      detail:
        "The configured mandate source rejected the read. The serial may exist; this response cannot say, and `unknown` is deliberately not substituted for a failed read.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. Do not read this as an unknown serial.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  /**
   * The mint route (#455): one named refusal per way an envelope, a serial or a caller can fail.
   *
   * These are separate codes rather than one `mint_refused` because the fixes differ: an unsigned
   * envelope needs the issuer to sign it, an unknown kid needs the verifier's key set checked, a past
   * expiry needs a fresh mandate, and an unauthorised caller needs a token it does not have. A single
   * code would make every one of those look like the same problem.
   */
  mandateMintUnauthorized: (instance?: string) =>
    problem({
      status: 401,
      code: "mandate_mint_unauthorized",
      title: "Only the mandate issuer may mint",
      detail:
        "Minting writes a capability, so it is not a public write. This request carried no service token, or a token this deployment does not hold.",
      retriable: false,
      fix: "Send `Authorization: Bearer <MANDATE_MINT_TOKEN>` from the issuer backend that holds the token. A console session, a browser and an agent are all refused by design.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateMintNotConfigured: (instance?: string) =>
    problem({
      status: 503,
      code: "mandate_mint_not_configured",
      title: "Minting is not configured on this deployment",
      detail:
        "A mint needs a mandate store, a tenant binding, a service token and a published receipt key. At least one of those is missing here, so the route refuses everyone rather than minting a capability it cannot later read.",
      retriable: false,
      fix: "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, MANDATE_TENANT_ID, MANDATE_MINT_TOKEN and RECEIPT_SIGNING_KEY_PKCS8 on the deployment, then retry once.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateMintStoreUnavailable: (instance?: string) =>
    problem({
      status: 503,
      code: "mandate_mint_store_unavailable",
      title: "The mandate store did not answer",
      detail:
        "The row could not be written or read back. No mandate was minted by this request; retrying may succeed.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. Do not tell a principal their mandate exists until this call succeeds.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateEnvelopeRequired: (instance?: string) =>
    problem({
      status: 400,
      code: "mandate_envelope_required",
      title: "The body carries no signed envelope",
      detail: "The body must contain an `envelope` object: the signed mandate to record.",
      retriable: false,
      field: "envelope",
      fix: "Send `{\"envelope\": <the object @paystage/mandate.issue() returned>}`. The serial comes from that object; a body-level `serial` is ignored.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateMalformed: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_malformed",
      title: "The envelope is not a mandate this store can record",
      detail: reason,
      retriable: false,
      field: "envelope",
      fix: "Re-read the package's `verify` status table: the reason above names the field or statement that failed. Fix that before retrying; the same body fails the same way.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateUnsigned: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_unsigned",
      title: "The envelope carries no signature",
      detail: reason,
      retriable: false,
      field: "envelope",
      fix: "The envelope must be produced by `@paystage/mandate.issue()` with the issuer's signing key. An unsigned object records a claim; it does not prove a principal granted it.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateTampered: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_tampered",
      title: "The envelope's signature does not match its payload",
      detail: reason,
      retriable: false,
      field: "envelope",
      fix: "Record the exact object `issue()` returned. Any edit after signing — even to a display label — breaks the signature and is refused.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateUnknownKid: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_unknown_kid",
      title: "The envelope names a key this deployment does not publish",
      detail: reason,
      retriable: false,
      field: "envelope",
      fix: "Read the key set this deployment publishes at /.well-known/paystage-receipt-key.json and sign with the matching `kid`. An unverifiable mandate is not a valid one.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateExpired: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_expired",
      title: "The envelope's signed expiry is already past",
      detail: reason,
      retriable: false,
      field: "envelope",
      fix: "Ask the principal for a fresh mandate with an `expires_at` in the future, then mint that one. A past expiry is refused rather than stored as an `expired` row, because a mint is the moment a capability starts.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateRevoked: (serial: string, instance?: string) =>
    problem({
      status: 409,
      code: "mandate_revoked",
      title: "This mandate has been revoked",
      detail: `Serial ${JSON.stringify(serial)} has a signed revocation statement, or a stored row already marked revoked. A revoked authority is not re-minted by this route.`,
      retriable: false,
      field: "envelope",
      fix: "Mint a new mandate with a new serial. Re-minting a revoked serial would make a revocation lose to a replayed envelope.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateAlreadyMinted: (serial: string, instance?: string) =>
    problem({
      status: 409,
      code: "mandate_already_minted",
      title: "This serial is already on record",
      detail: `Serial ${JSON.stringify(serial)} already has a row. The stored envelope is immutable, so a second mint would be an overwrite.`,
      retriable: false,
      field: "envelope",
      fix: "Read the existing record at GET /v1/mandate/:serial. If the mandate changed, issue a new one with a new serial rather than reusing this one.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateSerialNotMintable: (serial: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_serial_not_mintable",
      title: "The signed serial is not a mintable serial",
      detail:
        `The envelope's serial ${JSON.stringify(serial)} is not the full form (vch_ followed by 22-64 URL-safe characters). ` +
        "The vch-ABC short code on the pass face is three characters and is a display handle, not a capability — anyone could guess it.",
      retriable: false,
      field: "envelope",
      fix: "Issue the mandate with `generateSerial()` from @paystage/mandate. Serials are unguessable or they are not capabilities.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  /**
   * The revoke route (#503): revocation is a signed statement plus a row update, not a deletion.
   *
   * Every refusal is named for the same reason the mint's are: a bad token, a malformed statement and
   * an unknown serial are three different fixes, and a caller that cannot tell them apart will retry
   * the wrong one.
   */
  mandateRevokeForbidden: (instance?: string) =>
    problem({
      status: 403,
      code: "mandate_revoke_forbidden",
      title: "Only the mandate service may revoke",
      detail:
        "Revocation ends an authority, so it is a service write rather than a public one. This request carried no service token, or a token this deployment does not hold.",
      retriable: false,
      fix: "Send `Authorization: Bearer <MANDATE_REVOKE_TOKEN>` (or the mint token when no separate revoke token is configured) from the issuer or manager backend.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateRevokeNotConfigured: (instance?: string) =>
    problem({
      status: 503,
      code: "mandate_revoke_not_configured",
      title: "Revocation is not configured on this deployment",
      detail:
        "A revocation needs a mandate store, a service token and a published receipt key. At least one of those is missing here, so the route refuses everyone rather than accepting a statement it cannot verify.",
      retriable: false,
      fix: "Set SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, MANDATE_REVOKE_TOKEN (or MANDATE_MINT_TOKEN) and RECEIPT_SIGNING_KEY_PKCS8 on the deployment, then retry once.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateRevocationMalformed: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_revocation_malformed",
      title: "The body is not a signed revocation statement",
      detail: reason,
      retriable: false,
      field: "revocation",
      fix: "Send the exact object `revoke()` from @paystage/mandate returned: `{ v, serial, revoked_at, [, reason], kid, signature }`. Do not wrap it and do not edit it after signing.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateNotFound: (serial: string, instance?: string) =>
    problem({
      status: 404,
      code: "mandate_not_found",
      title: "No mandate with that serial is stored here",
      detail: `Serial ${JSON.stringify(serial)} has no row, so there is nothing to revoke.`,
      retriable: false,
      field: "serial",
      fix: "Check the serial from the pass. A serial this deployment never minted cannot be revoked, and a typo must not silently become a no-op.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateAlreadyRevoked: (serial: string, revokedAt: string, instance?: string) =>
    problem({
      status: 409,
      code: "mandate_already_revoked",
      title: "This mandate is already revoked",
      detail: `Serial ${JSON.stringify(serial)} was revoked at ${revokedAt}. The first revocation is the one this record keeps.`,
      retriable: false,
      field: "serial",
      fix: "Treat this as success. Do not send a second statement expecting a new timestamp: the existing revocation stands.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateRevokeStoreUnavailable: (instance?: string) =>
    problem({
      status: 503,
      code: "mandate_revoke_store_unavailable",
      title: "The mandate store did not answer",
      detail:
        "The row could not be read or updated. This response cannot say whether the revocation was recorded, so retrying the same statement is safe: a second success or a 409 both mean it is in force.",
      retriable: true,
      retryAfterSeconds: 5,
      fix: "Retry after the indicated delay. Do not tell a manager the pass is revoked until this call succeeds.",
      ...(instance !== undefined ? { instance } : {}),
    }),
  mandateRevocationRejected: (reason: string, instance?: string) =>
    problem({
      status: 400,
      code: "mandate_revocation_rejected",
      title: "The revocation statement did not verify",
      detail: reason,
      retriable: false,
      field: "revocation",
      fix: "Sign the statement with the key named by its `kid` over the exact payload `revocationPayload()` returns, and make its `serial` match the path serial.",
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

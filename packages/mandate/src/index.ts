/**
 * `@paystage/mandate` — a signed, scoped, revocable authority a seller can verify before serving.
 *
 * The envelope reuses the receipt signing scheme rather than defining a second one. See
 * `docs/specs/mandate.md` for the seller-facing explanation.
 */

export {
  MANDATE_ALG,
  MANDATE_KEY_ID,
  MANDATE_SERIAL_PREFIX,
  MANDATE_VERSION,
} from "./types.js";
export type {
  Mandate,
  MandatePayload,
  MandateScope,
  Revocation,
  RevocationPayload,
} from "./types.js";

export {
  generateSerial,
  issue,
  mandateDigest,
  mandatePayload,
  revocationPayload,
  revoke,
  verify,
} from "./envelope.js";
export type {
  IssueInput,
  IssueOptions,
  MandateVerification,
  MandateVerifyStatus,
  RevokeOptions,
  VerifyOptions,
} from "./envelope.js";

export { evaluateMandate } from "./evaluate.js";
export type {
  EvaluateMandateInput,
  MandateEvaluation,
  MandatePayment,
  MandateRule,
  MandateSpend,
} from "./evaluate.js";

export { evaluatePayment, buildReviewPacket } from "./evaluate.js";
export type {
  AcceptOption,
  PaymentResource,
  PaymentRequest,
  Decision,
  AcceptStatus,
  AcceptResult,
  EvaluateResult,
  ReviewPacket,
  ReviewPacketOptions,
} from "./evaluate.js";
export { normalizePaymentRequired } from "./normalize.js";
// The MCP server lives at `@paystage/preflight/mcp` and is not re-exported here.
//
// It used to be, which meant importing `evaluatePayment` loaded a module that imports
// @modelcontextprotocol/server — so every consumer paid for an MCP server they never called. The
// evaluator is a pure function; the transport is a separate concern and now a separate entry point.
export type {
  PaymentRequired,
  PaymentAccept,
  EvaluationResult,
  EvaluationDecision,
  AcceptEvaluation,
} from "./types.js";
export { isKnownDrainer, isNonReceivable, KNOWN_DRAINERS, NON_RECEIVABLE, SOURCES } from "./known-drainers.js";

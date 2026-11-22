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
// The Solana requirement checks and the optional `@x402/svm` peer. A host that wants the
// peer's own tables calls `loadSvmPeer()` once at start-up; without it the built-in copies
// run and the evaluation transcript records the peer's absence.
export {
  loadSvmPeer,
  currentSvmPeer,
  setSvmPeer,
  resetSvmPeer,
  isSolanaNetwork,
  validateSolanaAccept,
  SUPPORTED_SVM_NETWORKS,
  SVM_MAINNET_CAIP2,
  SVM_DEVNET_CAIP2,
  SVM_TESTNET_CAIP2,
  SVM_WILDCARD,
} from "./solana.js";
export type { SvmValidationPeer, SolanaAssertion } from "./solana.js";
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
export { SANCTIONED_ADDRESSES } from "./sanctioned-addresses.js";
export {
  buildEvidenceBundle,
  canonicalize as canonicalizeEvidence,
  sha256Hex as evidenceSha256Hex,
  verdictDependsOnProcessState,
  EVIDENCE_ARTEFACTS,
  EVIDENCE_PROOF_SCHEMA,
  EVIDENCE_SCHEMA,
} from "./evidence.js";
export type {
  EvidenceBundle,
  EvidenceBundleInputs,
  EvidenceBundleOptions,
} from "./evidence.js";
export { verifyBundle, describeVerification } from "./verify-bundle.js";
export type {
  BundleVerification,
  EvidenceProof,
  EvidenceProofVerdict,
  VerificationStatus,
} from "./verify-bundle.js";
export type { EvaluationStep, EvaluationStepOutcome } from "./evaluate.js";

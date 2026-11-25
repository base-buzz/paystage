/**
 * `@paystage/receipt-verify` — check a PayStage receipt with the receipt and
 * a fetch, without installing the MCP server.
 *
 * The public surface is deliberately the same vocabulary as `@paystage/mcp`'s
 * verifier so a caller can swap one for the other without translating statuses.
 */
export {
  DEFAULT_KEY_URL,
  JWK_ALG,
  RECEIPT_ALG,
  canonicalize,
  normalizePaymentDigest,
  receiptPayload,
  verifyReceipt,
} from "./verify.js";
export type { JwkLike, KeySource, ReceiptLike, VerifyOptions, VerifyVerdict } from "./verify.js";

/**
 * Receipt lifecycle (#413). Separate signed statements in the same receipt envelope; `verifyReceipt()`
 * above is unchanged and `verifyChain()` calls it for every link.
 */
export {
  LIFECYCLE_KIND,
  LIFECYCLE_KEY_ID,
  LIFECYCLE_STATES,
  issueLifecycle,
  receiptDigest,
  refund,
  verifyChain,
  verifyLifecycleEvent,
} from "./lifecycle.js";
export type {
  ChainFailureStatus,
  ChainPayment,
  ChainVerification,
  IssueLifecycleInput,
  IssueLifecycleOptions,
  LifecycleEvent,
  LifecycleEventBody,
  LifecycleEventStatus,
  LifecycleEventVerification,
  LifecycleKeyOptions,
  LifecycleState,
  RefundInput,
  VerifyChainOptions,
} from "./lifecycle.js";

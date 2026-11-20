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
  receiptPayload,
  verifyReceipt,
} from "./verify.js";
export type { JwkLike, KeySource, ReceiptLike, VerifyOptions, VerifyVerdict } from "./verify.js";

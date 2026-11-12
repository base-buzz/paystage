/**
 * Capture who actually paid.
 *
 * The most important number this project cannot currently report is "how many distinct
 * addresses paid us". Every event row has `tx_hash: null` because nothing read the settlement
 * receipt, so "external users" is unmeasurable and the honest answer to a stranger asking is
 * "we do not know".
 *
 * The x402 middleware settles before responding and echoes the result in `PAYMENT-RESPONSE`:
 * base64 JSON with `success`, `transaction` (or `txHash`), `network` and `payer`. Reading it
 * after the handler is the only place the payer exists — it is not in the request.
 *
 * Rules:
 *  - never change the response. This observes; it must not fail a payment that succeeded.
 *  - an unreadable or unsigned receipt is logged as a missing payer, never guessed at.
 *  - a free-tier call has no settlement at all and is skipped rather than recorded as unpaid.
 */

import type { MiddlewareHandler } from "hono";
import { recordEvent, sourceFromHeaders } from "./telemetry.js";

export interface SettlementReceipt {
  success?: boolean;
  payer?: string;
  transaction?: string;
  txHash?: string;
  network?: string;
}

/** Decode the `PAYMENT-RESPONSE` header. Returns null when absent or unparseable. */
export function decodeSettlement(header: string | null): SettlementReceipt | null {
  if (!header) return null;
  try {
    const json = typeof atob === "function"
      ? atob(header)
      : Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as SettlementReceipt;
  } catch {
    return null;
  }
}

/** Lowercase-normalise an address so the same payer cannot count twice by casing. */
export function normalisePayer(payer: unknown): string | null {
  if (typeof payer !== "string") return null;
  const trimmed = payer.trim().toLowerCase();
  return /^0x[0-9a-f]{40}$/.test(trimmed) ? trimmed : null;
}

export function settlementCaptureMiddleware(): MiddlewareHandler {
  return async (c, next) => {
    await next();

    // A free-tier call deliberately has no settlement; nothing to capture.
    if (c.get("paystageFree") === true) return;

    const receipt = decodeSettlement(
      c.res.headers.get("payment-response") ?? c.res.headers.get("PAYMENT-RESPONSE"),
    );
    if (receipt === null) return;

    const payer = normalisePayer(receipt.payer);
    const txHash = typeof receipt.transaction === "string"
      ? receipt.transaction
      : typeof receipt.txHash === "string"
        ? receipt.txHash
        : null;

    try {
      recordEvent(
        (c.env ?? {}) as never,
        {
          source: sourceFromHeaders(c.req),
          tool: c.req.path.replace("/v1/", ""),
          decision: receipt.success === false ? "settle_failed" : "settled",
          reason_codes: payer === null ? ["payer_unavailable"] : [],
          network: receipt.network ?? (c.env as { PAYSTAGE_NETWORK?: string } | undefined)?.PAYSTAGE_NETWORK ?? null,
          tx_hash: txHash,
          payer,
          request_id: c.req.header("x-paystage-request-id") ?? null,
        } as never,
        (p) => c.executionCtx?.waitUntil?.(p),
      );
    } catch (error) {
      // Telemetry must never fail a payment that already succeeded.
      console.log(JSON.stringify({ level: "warn", msg: "settlement_capture_failed", detail: String(error) }));
    }
  };
}

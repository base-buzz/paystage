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
import {
  provenanceFromHeaders,
  provenanceKeyFrom,
  recordEvent,
  sourceFromHeaders,
  type CallerProvenance,
  type TelemetrySource,
} from "./telemetry.js";

export interface SettlementReceipt {
  success?: boolean;
  payer?: string;
  transaction?: string;
  txHash?: string;
  network?: string;
  /** Atomic units the facilitator reports as settled. Present on a v2 settle response. */
  amount?: string | number;
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

/**
 * Atomic units → USDC. Returns null rather than assuming a scale: an amount we cannot read is a
 * missing number, and `null` is honest while `0.000` looks like "nobody paid".
 */
export function atomicToUsdc(atomic: unknown): number | null {
  const text =
    typeof atomic === "string" ? atomic.trim() : typeof atomic === "number" ? String(atomic) : null;
  if (text === null || !/^\d+$/.test(text)) return null;
  const value = Number(text) / 1e6;
  return Number.isFinite(value) ? value : null;
}

/**
 * The payee and amount the caller actually signed for.
 *
 * The settle receipt carries `amount` but not the payee, so the payee has to come from the payment
 * the client sent — base64 JSON with `accepted` requirements, under `payment-signature` (v2) or
 * `x-payment` (v1). Reading it here is not trust: it is the same document the facilitator settled
 * against, recorded so a later audit can compare the two.
 */
export function decodePaymentSignature(header: string | null | undefined): {
  payTo: string | null;
  atomicAmount: string | null;
} {
  if (!header) return { payTo: null, atomicAmount: null };
  try {
    const json = typeof atob === "function"
      ? atob(header)
      : Buffer.from(header, "base64").toString("utf8");
    const parsed = JSON.parse(json) as { accepted?: { payTo?: unknown; amount?: unknown } };
    const accepted = parsed?.accepted ?? {};
    return {
      payTo: normalisePayer(accepted.payTo),
      atomicAmount: typeof accepted.amount === "string" ? accepted.amount : null,
    };
  } catch {
    return { payTo: null, atomicAmount: null };
  }
}

/**
 * The row we record for a settlement. Pure, so the reason codes can be tested without a Worker.
 *
 * `amount_usdc` and `pay_to` were missing from every row until 2026-11-17 — the columns existed, were
 * queried by the lander strip, and were never written, so our own settled volume read 0.000 USDC while
 * the count was right. A missing field now says so in `reason_codes` instead of looking like no volume.
 */
export function settlementEvent(input: {
  receipt: SettlementReceipt;
  paymentHeader: string | null | undefined;
  tool: string;
  source: TelemetrySource;
  network?: string | null;
  requestId?: string | null;
  channel?: string | null;
  callerProvenance?: CallerProvenance;
}) {
  const payer = normalisePayer(input.receipt.payer);
  const txHash =
    typeof input.receipt.transaction === "string"
      ? input.receipt.transaction
      : typeof input.receipt.txHash === "string"
        ? input.receipt.txHash
        : null;
  const signed = decodePaymentSignature(input.paymentHeader);
  const atomic = typeof input.receipt.amount === "string" || typeof input.receipt.amount === "number"
    ? String(input.receipt.amount)
    : signed.atomicAmount;
  const amount = atomicToUsdc(atomic);

  const reasonCodes: string[] = [];
  if (payer === null) reasonCodes.push("payer_unavailable");
  if (amount === null) reasonCodes.push("amount_unavailable");
  if (signed.payTo === null) reasonCodes.push("payee_unavailable");

  return {
    source: input.source,
    tool: input.tool,
    decision: input.receipt.success === false ? "settle_failed" : "settled",
    reason_codes: reasonCodes,
    network: input.network ?? null,
    amount_usdc: amount,
    pay_to: signed.payTo,
    tx_hash: txHash,
    payer,
    request_id: input.requestId ?? null,
    channel: input.channel ?? null,
    caller_provenance: input.callerProvenance ?? "unknown",
  };
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

    try {
      recordEvent(
        (c.env ?? {}) as never,
        settlementEvent({
          receipt,
          paymentHeader: c.req.header("payment-signature") ?? c.req.header("x-payment") ?? null,
          tool: c.req.path.replace("/v1/", ""),
          source: sourceFromHeaders(c.req),
          network: receipt.network ?? (c.env as { PAYSTAGE_NETWORK?: string } | undefined)?.PAYSTAGE_NETWORK ?? null,
          requestId: c.req.header("x-paystage-request-id") ?? null,
          channel: c.get("channel") ?? null,
          callerProvenance: await provenanceFromHeaders(c.req, provenanceKeyFrom(c.env)),
        }) as never,
        (p) => c.executionCtx?.waitUntil?.(p),
      );
    } catch (error) {
      // Telemetry must never fail a payment that already succeeded.
      console.log(JSON.stringify({ level: "warn", msg: "settlement_capture_failed", detail: String(error) }));
    }
  };
}

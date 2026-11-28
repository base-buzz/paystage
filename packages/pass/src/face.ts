/**
 * The data that appears on a Vouch pass, derived from one signed mandate.
 *
 * This module decides **display**, never authority: `active` here means "not revoked, not expired, and
 * inside its issued window" based on inputs the caller supplies. The endpoint (#423) owns the live
 * verdict; a pass is a reminder, and its QR is the product.
 */

import type { Mandate, Revocation } from "@paystage/mandate";
import { InvalidMandateError } from "./errors.js";

/** The public page a pass QR points at. #423/#436 own the answer behind it. */
export const VERIFICATION_BASE = "https://paystage.xyz/m/";

/** The sibling brand. PayStage appears only in the "vouched by" line. */
export const PASS_BRAND = "Vouch";
export const VOUCHED_BY = "vouched by PayStage";

export type MandateState = "active" | "revoked" | "expired" | "not-yet-active";

export interface StateInput {
  /** Injectable clock; defaults to wall time. */
  now?: Date;
  /** Signed revocation statements the caller has seen. Any matching serial blocks generation. */
  revocations?: readonly Revocation[];
  /** Convenience for a caller that already knows the serial was revoked. */
  revoked?: boolean;
}

/**
 * Reject an object that is not shaped like a signed mandate. This does **not** verify the ES256
 * signature — the generator has no published key set and is not a verifier — but it refuses to print a
 * pass for an object with no signature at all, which is the difference between a mandate and a note.
 */
export function assertSignedMandate(mandate: unknown): asserts mandate is Mandate {
  if (mandate === null || typeof mandate !== "object") throw new InvalidMandateError("the value is not an object");
  const value = mandate as Partial<Mandate>;
  if (typeof value.serial !== "string" || value.serial.trim() === "") throw new InvalidMandateError("serial is missing");
  if (typeof value.principal !== "string" || value.principal.trim() === "") {
    throw new InvalidMandateError("principal is missing");
  }
  if (typeof value.agent !== "string" || value.agent.trim() === "") throw new InvalidMandateError("agent is missing");
  if (typeof value.signature !== "string" || value.signature.trim() === "") {
    throw new InvalidMandateError("no signature field — the object records a claim, not a grant");
  }
  if (value.scope === null || typeof value.scope !== "object") throw new InvalidMandateError("scope is missing");
  if (typeof value.scope.per_payment !== "string" || typeof value.scope.window_amount !== "string") {
    throw new InvalidMandateError("scope amounts are missing");
  }
  if (typeof value.scope.window_seconds !== "number") throw new InvalidMandateError("scope window is missing");
  if (typeof value.issued_at !== "string" || typeof value.expires_at !== "string") {
    throw new InvalidMandateError("issued_at or expires_at is missing");
  }
}

/**
 * The state this generator is willing to print. It does not verify signatures: the caller supplies
 * revocations it has already checked (or none), and a matching statement is treated as authoritative
 * even before its signature is checked. That is deliberately fail-closed for pass generation.
 */
export function mandateState(mandate: Mandate, input: StateInput = {}): MandateState {
  if (input.revoked === true) return "revoked";
  if (input.revocations?.some((revocation) => revocation?.serial === mandate.serial)) return "revoked";

  const now = input.now ?? new Date();
  const issued = Date.parse(mandate.issued_at);
  const expires = Date.parse(mandate.expires_at);
  if (Number.isNaN(issued) || Number.isNaN(expires)) return "expired";
  if (now.getTime() < issued) return "not-yet-active";
  if (now.getTime() > expires) return "expired";
  return "active";
}

/**
 * The short, readable-aloud reference (#502) — **kept for continuity, no longer printed as a code**.
 *
 * It was the QR's `altText` and the pass's SHORT CODE field, and it identifies nothing: `vch_DemoPass2026Vouch0000` reduces to
 * `vch-000`, and the verify page cannot resolve a short code at all — it wants the serial. A code that looks typeable and is not is
 * worse than no code, so the pass now prints the serial where a human reads it and this function is used only where a compact label is
 * genuinely wanted (a log line, not a document).
 */
export function shortCode(serial: string): string {
  const clean = String(serial ?? "").replace(/[^a-z0-9]/gi, "").toUpperCase();
  return `vch-${(clean.slice(-3) || "000").padStart(3, "0")}`;
}

/** `https://paystage.xyz/m/<serial>` — the only verification URL the pass carries. */
export function verificationUrl(serial: string): string {
  return `${VERIFICATION_BASE}${encodeURIComponent(serial)}`;
}

/**
 * The mandate has no asset/decimals field, so `$` is a display convention for whole units, not a claim
 * that the asset is USD. `paystage.xyz/m/<serial>` is where the seller checks the actual asset.
 */
export function formatUsd(value: string): string {
  const [whole, fraction = ""] = String(value).split(".");
  const decimals = fraction.length >= 2 ? fraction : fraction.padEnd(2, "0");
  return `$${whole}.${decimals}`;
}

/** A rolling window, named the same way `scripts/render-pass-assets.mjs` names it. */
export function formatWindow(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "per window";
  if (seconds === 86_400) return "per 24h";
  if (seconds % 86_400 === 0) return `per ${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `per ${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `per ${seconds / 60}m`;
  return `per ${seconds}s`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** `31 Jan 2027` — no locale, so a build machine and a phone print the same string. */
export function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return String(iso);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

export interface PassFace {
  brand: string;
  vouchedBy: string;
  serial: string;
  shortCode: string;
  principal: string;
  perPayment: string;
  windowAmount: string;
  windowSeconds: number;
  windowLabel: string;
  expiresAt: string;
  expiryLabel: string;
  verificationUrl: string;
}

/** All pass surfaces read this object, so Apple and Google cannot disagree about a number. */
export function passFace(mandate: Mandate): PassFace {
  return {
    brand: PASS_BRAND,
    vouchedBy: VOUCHED_BY,
    serial: mandate.serial,
    shortCode: shortCode(mandate.serial),
    principal: mandate.principal,
    perPayment: formatUsd(mandate.scope.per_payment),
    windowAmount: formatUsd(mandate.scope.window_amount),
    windowSeconds: mandate.scope.window_seconds,
    windowLabel: `per ${formatWindow(mandate.scope.window_seconds).replace(/^per /, "")}`,
    expiresAt: mandate.expires_at,
    expiryLabel: formatExpiry(mandate.expires_at),
    verificationUrl: verificationUrl(mandate.serial),
  };
}

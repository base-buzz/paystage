import { formatWindow, type MandatePayload, type MandateStatus, type SellerVerdict } from "@/lib/mandate";

/**
 * The four answers a counterparty can get, in the words the page renders.
 *
 * This module exists so the wording is testable without a browser or a fetch. The test that matters is the `unknown`
 * one: the sentence is blunt on purpose, and a later copy edit that softens it to "not found" must fail a check.
 *
 * The date in a revoked answer is the record's `as_of`, not a revocation timestamp — the public endpoint does not
 * publish one. "on or before" is what the record can actually support: at that instant it was already revoked.
 */

export const UNKNOWN_SENTENCE = "No mandate with that serial. Do not trust the pass.";

export interface VerifyAnswer {
  status: MandateStatus;
  sentence: string;
  next: string;
}

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** The day an expiry or a read falls on. Instants are shown in UTC on the page's detail row. */
export function formatDate(iso: string): string {
  const parsed = new Date(iso);
  return Number.isFinite(parsed.getTime()) ? DATE.format(parsed) : "";
}

export const UNKNOWN_ANSWER: VerifyAnswer = {
  status: "unknown",
  sentence: UNKNOWN_SENTENCE,
  next: "Do not accept it; ask the holder to show the pass again.",
};

/**
 * Map one record to one answer.
 *
 * `active` names both limits and the expiry because that is the whole reason a seller checks a pass. The other three
 * answers are shorter on purpose: the useful next step is the action line, not more facts about a dead pass.
 */
export function answerFor(payload: MandatePayload): VerifyAnswer {
  if (payload.status === "active") {
    if (!payload.scope) {
      return {
        status: "active",
        sentence: "This pass says it is active, but its limits could not be read. Do not rely on it.",
        next: "Do not accept it; ask the holder to show the pass again.",
      };
    }
    const { per_payment, window_amount, window_seconds, expires_at } = payload.scope;
    return {
      status: "active",
      sentence: `This pass is active. It permits up to $${per_payment} per purchase, $${window_amount} per ${formatWindow(
        window_seconds,
      )}, until ${formatDate(expires_at)}.`,
      next: "Check that these limits match the deal before you accept the pass.",
    };
  }

  if (payload.status === "revoked") {
    const date = formatDate(payload.as_of);
    return {
      status: "revoked",
      sentence: date
        ? `This pass was revoked on or before ${date}. Do not rely on it.`
        : "This pass was revoked. Do not rely on it.",
      next: "Do not accept it; ask the account holder for a current pass.",
    };
  }

  if (payload.status === "expired") {
    const date = payload.scope ? formatDate(payload.scope.expires_at) : "";
    return {
      status: "expired",
      sentence: date ? `This pass expired on ${date}. Do not rely on it.` : "This pass expired. Do not rely on it.",
      next: "Do not accept it; ask the account holder for a current pass.",
    };
  }

  return UNKNOWN_ANSWER;
}

/** The verdict field in a sentence, without adding a second policy: anything but `trust` is untrusted. */
export function verdictForDisplay(verdict: SellerVerdict | null | undefined): { label: string; meaning: string } {
  if (verdict === "trust") return { label: "trust", meaning: "the record says this pass is live" };
  if (verdict === "do_not_trust") return { label: "do not trust", meaning: "the record says this pass is not live" };
  return { label: "unknown", meaning: "the record does not say this pass is live" };
}

/**
 * A QR may carry a link rather than a bare serial; both end in the same serial. Only the `/v/` and `/m/` path shapes are
 * unwrapped — anything else is passed through and fails the serial shape check, which is the safe answer.
 */
export function serialFromInput(input: string): string {
  const text = input.trim();
  if (text === "") return "";
  try {
    const url = new URL(text);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length === 2 && (parts[0] === "v" || parts[0] === "m")) return parts[1];
  } catch {
    // Not a URL: a pasted serial is the normal case.
  }
  return text;
}

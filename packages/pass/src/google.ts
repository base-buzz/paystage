/**
 * Build the Google Wallet **object JSON** for one mandate.
 *
 * What is emitted, and why that form: Google's REST API accepts a `GenericClass` and a `GenericObject`
 * JSON; the "save to Google Wallet" button additionally needs a JWT signed by a service account. We
 * emit the two objects (no JWT), because the JWT requires issuer credentials that do not exist here.
 * The documented path is: create the class for the issuer, then insert or patch the object, or sign a
 * JWT whose `genericObjects` payload contains this object. See `docs/specs/pass.md` for the citations.
 *
 * The schema key `cardTitle` is Google's protocol field name; no visible string on the pass says
 * "card" or "credit".
 */

import type { Mandate, Revocation } from "@paystage/mandate";
import { InactiveMandateError, MissingGoogleIssuerError } from "./errors.js";
import { assertSignedMandate, mandateState, passFace, type PassFace } from "./face.js";

export const GOOGLE_ISSUER_ENV = "GOOGLE_WALLET_ISSUER_ID";

export interface GooglePassOptions {
  /** Numeric issuer id from the Google Wallet Business Console. Defaults to `GOOGLE_WALLET_ISSUER_ID`. */
  issuerId?: string;
  /** Optional suffix for the class; defaults to `vouch-pass`. */
  classSuffix?: string;
  /** Injectable clock; defaults to wall time. */
  now?: Date;
  /** Signed revocation statements the caller has seen. A match blocks generation. */
  revocations?: readonly Revocation[];
  /** Set when the caller already knows this serial was revoked. */
  revoked?: boolean;
}

export interface GoogleWalletArtifact {
  classId: string;
  objectId: string;
  classObject: Record<string, unknown>;
  object: Record<string, unknown>;
  face: PassFace;
}

function localized(value: string) {
  return { defaultValue: { language: "en-US", value } };
}

function textModule(id: string, header: string, body: string) {
  return { id, header, body };
}

/** Google object ids accept letters, digits, `.`, `_` and `-`; a serial is already close. */
function safeSuffix(value: string): string {
  return String(value).replace(/[^A-Za-z0-9._-]/g, "-");
}

/** The object, derived from the same face Apple reads, so the two cannot disagree about a number. */
function genericObject(face: PassFace, classId: string, id: string) {
  return {
    id,
    classId,
    state: "ACTIVE",
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    hexBackgroundColor: "#1A1F71",
    cardTitle: localized(face.brand),
    header: localized(`spends up to ${face.perPayment} per purchase`),
    subheader: localized(face.principal),
    logo: {
      sourceUri: { uri: "https://paystage.xyz/pass/logo.png" },
      contentDescription: localized(face.brand),
    },
    textModulesData: [
      textModule("principal", "PRINCIPAL", face.principal),
      textModule("per_payment", "PER PURCHASE", face.perPayment),
      textModule("window", "WINDOW", `${face.windowAmount} ${face.windowLabel}`),
      textModule("expires", "EXPIRES", face.expiryLabel),
      textModule("serial", "SERIAL", face.serial),
      textModule("mandate", "MANDATE ID", face.serial),
    ],
    barcode: {
      type: "QR_CODE",
      value: face.verificationUrl,
      alternateText: face.shortCode,
    },
    linksModuleData: {
      uris: [{ uri: face.verificationUrl, description: "Verify this pass" }],
    },
  };
}

/**
 * Build the class/object pair. A matching revocation or an expiry blocks generation, exactly as it does
 * for the Apple pass; the two artefacts for one mandate cannot disagree about whether it is live.
 */
export function buildGoogleWalletPass(mandate: Mandate, options: GooglePassOptions = {}): GoogleWalletArtifact {
  assertSignedMandate(mandate);
  const state = mandateState(mandate, options);
  if (state !== "active") {
    throw new InactiveMandateError(
      state,
      mandate.serial,
      state === "revoked" ? "a revocation statement names this serial" : "its expiry or issue window is not now",
    );
  }

  const issuerId = options.issuerId ?? process.env.GOOGLE_WALLET_ISSUER_ID;
  if (!issuerId || issuerId.trim() === "") throw new MissingGoogleIssuerError();

  const face = passFace(mandate);
  const suffix = safeSuffix(mandate.serial);
  const classId = `${issuerId}.${options.classSuffix ?? "vouch-pass"}`;
  const objectId = `${issuerId}.${suffix}`;

  const classObject = {
    id: classId,
    reviewStatus: "UNDER_REVIEW",
  };

  return { classId, objectId, classObject, object: genericObject(face, classId, objectId), face };
}

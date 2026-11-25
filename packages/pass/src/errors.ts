/**
 * Named failures. A generator that cannot sign must say which input is missing, not write an unsigned
 * artefact and let the caller discover it on a phone.
 */

/** Base class so callers can branch on `instanceof PassError` without matching message text. */
export class PassError extends Error {
  readonly code: string;

  constructor(name: string, code: string, message: string) {
    super(message);
    this.name = name;
    this.code = code;
  }
}

/** The mandate is not active, so no fresh pass may describe it. */
export class InactiveMandateError extends PassError {
  readonly status: string;

  constructor(status: string, serial: string, detail: string) {
    super(
      "InactiveMandateError",
      "mandate-not-active",
      `mandate ${serial} is ${status}: ${detail}. A pass is only generated for an active mandate.`,
    );
    this.status = status;
  }
}

/** The mandate is not shaped like a signed mandate at all. */
export class InvalidMandateError extends PassError {
  constructor(detail: string) {
    super("InvalidMandateError", "invalid-mandate", `not a signed mandate: ${detail}`);
  }
}

/**
 * No Apple signing certificate. The message names the environment variables and explicitly refuses the
 * unsigned/self-signed shortcut: an unsigned .pkpass is not a pass a phone will accept.
 */
export class MissingPassCertificateError extends PassError {
  constructor() {
    super(
      "MissingPassCertificateError",
      "missing-pass-certificate",
      "no Apple pass signing certificate: set APPLE_PASS_CERT to the .p12 path and APPLE_PASS_CERT_PASSWORD to its password. " +
        "This generator will not emit an unsigned or self-signed .pkpass and call it a pass.",
    );
  }
}

/** A certificate was supplied but its password was not. */
export class MissingPassCertificatePasswordError extends PassError {
  constructor() {
    super(
      "MissingPassCertificatePasswordError",
      "missing-pass-certificate-password",
      "APPLE_PASS_CERT is set but APPLE_PASS_CERT_PASSWORD is not. The .p12 cannot be opened without it.",
    );
  }
}

/** The .p12 was supplied but could not be read, or had no usable key/certificate. */
export class PassCertificateError extends PassError {
  constructor(detail: string) {
    super("PassCertificateError", "invalid-pass-certificate", `could not use the Apple pass certificate: ${detail}`);
  }
}

/** The certificate did not carry the Pass Type ID or team id, and no override was supplied. */
export class MissingPassMetadataError extends PassError {
  constructor(detail: string) {
    super(
      "MissingPassMetadataError",
      "missing-pass-metadata",
      `the signing certificate does not carry ${detail}; supply it as an option (or use the Apple-issued pass certificate).`,
    );
  }
}

/**
 * Google Wallet needs an issuer id before an object can be named. The object JSON is buildable offline;
 * the issuer account is not.
 */
export class MissingGoogleIssuerError extends PassError {
  constructor() {
    super(
      "MissingGoogleIssuerError",
      "missing-google-issuer",
      "no Google Wallet issuer id: set GOOGLE_WALLET_ISSUER_ID (or pass google.issuerId). " +
        "The object JSON can be built without it, but it cannot be inserted into Wallet without the issuer account.",
    );
  }
}

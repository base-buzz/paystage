/**
 * `@paystage/pass` — generate a Vouch spending pass from a signed mandate.
 *
 * Two artefacts, one face:
 *   - `.pkpass` for Apple Wallet, signed with a real Pass Type ID certificate;
 *   - Google Wallet class/object JSON for an issuer account.
 *
 * The buildable half stops at the artefact. Rendering on a phone needs an Apple Pass Type ID
 * certificate (#432) and a Google issuer account; without them the generator fails closed with a named
 * error rather than producing an unsigned pass. See `docs/specs/pass.md`.
 */

export {
  GOOGLE_ISSUER_ENV,
  buildGoogleWalletPass,
  type GooglePassOptions,
  type GoogleWalletArtifact,
} from "./google.js";
export {
  PASS_CERT_ENV,
  PASS_CERT_PASSWORD_ENV,
  loadSigningIdentity,
  signManifest,
  type CertificateOptions,
  type SignManifestOptions,
  type SigningIdentity,
} from "./certificate.js";
export {
  buildApplePass,
  type ApplePassArtifact,
  type ApplePassOptions,
} from "./apple.js";
export {
  DEFAULT_ASSETS_DIR,
  loadPassAssets,
  type AssetOptions,
  type PassAssets,
} from "./assets.js";
export {
  PASS_BRAND,
  VERIFICATION_BASE,
  assertSignedMandate,
  VOUCHED_BY,
  formatExpiry,
  formatUsd,
  formatWindow,
  mandateState,
  passFace,
  shortCode,
  verificationUrl,
  type MandateState,
  type PassFace,
  type StateInput,
} from "./face.js";
export {
  InactiveMandateError,
  InvalidMandateError,
  MissingGoogleIssuerError,
  MissingPassCertificateError,
  MissingPassCertificatePasswordError,
  MissingPassMetadataError,
  PassCertificateError,
  PassError,
} from "./errors.js";
export { createZip, listZip, readZipEntry, type ZipEntry, type ZipListing } from "./zip.js";

import type { Mandate, Revocation } from "@paystage/mandate";
import { buildApplePass, type ApplePassArtifact, type ApplePassOptions } from "./apple.js";
import { buildGoogleWalletPass, type GooglePassOptions, type GoogleWalletArtifact } from "./google.js";

export interface GeneratePassOptions extends ApplePassOptions, GooglePassOptions {
  /** Signed revocation statements the caller has seen. A match blocks both artefacts. */
  revocations?: readonly Revocation[];
  /** Set when the caller already knows this serial was revoked. */
  revoked?: boolean;
}

export interface GeneratedPass {
  apple: ApplePassArtifact;
  google: GoogleWalletArtifact;
}

/**
 * Both artefacts, or a named failure. Google is built after Apple so a missing certificate is the first
 * error a caller sees — the certificate is the harder blocker and the one this row must never fake.
 */
export async function generatePass(mandate: Mandate, options: GeneratePassOptions = {}): Promise<GeneratedPass> {
  const apple = await buildApplePass(mandate, options);
  const google = buildGoogleWalletPass(mandate, options);
  return { apple, google };
}

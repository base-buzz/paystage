/**
 * Build the Apple Wallet `.pkpass` for one mandate.
 *
 * The archive is a ZIP containing exactly: `pass.json`, `icon.png`, `logo.png`, `strip.png`,
 * `manifest.json` (SHA-1 per file) and `signature` (detached PKCS#7 over the manifest). It is signed
 * only when a certificate is supplied; with no certificate it throws `MissingPassCertificateError`
 * rather than emitting an artefact a phone would reject.
 */

import { createHash } from "node:crypto";
import type { Mandate, Revocation } from "@paystage/mandate";
import { loadPassAssets, type AssetOptions } from "./assets.js";
import { loadSigningIdentity, signManifest, type CertificateOptions } from "./certificate.js";
import { InactiveMandateError } from "./errors.js";
import { assertSignedMandate, mandateState, passFace, type PassFace } from "./face.js";
import { createZip, type ZipEntry } from "./zip.js";

export interface ApplePassOptions extends CertificateOptions, AssetOptions {
  /** Injectable clock; defaults to wall time. */
  now?: Date;
  /** Signed revocation statements the caller has seen. A match blocks generation. */
  revocations?: readonly Revocation[];
  /** Set when the caller already knows this serial was revoked. */
  revoked?: boolean;
}

export interface ApplePassArtifact {
  filename: string;
  /** The full `.pkpass` ZIP. */
  buffer: Buffer;
  /** The exact bytes stored as `manifest.json`. */
  manifest: Buffer;
  /** The detached PKCS#7 signature over `manifest`. */
  signature: Buffer;
  /** The exact bytes stored as `pass.json`. */
  passJson: Buffer;
  /** File name to SHA-1, in archive order. */
  files: Record<string, string>;
  pass: Record<string, unknown>;
  face: PassFace;
}

/** The back of the pass, shared by both style keys so the two faces cannot disagree about what this is. */
function backFields(face: PassFace) {
  return [
    field(
      "about",
      "WHAT THIS IS",
      "A Vouch spending pass issued under a signed mandate. It records what an agent was authorised to spend; it is not money and it cannot tap to pay.",
    ),
    field("verify", "VERIFY", face.verificationUrl),
    field("code", "SHORT CODE", face.shortCode),
    field("mandate", "MANDATE ID", face.serial),
    field("limits", "LIMITS", `${face.perPayment} per purchase; ${face.windowAmount} ${face.windowLabel}; expires ${face.expiryLabel}`),
    /**
     * The honest sentence about liveness (#503).
     *
     * A `.pkpass` is a **signed snapshot**, and Wallet cannot be told it changed without a web service that pushes an update — which this
     * pass does not have. So the card on a phone keeps saying what it said when it was issued, and a revoked mandate leaves it reading
     * "active". That is not a bug to hide behind wording: it is the reason the **link** is authoritative and the card is a receipt.
     *
     * Saying so on the back is what makes the product honest without pretending to infrastructure we do not run. The alternative — a
     * web service with device registration and APNs — is a real thing to build, and it is a different row.
     */
    field(
      "liveness",
      "THIS PASS DOES NOT UPDATE",
      "It is a signed snapshot from the moment it was issued; a phone cannot be told it changed. Revocation happens on the server, so this pass can read \"active\" after the mandate was revoked. The VERIFY link is the live answer — check it, not this pass.",
    ),
    field(
      "revocation",
      "REVOCATION",
      "Revocation is instant server-side. This pass is a reminder; the verification link is authoritative. A revoked or expired mandate invalidates it.",
    ),
    field("issuedby", "ISSUED BY", `${face.brand}, ${face.vouchedBy}`),
  ];
}

/** Apple's field object. Values are strings; a pass does not localise a mandate's numbers. */
function field(key: string, label: string, value: string) {
  return { key, label, value };
}

/** Visible copy. It deliberately never says "card" or "credit": this is a spending pass. */
function passJson(mandate: Mandate, face: PassFace, identity: { passTypeIdentifier: string; teamIdentifier: string }, organizationName: string) {
  return {
    formatVersion: 1,
    passTypeIdentifier: identity.passTypeIdentifier,
    serialNumber: mandate.serial,
    teamIdentifier: identity.teamIdentifier,
    organizationName,
    description: `Vouch spending pass for ${mandate.principal}`,
    logoText: face.vouchedBy,
    foregroundColor: "rgb(255,255,255)",
    backgroundColor: "rgb(26,31,113)",
    labelColor: "rgb(247,182,0)",
    /**
     * Two style keys on purpose (#447): `generic` is the face every iOS in the field can draw, and `posterGeneric` is
     * the iOS 27 poster style, which newer devices prefer when both are present. A pass carries one style key, so this
     * is the compatibility mechanism rather than a duplicate.
     *
     * Unverified until a device renders it: the *field groups inside* `posterGeneric` and its featured-action vocabulary
     * are assumed to follow the same header/primary/secondary/auxiliary/back shape as every other style. `featuredActions`
     * is deliberately absent — an invented action type is worse than a missing one, and a phone will tell us in ten
     * seconds once the certificate exists (#432).
     */
    generic: {
      headerFields: [field("principal", "PRINCIPAL", face.principal)],
      primaryFields: [field("limit", "UP TO", face.perPayment)],
      secondaryFields: [
        field("window", "WINDOW", `${face.windowAmount} ${face.windowLabel}`),
        field("expires", "EXPIRES", face.expiryLabel),
      ],
      auxiliaryFields: [field("serial", "SERIAL", face.serial)],
      backFields: backFields(face),
    },
    posterGeneric: {
      headerFields: [field("principal", "PRINCIPAL", face.principal)],
      primaryFields: [field("limit", "UP TO", face.perPayment)],
      secondaryFields: [
        field("window", "WINDOW", `${face.windowAmount} ${face.windowLabel}`),
        field("expires", "EXPIRES", face.expiryLabel),
      ],
      auxiliaryFields: [field("serial", "SERIAL", face.serial)],
      backFields: backFields(face),
    },
    barcodes: [
      {
        format: "PKBarcodeFormatQR",
        message: face.verificationUrl,
        messageEncoding: "iso-8859-1",
        altText: face.shortCode,
      },
    ],
  };
}

/**
 * Build the archive. The mandate must be active: a revoked or expired authority must never yield a
 * fresh-looking pass, even if the caller still holds the signed object.
 */
export async function buildApplePass(mandate: Mandate, options: ApplePassOptions = {}): Promise<ApplePassArtifact> {
  assertSignedMandate(mandate);
  const state = mandateState(mandate, options);
  if (state !== "active") {
    throw new InactiveMandateError(
      state,
      mandate.serial,
      state === "revoked" ? "a revocation statement names this serial" : `its expiry or issue window is not now`,
    );
  }

  const face = passFace(mandate);
  const assets = await loadPassAssets(options);
  const identity = await loadSigningIdentity(options);
  const organizationName = options.organizationName ?? face.brand;

  const pass = passJson(mandate, face, identity, organizationName);
  const passJsonBytes = Buffer.from(`${JSON.stringify(pass, null, 2)}\n`, "utf8");

  const files: Record<string, string> = {
    "pass.json": createHash("sha1").update(passJsonBytes).digest("hex"),
    "icon.png": createHash("sha1").update(assets.icon).digest("hex"),
    "logo.png": createHash("sha1").update(assets.logo).digest("hex"),
    "strip.png": createHash("sha1").update(assets.strip).digest("hex"),
  };
  const manifest = Buffer.from(`${JSON.stringify(files, null, 2)}\n`, "utf8");
  const signature = await signManifest(manifest, identity, { signingTime: options.signingTime });

  const entries: ZipEntry[] = [
    { name: "pass.json", data: passJsonBytes },
    { name: "icon.png", data: assets.icon },
    { name: "logo.png", data: assets.logo },
    { name: "strip.png", data: assets.strip },
    { name: "manifest.json", data: manifest },
    { name: "signature", data: signature },
  ];

  return {
    filename: `${mandate.serial}.pkpass`,
    buffer: createZip(entries),
    manifest,
    signature,
    passJson: passJsonBytes,
    files,
    pass,
    face,
  };
}

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
    storeCard: {
      primaryFields: [field("limit", "UP TO", face.perPayment)],
      secondaryFields: [
        field("principal", "PRINCIPAL", face.principal),
        field("expires", "EXPIRES", face.expiryLabel),
      ],
      auxiliaryFields: [
        field("window", "WINDOW", `${face.windowAmount} ${face.windowLabel}`),
        field("serial", "SERIAL", face.serial),
      ],
      backFields: [
        field(
          "about",
          "WHAT THIS IS",
          "A Vouch spending pass issued under a signed mandate. It records what an agent was authorised to spend; it is not money and it cannot tap to pay.",
        ),
        field("verify", "VERIFY", face.verificationUrl),
        field("code", "SHORT CODE", face.shortCode),
        field("mandate", "MANDATE ID", face.serial),
        field(
          "limits",
          "LIMITS",
          `${face.perPayment} per purchase; ${face.windowAmount} ${face.windowLabel}; expires ${face.expiryLabel}`,
        ),
        field(
          "revocation",
          "REVOCATION",
          "Revocation is instant server-side. This pass is a reminder; the verification link is authoritative. A revoked or expired mandate invalidates it.",
        ),
        field("issuedby", "ISSUED BY", `${face.brand}, ${face.vouchedBy}`),
      ],
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

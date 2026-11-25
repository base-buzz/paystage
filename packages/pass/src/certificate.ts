/**
 * Load an Apple pass signing identity from a PKCS#12 (.p12/.pfx) file and sign a manifest with PKCS#7.
 *
 * **Why pkijs is a dependency.** Node's standard library can read an X.509 certificate and import a
 * PKCS#8 private key, but it cannot parse a PKCS#12 container or construct a CMS/PKCS#7 SignedData.
 * Apple requires the detached PKCS#7 signature in every `.pkpass`; hand-rolling ASN.1 for that would be
 * a second PKI implementation in a payment project. `pkijs` is the maintained, typed implementation of
 * exactly those two formats (RFCS 7292/5652), so it is used instead of a bespoke encoder.
 *
 * The certificate is read from a path named by `APPLE_PASS_CERT`; its password from
 * `APPLE_PASS_CERT_PASSWORD`. Values are never logged, and no key is written to disk.
 */

import { readFile } from "node:fs/promises";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import {
  MissingPassCertificateError,
  MissingPassCertificatePasswordError,
  MissingPassMetadataError,
  PassCertificateError,
} from "./errors.js";

export const PASS_CERT_ENV = "APPLE_PASS_CERT";
export const PASS_CERT_PASSWORD_ENV = "APPLE_PASS_CERT_PASSWORD";

/** Pass Type IDs are a UID in the certificate subject; the team id is the OU. */
const UID_OID = "0.9.2342.19200300.100.1.1";
const OU_OID = "2.5.4.11";

export interface CertificateOptions {
  /** A .p12/.pfx path. Defaults to `APPLE_PASS_CERT`. */
  certificatePath?: string;
  /** The .p12 password. Defaults to `APPLE_PASS_CERT_PASSWORD`. */
  certificatePassword?: string;
  /** Override the certificate's UID if it does not carry a Pass Type ID. */
  passTypeIdentifier?: string;
  /** Override the certificate's OU if it does not carry the Apple team id. */
  teamIdentifier?: string;
  /** Shown to the holder. Buttons from the brand, not the legal entity. */
  organizationName?: string;
  /** Injected for deterministic signatures in tests. */
  signingTime?: Date;
}

export interface SigningIdentity {
  privateKey: CryptoKey;
  signingCertificate: pkijs.Certificate;
  certificates: pkijs.Certificate[];
  passTypeIdentifier: string;
  teamIdentifier: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function textOf(value: any): string | undefined {
  const raw = value?.valueBlock?.value;
  return typeof raw === "string" && raw.length > 0 ? raw : undefined;
}

function subjectValue(certificate: pkijs.Certificate, oid: string): string | undefined {
  return textOf(certificate.subject.typesAndValues.find((item) => item.type === oid)?.value);
}

async function importPrivateKey(pkcs8: ArrayBuffer): Promise<CryptoKey> {
  let algorithmId: string | undefined;
  try {
    algorithmId = pkijs.PrivateKeyInfo.fromBER(pkcs8).privateKeyAlgorithm.algorithmId;
  } catch {
    algorithmId = undefined;
  }

  if (algorithmId === "1.2.840.10045.2.1") {
    return crypto.subtle.importKey("pkcs8", pkcs8, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  }

  // Apple pass certificates are RSA. Anything unrecognised is tried as RSA and then reported by name
  // rather than silently producing a signature with a different scheme.
  return crypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, [
    "sign",
  ]);
}

/**
 * Parse the .p12 into a private key and its certificate chain.
 *
 * Failures are named (`missing-pass-certificate`, `missing-pass-certificate-password`,
 * `invalid-pass-certificate`) so a caller knows which environment variable to fix. The password and
 * the file contents never appear in an error.
 */
export async function loadSigningIdentity(options: CertificateOptions = {}): Promise<SigningIdentity> {
  const path = options.certificatePath ?? process.env.APPLE_PASS_CERT;
  if (!path || path.trim() === "") throw new MissingPassCertificateError();

  const password = options.certificatePassword ?? process.env.APPLE_PASS_CERT_PASSWORD;
  if (password === undefined) throw new MissingPassCertificatePasswordError();

  let bytes: Uint8Array;
  try {
    bytes = await readFile(path);
  } catch {
    throw new PassCertificateError(`could not read the file named by ${PASS_CERT_ENV}`);
  }

  let parsed: pkijs.PFX;
  try {
    parsed = pkijs.PFX.fromBER(toArrayBuffer(bytes));
    const passwordBytes = new TextEncoder().encode(password);
    await parsed.parseInternalValues({ password: toArrayBuffer(passwordBytes), checkIntegrity: true });
    const parsedSafe = parsed.parsedValue?.authenticatedSafe;
    if (!parsedSafe) throw new Error("no authenticated safe");
    await parsedSafe.parseInternalValues({
      safeContents: parsedSafe.safeContents.map((content) =>
        content.contentType === "1.2.840.113549.1.7.6" ? { password: toArrayBuffer(passwordBytes) } : {},
      ),
    });
  } catch {
    // A wrong password and a malformed file are the same recovery, and the password must not be echoed.
    throw new PassCertificateError(
      `the .p12 named by ${PASS_CERT_ENV} could not be opened with ${PASS_CERT_PASSWORD_ENV}`,
    );
  }

  let privateKey: CryptoKey | undefined;
  const certificates: pkijs.Certificate[] = [];

  const safeContents = (parsed.parsedValue?.authenticatedSafe?.parsedValue?.safeContents ?? []) as {
    value: pkijs.SafeContents;
  }[];
  for (const safe of safeContents) {
    for (const bag of safe.value.safeBags) {
      if (bag.bagValue instanceof pkijs.CertBag) {
        if (bag.bagValue.parsedValue instanceof pkijs.Certificate) certificates.push(bag.bagValue.parsedValue);
        continue;
      }
      if (!(bag.bagValue instanceof pkijs.PKCS8ShroudedKeyBag)) continue;

      try {
        const encrypted = new pkijs.EncryptedData({
          encryptedContentInfo: new pkijs.EncryptedContentInfo({
            contentEncryptionAlgorithm: bag.bagValue.encryptionAlgorithm,
            encryptedContent: bag.bagValue.encryptedData,
          }),
        });
        const pkcs8 = await encrypted.decrypt({ password: toArrayBuffer(new TextEncoder().encode(password)) });
        privateKey = await importPrivateKey(pkcs8);
      } catch {
        throw new PassCertificateError("the .p12 contains a private key that could not be decrypted or imported");
      }
    }
  }

  if (privateKey === undefined) throw new PassCertificateError("the .p12 has no private key");
  if (certificates.length === 0) throw new PassCertificateError("the .p12 has no certificate");

  const signingCertificate = certificates[0];
  const passTypeIdentifier = options.passTypeIdentifier ?? subjectValue(signingCertificate, UID_OID);
  if (!passTypeIdentifier) throw new MissingPassMetadataError("a Pass Type ID (subject UID)");

  const teamIdentifier = options.teamIdentifier ?? subjectValue(signingCertificate, OU_OID);
  if (!teamIdentifier) throw new MissingPassMetadataError("an Apple team id (subject OU)");

  return { privateKey, signingCertificate, certificates, passTypeIdentifier, teamIdentifier };
}

export interface SignManifestOptions {
  /** Injected for deterministic tests. */
  signingTime?: Date;
}

/**
 * A detached PKCS#7/CMS SignedData over the manifest bytes, with the signer's certificate (and any
 * chain in the .p12) embedded. The content itself is not attached: Apple hashes the manifest file
 * beside `signature`, so an attached copy is not the format.
 */
export async function signManifest(
  manifest: Uint8Array,
  identity: SigningIdentity,
  options: SignManifestOptions = {},
): Promise<Buffer> {
  const data = toArrayBuffer(manifest);
  const digest = await crypto.subtle.digest("SHA-256", data);

  // Signed attributes are covered by the signature; the messageDigest attribute covers the manifest.
  const signedAttrs = new pkijs.SignedAndUnsignedAttributes({
    type: 0,
    attributes: [
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.3", // contentType
        values: [new asn1js.ObjectIdentifier({ value: pkijs.id_ContentType_Data })],
      }),
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.5", // signingTime
        values: [new asn1js.UTCTime({ valueDate: options.signingTime ?? new Date() })],
      }),
      new pkijs.Attribute({
        type: "1.2.840.113549.1.9.4", // messageDigest
        values: [new asn1js.OctetString({ valueHex: new Uint8Array(digest) })],
      }),
    ],
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: pkijs.id_ContentType_Data }),
    signerInfos: [
      new pkijs.SignerInfo({
        version: 1,
        sid: new pkijs.IssuerAndSerialNumber({
          issuer: identity.signingCertificate.issuer,
          serialNumber: identity.signingCertificate.serialNumber,
        }),
        signedAttrs,
      }),
    ],
    certificates: identity.certificates,
  });

  await signedData.sign(identity.privateKey, 0, "SHA-256");

  const contentInfo = new pkijs.ContentInfo({
    contentType: pkijs.ContentInfo.SIGNED_DATA,
    content: signedData.toSchema(true),
  });
  return Buffer.from(contentInfo.toSchema().toBER());
}

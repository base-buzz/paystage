import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { issue, revoke, type Mandate, type MandateScope } from "@paystage/mandate";
import {
  MissingGoogleIssuerError,
  MissingPassCertificateError,
  MissingPassCertificatePasswordError,
  buildApplePass,
  buildGoogleWalletPass,
  generatePass,
  listZip,
  readZipEntry,
  shortCode,
  verificationUrl,
} from "../src/index.js";

/**
 * Offline: every key/certificate is generated in-process and every clock is injected. No network, no
 * committed certificate, no real Apple identity — a self-signed certificate proves the PKCS#7 path
 * works, and it is never an artefact the generator will accept as a phone-ready pass.
 */

const ISSUED = "2026-11-01T00:00:00.000Z";
const EXPIRES = "2026-12-01T00:00:00.000Z";
const NOW = new Date("2026-11-15T12:00:00.000Z");
const SCOPE: MandateScope = { per_payment: "2.00", window_amount: "20.00", window_seconds: 86_400 };

const toArrayBuffer = (bytes: Uint8Array): ArrayBuffer =>
  bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;

async function keypair() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as Record<string, unknown>;
  return { privateKey: pair.privateKey, jwk: { ...jwk, kid: "k-test", use: "sig", alg: "ES256" } };
}

async function signedMandate(overrides: Partial<{ expires_at: string; serial: string }> = {}) {
  const keys = await keypair();
  const mandate = await issue(
    {
      principal: "Northwind Ltd",
      agent: "shopping-agent-7",
      serial: overrides.serial ?? "vch_0123456789abcdefghijkl",
      scope: SCOPE,
      issued_at: ISSUED,
      expires_at: overrides.expires_at ?? EXPIRES,
    },
    { privateKey: keys.privateKey, kid: keys.jwk.kid as string, now: new Date(ISSUED) },
  );
  return { mandate, keys };
}

/** A throwaway self-signed certificate in a throwaway .p12. Test-only; not an Apple identity. */
async function makeP12() {
  const keys = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", keys.privateKey);

  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 12_345 });
  const add = (dn: pkijs.RelativeDistinguishedNames, oid: string, value: string) =>
    dn.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({ type: oid, value: new asn1js.Utf8String({ value }) }),
    );
  add(cert.issuer, "2.5.4.3", "Vouch Test");
  add(cert.issuer, "2.5.4.11", "TEAM12345");
  add(cert.issuer, "0.9.2342.19200300.100.1.1", "pass.xyz.paystage.vouch");
  cert.subject = cert.issuer;
  cert.notBefore.value = new Date("2026-01-01T00:00:00Z");
  cert.notAfter.value = new Date("2027-01-01T00:00:00Z");
  await cert.subjectPublicKeyInfo.importKey(keys.publicKey);
  await cert.sign(keys.privateKey, "SHA-256");

  const password = "testpass";
  const passwordBytes = toArrayBuffer(new TextEncoder().encode(password));
  const pfx = new pkijs.PFX({
    parsedValue: {
      integrityMode: 0,
      authenticatedSafe: new pkijs.AuthenticatedSafe({
        parsedValue: {
          safeContents: [
            {
              privacyMode: 0,
              value: new pkijs.SafeContents({
                safeBags: [
                  new pkijs.SafeBag({
                    bagId: "1.2.840.113549.1.12.10.1.2",
                    bagValue: new pkijs.PKCS8ShroudedKeyBag({
                      parsedValue: pkijs.PrivateKeyInfo.fromBER(pkcs8),
                    }),
                  }),
                ],
              }),
            },
            {
              privacyMode: 1,
              value: new pkijs.SafeContents({
                safeBags: [
                  new pkijs.SafeBag({
                    bagId: "1.2.840.113549.1.12.10.1.3",
                    bagValue: new pkijs.CertBag({ parsedValue: cert }),
                  }),
                ],
              }),
            },
          ],
        },
      }),
    },
  });
  const authSafe = pfx.parsedValue!.authenticatedSafe!;
  const keyBag = authSafe.parsedValue.safeContents[0].value.safeBags[0]
    .bagValue as pkijs.PKCS8ShroudedKeyBag;
  const protection = {
    password: passwordBytes,
    contentEncryptionAlgorithm: { name: "AES-CBC", length: 256 } as pkijs.ContentEncryptionAlgorithm,
    hmacHashAlgorithm: "SHA-256",
    iterationCount: 100_000,
  };
  await keyBag.makeInternalValues(protection);
  await authSafe.makeInternalValues({ safeContents: [{}, protection] });
  await pfx.makeInternalValues({
    password: passwordBytes,
    iterations: 100_000,
    pbkdf2HashAlgorithm: "SHA-256",
    hmacHashAlgorithm: "SHA-256",
  });

  const dir = await mkdtemp(join(tmpdir(), "paystage-pass-test-"));
  const path = join(dir, "pass.p12");
  await writeFile(path, Buffer.from(pfx.toSchema().toBER()));
  return { path, password, cert, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Every string value in a JSON tree. Protocol keys are not copy; values are what a holder sees. */
function stringValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (Array.isArray(node)) for (const item of node) stringValues(item, out);
  else if (node !== null && typeof node === "object") for (const value of Object.values(node)) stringValues(value, out);
  return out;
}

const sha1 = (bytes: Uint8Array) => createHash("sha1").update(bytes).digest("hex");

let fixture: Awaited<ReturnType<typeof makeP12>>;

beforeAll(async () => {
  fixture = await makeP12();
});

afterAll(async () => {
  await fixture.cleanup();
});

describe("@paystage/pass — the Apple archive", () => {
  it("builds the six-file ZIP in order, with a manifest that hashes every other file", async () => {
    const { mandate } = await signedMandate();
    const artifact = await buildApplePass(mandate, {
      certificatePath: fixture.path,
      certificatePassword: fixture.password,
      now: NOW,
      signingTime: NOW,
    });

    const entries = listZip(artifact.buffer);
    expect(entries.map((entry) => entry.name)).toEqual([
      "pass.json",
      "icon.png",
      "logo.png",
      "strip.png",
      "manifest.json",
      "signature",
    ]);

    const manifest = JSON.parse(readZipEntry(artifact.buffer, "manifest.json").toString("utf8"));
    expect(Object.keys(manifest)).toEqual(["pass.json", "icon.png", "logo.png", "strip.png"]);
    for (const [name, hash] of Object.entries(manifest)) {
      expect(hash).toBe(sha1(readZipEntry(artifact.buffer, name)));
    }
    expect(manifest).toEqual(artifact.files);
  });

  it("signs manifest.json with a detached PKCS#7 that verifies against the supplied certificate", async () => {
    const { mandate } = await signedMandate();
    const artifact = await buildApplePass(mandate, {
      certificatePath: fixture.path,
      certificatePassword: fixture.password,
      now: NOW,
      signingTime: NOW,
    });

    const manifest = readZipEntry(artifact.buffer, "manifest.json");
    const signature = readZipEntry(artifact.buffer, "signature");
    const contentInfo = pkijs.ContentInfo.fromBER(toArrayBuffer(signature));
    expect(contentInfo.contentType).toBe(pkijs.ContentInfo.SIGNED_DATA);

    const signedData = new pkijs.SignedData({ schema: contentInfo.content });
    // Detached: the content is not embedded in the signature; the manifest file beside it is the content.
    expect(signedData.encapContentInfo.eContent).toBeUndefined();
    const result = await signedData.verify({
      signer: 0,
      data: toArrayBuffer(manifest),
      trustedCerts: [fixture.cert],
      checkChain: false,
      extendedMode: true,
    });
    expect(result.signatureVerified).toBe(true);
  });

  it("carries the principal, scope, expiry, serial and QR verification URL from the mandate", async () => {
    const { mandate } = await signedMandate();
    const artifact = await buildApplePass(mandate, {
      certificatePath: fixture.path,
      certificatePassword: fixture.password,
      now: NOW,
    });
    const pass = JSON.parse(artifact.passJson.toString("utf8"));
    const back = Object.fromEntries(pass.generic.backFields.map((field: { key: string; value: string }) => [field.key, field.value]));

    expect(pass.serialNumber).toBe(mandate.serial);
    // #447: both style keys, because a pass carries one and the two iOS generations disagree about which.
    expect(pass.generic).toBeDefined();
    expect(pass.posterGeneric).toBeDefined();
    expect(pass.posterGeneric.backFields).toEqual(pass.generic.backFields);
    expect(pass.passTypeIdentifier).toBe("pass.xyz.paystage.vouch");
    expect(pass.teamIdentifier).toBe("TEAM12345");
    expect(pass.generic.primaryFields[0]).toMatchObject({ label: "UP TO", value: "$2.00" });
    // The principal moved to the header and the window to the secondary row when the poster face arrived: a poster
    // reads top-down, and a header is the only place iOS puts the holder's name at poster size.
    expect(pass.generic.headerFields).toEqual(
      expect.arrayContaining([expect.objectContaining({ key: "principal", value: "Northwind Ltd" })]),
    );
    expect(pass.generic.secondaryFields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ key: "window", value: "$20.00 per 24h" }),
        expect.objectContaining({ key: "expires", value: "1 Dec 2026" }),
      ]),
    );
    expect(pass.barcodes).toEqual([
      expect.objectContaining({
        format: "PKBarcodeFormatQR",
        message: `https://paystage.xyz/m/${mandate.serial}`,
        altText: shortCode(mandate.serial),
      }),
    ]);
    expect(back.verify).toBe(verificationUrl(mandate.serial));
    expect(back.mandate).toBe(mandate.serial);

    // The visible copy is a spending pass: no "card" and no "credit" anywhere a holder can read.
    expect(stringValues(artifact.pass).join(" ")).not.toMatch(/\b(?:card|credit)\b/i);
  });

  it("keeps the pass images at Apple's sizes and keeps the PayStage mark off the pass", async () => {
    const consoleDir = new URL("../../../../apps/console/public/pass/", import.meta.url);
    const logo = await readFile(new URL("../assets/logo.png", import.meta.url));
    // PNG IHDR: width and height are big-endian at bytes 16..23.
    expect(logo.readUInt32BE(16)).toBe(160);
    expect(logo.readUInt32BE(20)).toBe(50);

    if (!existsSync(new URL("icon.png", consoleDir))) return;
    for (const name of ["icon.png", "strip.png"]) {
      const packaged = await readFile(new URL(`../assets/${name}`, import.meta.url));
      const rendered = await readFile(new URL(name, consoleDir));
      expect(packaged.equals(rendered), `${name} drifted from apps/console/public/pass`).toBe(true);
    }
    // The pass is the Vouch sibling brand: its logo is not the PayStage site wordmark.
    expect(logo.equals(await readFile(new URL("logo.png", consoleDir)))).toBe(false);
  });
});

describe("@paystage/pass — a certificate is required, never faked", () => {
  it("fails closed with a named error when APPLE_PASS_CERT is absent", async () => {
    const { mandate } = await signedMandate();
    const savedCert = process.env.APPLE_PASS_CERT;
    const savedPassword = process.env.APPLE_PASS_CERT_PASSWORD;
    delete process.env.APPLE_PASS_CERT;
    delete process.env.APPLE_PASS_CERT_PASSWORD;
    try {
      await expect(buildApplePass(mandate, { now: NOW })).rejects.toMatchObject({
        name: "MissingPassCertificateError",
        code: "missing-pass-certificate",
      });
      await expect(buildApplePass(mandate, { now: NOW })).rejects.toThrow(/APPLE_PASS_CERT/);
    } finally {
      if (savedCert !== undefined) process.env.APPLE_PASS_CERT = savedCert;
      if (savedPassword !== undefined) process.env.APPLE_PASS_CERT_PASSWORD = savedPassword;
    }
  });

  it("names the password variable when the .p12 is supplied without a password", async () => {
    const { mandate } = await signedMandate();
    const savedPassword = process.env.APPLE_PASS_CERT_PASSWORD;
    delete process.env.APPLE_PASS_CERT_PASSWORD;
    try {
      await expect(
        buildApplePass(mandate, { certificatePath: fixture.path, now: NOW }),
      ).rejects.toBeInstanceOf(MissingPassCertificatePasswordError);
    } finally {
      if (savedPassword !== undefined) process.env.APPLE_PASS_CERT_PASSWORD = savedPassword;
    }
  });
});

describe("@paystage/pass — an inactive or unsigned mandate produces no pass", () => {
  it("refuses an object with no signature as invalid, not as an active mandate", async () => {
    const { mandate } = await signedMandate();
    const { signature: _signature, ...unsigned } = mandate;
    await expect(buildApplePass(unsigned as Mandate, { now: NOW })).rejects.toMatchObject({
      name: "InvalidMandateError",
      code: "invalid-mandate",
    });
  });

  it("refuses a revoked mandate, even with a signing certificate", async () => {
    const { mandate, keys } = await signedMandate();
    const revocation = await revoke(mandate, { privateKey: keys.privateKey, kid: "k-test", now: NOW });

    await expect(
      buildApplePass(mandate, {
        certificatePath: fixture.path,
        certificatePassword: fixture.password,
        now: NOW,
        revocations: [revocation],
      }),
    ).rejects.toMatchObject({ name: "InactiveMandateError", status: "revoked" });

    await expect(
      generatePass(mandate, {
        certificatePath: fixture.path,
        certificatePassword: fixture.password,
        issuerId: "3388000000000000000",
        now: NOW,
        revocations: [revocation],
      }),
    ).rejects.toMatchObject({ name: "InactiveMandateError", status: "revoked" });
  });

  it("refuses an expired mandate and one that has not started", async () => {
    const { mandate } = await signedMandate();
    await expect(buildApplePass(mandate, { now: new Date("2026-12-02T00:00:00Z") })).rejects.toMatchObject({
      name: "InactiveMandateError",
      status: "expired",
    });
    await expect(buildApplePass(mandate, { now: new Date("2026-10-01T00:00:00Z") })).rejects.toMatchObject({
      name: "InactiveMandateError",
      status: "not-yet-active",
    });
  });
});

describe("@paystage/pass — the Google object carries the same mandate", () => {
  it("emits a class and object with the same serial, principal and scope as the Apple face", async () => {
    const { mandate } = await signedMandate();
    const google = buildGoogleWalletPass(mandate, { issuerId: "3388000000000000000", now: NOW });
    const modules = Object.fromEntries(
      (google.object.textModulesData as { id: string; body: string }[]).map((module) => [module.id, module.body]),
    );

    expect(google.classObject.id).toBe("3388000000000000000.vouch-pass");
    expect(google.object.id).toBe(`3388000000000000000.${mandate.serial}`);
    expect(google.object).toMatchObject({
      classId: google.classId,
      state: "ACTIVE",
      barcode: {
        type: "QR_CODE",
        value: `https://paystage.xyz/m/${mandate.serial}`,
        alternateText: shortCode(mandate.serial),
      },
    });
    expect(modules).toMatchObject({
      principal: "Northwind Ltd",
      per_payment: "$2.00",
      window: "$20.00 per 24h",
      expires: "1 Dec 2026",
      serial: mandate.serial,
      mandate: mandate.serial,
    });
    expect(stringValues(google.object).join(" ")).not.toMatch(/\b(?:card|credit)\b/i);
  });

  it("fails closed with a named error when no issuer id is set", async () => {
    const { mandate } = await signedMandate();
    const saved = process.env.GOOGLE_WALLET_ISSUER_ID;
    delete process.env.GOOGLE_WALLET_ISSUER_ID;
    try {
      expect(() => buildGoogleWalletPass(mandate, { now: NOW })).toThrow(MissingGoogleIssuerError);
      expect(() => buildGoogleWalletPass(mandate, { now: NOW })).toThrow(/GOOGLE_WALLET_ISSUER_ID/);
    } finally {
      if (saved !== undefined) process.env.GOOGLE_WALLET_ISSUER_ID = saved;
    }
  });

  it("refuses a revoked mandate before an object is built", async () => {
    const { mandate, keys } = await signedMandate();
    const revocation = await revoke(mandate, { privateKey: keys.privateKey, kid: "k-test", now: NOW });
    expect(() =>
      buildGoogleWalletPass(mandate, {
        issuerId: "3388000000000000000",
        now: NOW,
        revocations: [revocation],
      }),
    ).toThrow(/revoked/);
  });
});

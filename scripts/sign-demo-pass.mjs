#!/usr/bin/env node
/**
 * Re-sign the demo `.pkpass` from the freshly rendered pass assets.
 *
 * The demo pass is a real Apple-signed artefact, not a placeholder: the pass face, icon, logo and strip inside it are
 * rasterised from `scripts/lib/pass-face.mjs`, so when the mark changes the archive must change too. This script rebuilds
 * the ZIP from the **existing** `pass.json` (its content is a product decision, not a brand one) and the **new** PNGs,
 * re-computes the SHA-1 manifest and signs it with the Pass Type ID certificate.
 *
 * The certificate password is read in-process from the file beside the `.p12`; it is never printed and never passed
 * through the environment of a child process. Both files are required to be mode 600.
 *
 *   node scripts/sign-demo-pass.mjs
 *
 * Exit 0 re-signed and self-verified · 2 the demo pass, certificate or password is missing/unreadable · 3 signing failed.
 */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createZip, listZip, loadSigningIdentity, readZipEntry, signManifest } from "../packages/pass/dist/index.js";

const DEMO = "apps/vouchguard/public/demo/vouch-demo.pkpass";
const PASS_DIR = "apps/console/public/pass";
const SECRETS = "/work/.secrets/apple-pass";
const CERT = process.env.APPLE_PASS_CERT ?? join(SECRETS, "pass.p12");
const PASSWORD_FILE = join(SECRETS, "pass.p12.password");

function fail(code, message) {
  console.error(`pass-sign: ${message}`);
  process.exit(code);
}

if (!existsSync(DEMO)) fail(2, `${DEMO} is missing — there is no pass.json to re-sign; restore it from git`);
if (!existsSync(CERT)) fail(2, `the .p12 is missing at ${CERT} (APPLE_PASS_CERT may name another path)`);
if (!existsSync(PASSWORD_FILE)) fail(2, `the password file is missing at ${PASSWORD_FILE}`);

/** Both are credentials; a world-readable copy is a leak, so refuse rather than quietly signing with it. */
for (const [label, path] of [
  ["certificate", CERT],
  ["password file", PASSWORD_FILE],
]) {
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) fail(2, `the ${label} ${path} is mode ${mode.toString(8)}, expected 600 — fix the mode, do not sign`);
}

const existing = readFileSync(DEMO);
let passJson;
try {
  passJson = readZipEntry(existing, "pass.json");
} catch {
  fail(2, `${DEMO} has no readable pass.json — restore the archive or rebuild it from a mandate`);
}

const assets = {
  "icon.png": readFileSync(join(PASS_DIR, "icon.png")),
  "logo.png": readFileSync(join(PASS_DIR, "logo.png")),
  "strip.png": readFileSync(join(PASS_DIR, "strip.png")),
};
for (const [name, bytes] of Object.entries(assets)) {
  if (bytes.length === 0) fail(2, `${PASS_DIR}/${name} is 0 bytes — render the pass assets first`);
}

/** The exact archive shape `buildApplePass()` writes: four files, then manifest, then signature. */
const files = {
  "pass.json": createHash("sha1").update(passJson).digest("hex"),
  "icon.png": createHash("sha1").update(assets["icon.png"]).digest("hex"),
  "logo.png": createHash("sha1").update(assets["logo.png"]).digest("hex"),
  "strip.png": createHash("sha1").update(assets["strip.png"]).digest("hex"),
};
const manifest = Buffer.from(`${JSON.stringify(files, null, 2)}\n`, "utf8");

// Read the password only into memory; never log it, never put it in a child process environment.
const password = readFileSync(PASSWORD_FILE, "utf8").replace(/\r?\n$/, "");
let signature;
try {
  const identity = await loadSigningIdentity({ certificatePath: CERT, certificatePassword: password });
  signature = await signManifest(manifest, identity, { signingTime: new Date() });
} catch (error) {
  fail(3, `signing failed — ${error instanceof Error ? error.message : String(error)}`);
}

const archive = createZip([
  { name: "pass.json", data: passJson },
  { name: "icon.png", data: assets["icon.png"] },
  { name: "logo.png", data: assets["logo.png"] },
  { name: "strip.png", data: assets["strip.png"] },
  { name: "manifest.json", data: manifest },
  { name: "signature", data: signature },
]);
writeFileSync(DEMO, archive);

/** Self-check: the archive reopens, every manifest SHA-1 matches the stored file, and the signature verifies. */
const names = listZip(archive).map((entry) => entry.name);
const expectedOrder = ["pass.json", "icon.png", "logo.png", "strip.png", "manifest.json", "signature"];
if (names.join(",") !== expectedOrder.join(",")) {
  fail(3, `the archive has ${names.join(", ")}, expected ${expectedOrder.join(", ")}`);
}
for (const [name, expected] of Object.entries(files)) {
  const actual = createHash("sha1").update(readZipEntry(archive, name)).digest("hex");
  if (actual !== expected) fail(3, `${name}: SHA-1 ${actual.slice(0, 12)} does not match the manifest ${expected.slice(0, 12)}`);
}

/**
 * Verify the detached PKCS#7 against the manifest with OpenSSL, when it is available. `-noverify` means "do not build a
 * chain to Apple's root" — that can only be settled by a phone, and the brand check says so. This proves the bytes that
 * were signed are the bytes in the archive.
 */
const dir = mkdtempSync(join(tmpdir(), "paystage-pass-sign-"));
try {
  const sigPath = join(dir, "signature.der");
  const manifestPath = join(dir, "manifest.json");
  writeFileSync(sigPath, signature);
  writeFileSync(manifestPath, manifest);
  try {
    execFileSync("openssl", ["cms", "-verify", "-inform", "DER", "-in", sigPath, "-content", manifestPath, "-binary", "-noverify", "-out", "/dev/null"], {
      stdio: "pipe",
    });
  } catch (error) {
    fail(3, `OpenSSL could not verify the detached signature — ${String(error.stderr ?? error.message).split("\n")[0]}`);
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`pass-sign: re-signed ${DEMO} — ${files ? Object.keys(files).length : 0} manifest file(s), signature ${signature.length} bytes, PKCS#7 verified (no Apple root chain offline)`);
console.log(`pass-sign: sha256 ${createHash("sha256").update(archive).digest("hex")}`);

/**
 * The one reader and validator for the repo-root `brand.json`.
 *
 * Plain ESM with JSDoc types, not TypeScript, on purpose: the Next app, this app's
 * `scripts/check-brand.mjs`, and the repo-root conformance tooling all import it. Node 20
 * (the CI version) cannot import a `.ts` file, and a second copy of the validator is how
 * the two ends drift.
 *
 * The five fork values live in `brand.json` and nowhere else. This module only names and
 * checks them; it never supplies a fallback for `name`, `wordmark`, `tint`, `domain` or
 * `mode`. A missing value is an error, because a silent default is a fork that deploys
 * with the reference branding without noticing.
 */

/** Exactly the keys the file may contain. Adding one is a deliberate schema change. */
export const BRAND_KEYS = Object.freeze([
  "name",
  "wordmark",
  "tint",
  "domain",
  "mode",
  "organizationName",
]);

/** @typedef {"demo" | "hosted" | "apple"} BrandMode */

/**
 * @typedef {object} BrandConfig
 * @property {string} name          Product name in prose, titles and the footer.
 * @property {string} wordmark      The text beside the mark in the Brand component.
 * @property {string} tint          Six-digit hex accent, applied as `--vg-brand`.
 * @property {string} domain        Bare hostname, no scheme and no trailing slash.
 * @property {BrandMode} mode       `demo` for the reference instance, `hosted` for a tenant,
 *                                  `apple` for a deployment that signs its own passes.
 * @property {string} organizationName  Apple pass organisation name, shown to the holder.
 */

/**
 * @typedef {object} BrandView
 * @property {string} name
 * @property {string} wordmark
 * @property {string} tint
 * @property {string} domain
 * @property {string} homepage     `https://<domain>/`
 * @property {string} verificationBase  `https://<domain>`
 * @property {string} title        The lander's `<title>`.
 * @property {string} description  The lander's meta description.
 * @property {Record<string, string>} cssVariables  `--vg-brand` for the root `<html>`.
 */

const HEX = /^#[0-9a-fA-F]{6}$/;
const DOMAIN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const MODES = ["demo", "hosted", "apple"];

/**
 * The same environment variable the pass package reads (`PASS_CERT_ENV` in
 * `packages/pass/src/certificate.ts`). The name is repeated rather than imported because
 * `apps/vouchguard` is outside the npm workspace, and because this check must run before
 * Next resolves pkijs: it only needs to know whether a path was supplied, not to parse a
 * .p12. The failure wording mirrors `MissingPassCertificateError` and names the variable.
 */
export const APPLE_PASS_CERT_ENV = "APPLE_PASS_CERT";

function fail(detail) {
  throw new Error(`brand.json: ${detail}`);
}

/**
 * Parse and validate the raw JSON. Unknown keys are rejected rather than ignored: a
 * misspelt `wordmark` would otherwise leave the fork showing the reference wordmark with
 * no error.
 *
 * @param {unknown} raw
 * @param {Record<string, string | undefined>} [env]
 * @returns {BrandConfig}
 */
export function parseBrandConfig(raw, env = process.env) {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    fail("must be a JSON object");
  }

  const input = /** @type {Record<string, unknown>} */ (raw);
  const keys = Object.keys(input);
  const unknown = keys.filter((key) => !BRAND_KEYS.includes(key));
  if (unknown.length > 0) {
    fail(
      `unknown ${unknown.length === 1 ? "key" : "keys"} ${unknown
        .map((key) => JSON.stringify(key))
        .join(", ")}. Allowed keys: ${BRAND_KEYS.join(", ")}.`,
    );
  }

  const missing = BRAND_KEYS.filter((key) => !(key in input));
  if (missing.length > 0) {
    fail(
      `missing ${missing.length === 1 ? "key" : "keys"} ${missing
        .map((key) => JSON.stringify(key))
        .join(", ")}.`,
    );
  }

  for (const key of ["name", "wordmark", "organizationName"]) {
    const value = input[key];
    if (typeof value !== "string" || value.trim() === "") {
      fail(`"${key}" must be a non-empty string`);
    }
  }

  if (typeof input.tint !== "string" || !HEX.test(input.tint)) {
    fail(`"tint" must be a six-digit hex colour like "#1a2b3c"`);
  }

  if (typeof input.domain !== "string" || !DOMAIN.test(input.domain)) {
    fail(`"domain" must be a bare hostname such as "pass.example.com" (no scheme, no path)`);
  }

  if (typeof input.mode !== "string" || !MODES.includes(input.mode)) {
    fail(`"mode" must be one of ${MODES.map((mode) => JSON.stringify(mode)).join(", ")}`);
  }

  const mode = /** @type {BrandMode} */ (input.mode);
  if (mode === "apple") {
    const certificate = env?.[APPLE_PASS_CERT_ENV];
    if (typeof certificate !== "string" || certificate.trim() === "") {
      // Mirrors packages/pass/src/errors.ts::MissingPassCertificateError on purpose: a
      // forker sees one sentence whether the build or the generator finds the gap first.
      fail(
        `mode is "apple" but no Apple pass signing certificate is configured: set ${APPLE_PASS_CERT_ENV} ` +
          `to the .p12 path and APPLE_PASS_CERT_PASSWORD to its password. ` +
          `This build will not emit an unsigned or self-signed .pkpass and call it a pass.`,
      );
    }
  }

  return {
    name: /** @type {string} */ (input.name),
    wordmark: /** @type {string} */ (input.wordmark),
    tint: /** @type {string} */ (input.tint),
    domain: /** @type {string} */ (input.domain),
    mode,
    organizationName: /** @type {string} */ (input.organizationName),
  };
}

/**
 * The values the lander already derives from the five fork values. Keeping this pure and
 * separate from React is what lets a test prove that changing `name`, `tint` or `domain`
 * changes the rendered page without snapshotting HTML.
 *
 * @param {BrandConfig} config
 * @returns {BrandView}
 */
export function brandView(config) {
  const homepage = `https://${config.domain}/`;
  return {
    name: config.name,
    wordmark: config.wordmark,
    tint: config.tint,
    domain: config.domain,
    homepage,
    verificationBase: `https://${config.domain}`,
    title: `${config.name} — a wallet pass for agent spending limits`,
    description:
      `${config.name} puts an agent's spending mandate on a wallet pass: per-purchase cap, ` +
      `per-24h cap, expiry and revocation. It is not a card, it holds no funds and it cannot tap to pay.`,
    cssVariables: { "--vg-brand": config.tint },
  };
}

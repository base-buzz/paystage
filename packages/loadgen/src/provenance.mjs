/**
 * Shared provenance signer (#431) — the client half of `apps/hosted/src/telemetry.ts`.
 *
 * Every one of our own senders (loadgen, the probe scripts, the CI checks) imports this file, so
 * there is exactly one implementation of the header format. It must stay byte-for-byte compatible
 * with the Worker's verifier:
 *
 *   x-paystage-provenance:     own-ci | own-loadgen | own-probe
 *   x-paystage-provenance-sig: lowercase hex HMAC-SHA256 of the raw UTF-8 header value
 *
 * The key is read from `process.env.PAYSTAGE_PROVENANCE_KEY` and nowhere else. When it is absent,
 * empty, or the runtime has no Web Crypto, this returns an empty object: the caller sends unsigned
 * and the gate records `unknown`, which is the correct and expected outcome, never an error.
 *
 * Nothing in this file logs. The key and the signature are never interpolated into a message, a
 * warning, or an exception — a signer that prints its inputs is a key leak waiting for a log shipper.
 */

/** The only values the verifier will return signed. A proof of `unknown` proves nothing. */
const OWN_VALUES = new Set(["own-ci", "own-loadgen", "own-probe"]);

const PROVENANCE_HEADER = "x-paystage-provenance";
const PROVENANCE_SIG_HEADER = "x-paystage-provenance-sig";

function envKey() {
  // `process` is present under nodejs_compat in the Worker and in every Node sender; the guard
  // keeps the signer safe in a runtime that has no `process` at all (it then reads as absent).
  if (typeof process === "undefined" || process.env === undefined) return undefined;
  return process.env.PAYSTAGE_PROVENANCE_KEY;
}

/**
 * Headers proving this call came from us, or `{}` when it cannot be proved.
 *
 * @param {string} value one of `own-ci`, `own-loadgen`, `own-probe`
 * @param {string | undefined} [key] defaults to `process.env.PAYSTAGE_PROVENANCE_KEY`
 * @returns {Promise<Record<string, string>>}
 */
export async function provenanceHeaders(value, key = envKey()) {
  if (typeof value !== "string" || !OWN_VALUES.has(value)) return {};
  if (typeof key !== "string" || key.length === 0) return {};

  try {
    const subtle = typeof crypto === "undefined" ? undefined : crypto.subtle;
    if (!subtle) return {};

    const encoder = new TextEncoder();
    const cryptoKey = await subtle.importKey(
      "raw",
      encoder.encode(key),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const mac = new Uint8Array(await subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
    const signature = Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");

    return { [PROVENANCE_HEADER]: value, [PROVENANCE_SIG_HEADER]: signature };
  } catch {
    // A signing failure is not the request's problem: send unsigned and let the gate say `unknown`.
    return {};
  }
}

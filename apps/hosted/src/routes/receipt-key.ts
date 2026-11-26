import { Hono } from "hono";
import { RECEIPT_ALG, RECEIPT_KEY_ID, publicKeyJwk } from "../receipt.js";

export const receiptKeyRoutes = new Hono();

/**
 * Publish the public half of the receipt signing key so any caller can verify a receipt without trusting this
 * service's word for it.
 *
 * **A JWKS, not a single key (#42).** One published key makes rotation a breaking change: publish a new one and every
 * receipt signed before it stops verifying, so the choice becomes "never rotate" or "break old receipts". A key set
 * with a `kid` on each entry makes rotation additive — a receipt keeps naming the key that signed it, and a verifier
 * selects by that name instead of assuming there is only one.
 *
 * Two shapes are served on purpose:
 *  - `/.well-known/paystage-receipt-key.json` — the JWKS (`{ keys: [...] }`): the standard path, and the one a new
 *    verifier should read;
 *  - `/v1/public/receipt-key.json` — the original single-key shape, kept because verifiers in the wild already read
 *    it. It now carries `keys` as well, so a reader can migrate without a flag day.
 *
 * With no key configured this answers `{ configured: false }` rather than 404: "this deployment signs nothing yet" is
 * a fact worth stating, and a 404 would be indistinguishable from a routing mistake.
 */

interface SigningKey {
  /** The key id this key signs under. Rotation appends rather than replaces. */
  key_id: string;
  pkcs8: string;
}

/**
 * The signing keys this deployment holds, current first.
 *
 * `RECEIPT_SIGNING_KEY_PKCS8` is the active key. `RECEIPT_SIGNING_KEYS_RETIRED` optionally carries `kid:pkcs8`
 * pairs, comma-separated, for keys rotated out while their receipts are still inside the max-age bound. Without it,
 * rotation invalidates every unexpired receipt, which is the problem this exists to remove.
 */
function keySet(env: Record<string, string | undefined>): SigningKey[] {
  const keys: SigningKey[] = [];
  if (env.RECEIPT_SIGNING_KEY_PKCS8) {
    keys.push({ key_id: env.RECEIPT_SIGNING_KEY_ID ?? RECEIPT_KEY_ID, pkcs8: env.RECEIPT_SIGNING_KEY_PKCS8 });
  }
  for (const entry of (env.RECEIPT_SIGNING_KEYS_RETIRED ?? "").split(",")) {
    const separator = entry.indexOf(":");
    if (separator < 0) continue;
    const kid = entry.slice(0, separator).trim();
    const pkcs8 = entry.slice(separator + 1).trim();
    if (kid && pkcs8) keys.push({ key_id: kid, pkcs8 });
  }
  return keys;
}

/**
 * The key set this deployment publishes, derived from the signing keys it holds.
 *
 * Exported (#455) because the mint route must verify an envelope against exactly the keys a seller
 * reads from `/.well-known/paystage-receipt-key.json`; deriving a second set inside the route would be
 * a place for the two to drift. `kid`, `use` and `alg` are what let a verifier pick an entry rather
 * than trying all of them.
 */
export async function publishedReceiptJwks(
  env: Record<string, string | undefined>,
): Promise<Record<string, unknown>[]> {
  const out: Record<string, unknown>[] = [];
  for (const key of keySet(env)) {
    const jwk = await publicKeyJwk(key.pkcs8);
    if (jwk === undefined) continue;
    out.push({ ...jwk, kid: key.key_id, use: "sig", alg: "ES256" });
  }
  return out;
}

const CACHE = { "cache-control": "public, max-age=300, s-maxage=300" };

/** The JWKS. Standard path, and the one a new verifier should read. */
receiptKeyRoutes.get("/.well-known/paystage-receipt-key.json", async (c) => {
  const env = (c.env ?? {}) as Record<string, string | undefined>;
  const keys = await publishedReceiptJwks(env);
  if (keys.length === 0) {
    return c.json({ keys: [], configured: false, alg: RECEIPT_ALG }, 200, CACHE);
  }
  return c.json({ keys, configured: true, alg: RECEIPT_ALG }, 200, CACHE);
});

/** The original single-key shape, now carrying the set as well. */
receiptKeyRoutes.get("/v1/public/receipt-key.json", async (c) => {
  const env = (c.env ?? {}) as Record<string, string | undefined>;
  const keys = await publishedReceiptJwks(env);
  const active = keys[0];
  if (active === undefined) {
    return c.json({ configured: false, alg: RECEIPT_ALG, key_id: RECEIPT_KEY_ID, keys: [] }, 200, CACHE);
  }
  const { kid, use, alg, ...jwk } = active as Record<string, unknown> & { kid?: string };
  return c.json({ configured: true, alg: RECEIPT_ALG, key_id: kid, jwk, keys }, 200, CACHE);
});

import { Hono } from "hono";
import { RECEIPT_ALG, RECEIPT_KEY_ID, publicKeyJwk } from "../receipt.js";

export const receiptKeyRoutes = new Hono();

/**
 * Publish the public half of the receipt signing key so any caller can verify a
 * receipt without trusting this service's word for it.
 *
 * With no key configured this answers `{ configured: false }` rather than 404:
 * "this deployment signs nothing yet" is a fact worth stating, and a 404 would
 * be indistinguishable from a routing mistake.
 */
receiptKeyRoutes.get("/v1/public/receipt-key.json", async (c) => {
  const pkcs8 = (c.env as { RECEIPT_SIGNING_KEY_PKCS8?: string } | undefined)
    ?.RECEIPT_SIGNING_KEY_PKCS8;
  if (!pkcs8) {
    return c.json({ configured: false, alg: RECEIPT_ALG, key_id: RECEIPT_KEY_ID }, 200);
  }
  const jwk = await publicKeyJwk(pkcs8);
  if (jwk === undefined) {
    return c.json({ configured: false, error: "key_unreadable", alg: RECEIPT_ALG }, 200);
  }
  return c.json({ configured: true, alg: RECEIPT_ALG, key_id: RECEIPT_KEY_ID, jwk }, 200);
});

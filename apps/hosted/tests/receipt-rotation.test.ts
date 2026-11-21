import { describe, it, expect } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { receiptKeyRoutes } from "../src/routes/receipt-key.js";
import { buildReceipt, type Receipt } from "../src/receipt.js";
// The built verifier the MCP CLI itself runs. `npm run build` produces it before the
// hosted typecheck and tests (ci.yml and scripts/ci-local.mjs both build first), and the
// source module reads `globalThis.crypto`, which this app's Workers tsconfig does not
// expose as a property — so the dist module is the one that typechecks here.
import {
  verifyReceipt,
  type ReceiptLike,
  type VerifyVerdict,
} from "../../../packages/mcp/dist/verify.js";

/**
 * Receipt key rotation (#314).
 *
 * Rotation is only real if a receipt signed before the rotation still verifies
 * afterwards. That has two halves which can drift apart without a test:
 *
 *  1. the key endpoint keeps publishing the retired key, after the active one, and
 *  2. the verifier selects an entry by the receipt's `kid` instead of assuming a
 *     single key (or trying every key and accepting the first that fits).
 *
 * So the failure this file is built around is not "a signature verifies". It is
 * "the old receipt verifies against the rotated key set, and stops verifying when
 * `RECEIPT_SIGNING_KEYS_RETIRED` is dropped". Delete the retired-key loop and three
 * of these tests fail.
 *
 * Keys are two throwaway P-256 pairs generated per run: no fixture, no secret,
 * no network. The verifier's fetch is wired straight to the route, so the real
 * JWKS-selection path runs without leaving the process.
 */

const ACTIVE_KID = "receipt-key-b";
const RETIRED_KID = "receipt-key-a";
const UNKNOWN_KID = "receipt-key-never-published";
const KEY_URL = "https://receipt-key.test/.well-known/paystage-receipt-key.json";
const NOW = new Date("2026-11-20T00:00:00.000Z");

const decision = { decision: "pay", reasons: [] };
const policy = { version: 1, allowed_networks: ["eip155:8453"] };
const request = { scheme: "exact", network: "eip155:8453", payTo: "0x000000000000000000000000000000000000dEaD" };

interface ThrowawayKey {
  /** Base64 PKCS#8, the shape the Worker env vars take. */
  pkcs8: string;
  /** Public coordinates, so a test can prove the published entry is this key. */
  x: string;
  y: string;
}

function makeKey(): ThrowawayKey {
  const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pkcs8 = privateKey.export({ format: "der", type: "pkcs8" }).toString("base64");
  const jwk = publicKey.export({ format: "jwk" });
  if (jwk.x === undefined || jwk.y === undefined) throw new Error("generated key has no public coordinates");
  return { pkcs8, x: jwk.x, y: jwk.y };
}

const keyA = makeKey();
const keyB = makeKey();

/** The environment after rotating a -> b, with a retained for its unexpired receipts. */
const rotatedEnv: Record<string, string> = {
  RECEIPT_SIGNING_KEY_PKCS8: keyB.pkcs8,
  RECEIPT_SIGNING_KEY_ID: ACTIVE_KID,
  RECEIPT_SIGNING_KEYS_RETIRED: `${RETIRED_KID}:${keyA.pkcs8}`,
};

/** The same environment if someone forgets to configure the retired key. */
const activeOnlyEnv: Record<string, string> = {
  ...rotatedEnv,
  RECEIPT_SIGNING_KEYS_RETIRED: "",
};

interface JwksBody {
  configured?: boolean;
  keys?: Array<Record<string, unknown> & { kid?: string }>;
}

async function serveJwks(env: Record<string, string>): Promise<JwksBody> {
  const res = await receiptKeyRoutes.fetch(new Request(KEY_URL), env as never);
  expect(res.status).toBe(200);
  return (await res.json()) as JwksBody;
}

/** Verify through the real mcp verifier, whose key fetch is the route itself. */
async function verifyViaRoute(receipt: Receipt, env: Record<string, string>): Promise<VerifyVerdict> {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    return receiptKeyRoutes.fetch(new Request(String(input)), env as never);
  }) as unknown as typeof fetch;
  return verifyReceipt(receipt as unknown as ReceiptLike, { keyUrl: KEY_URL, fetchImpl, now: NOW });
}

function signWith(key: ThrowawayKey, keyId: string): Promise<Receipt> {
  return buildReceipt({
    decision,
    request,
    policy,
    signingKeyPkcs8B64: key.pkcs8,
    keyId,
    now: NOW,
  });
}

describe("receipt key rotation", () => {
  it("serves both kids, with the active key first", async () => {
    const body = await serveJwks(rotatedEnv);

    expect(body.configured).toBe(true);
    expect(body.keys?.map((k) => k.kid)).toEqual([ACTIVE_KID, RETIRED_KID]);
    for (const key of body.keys ?? []) {
      expect(key.alg).toBe("ES256");
      expect(key.use).toBe("sig");
      expect(key.kty).toBe("EC");
    }
  });

  it("publishes the retired kid's actual public key, not a copy of the active one", async () => {
    const body = await serveJwks(rotatedEnv);
    const active = body.keys?.[0];
    const retired = body.keys?.[1];

    expect({ x: active?.x, y: active?.y }).toEqual({ x: keyB.x, y: keyB.y });
    expect({ x: retired?.x, y: retired?.y }).toEqual({ x: keyA.x, y: keyA.y });
    expect(active?.x).not.toBe(retired?.x);
  });

  it("verifies a receipt signed before rotation, selecting the retired kid", async () => {
    const oldReceipt = await signWith(keyA, RETIRED_KID);
    expect(oldReceipt.key_id).toBe(RETIRED_KID);

    const verdict = await verifyViaRoute(oldReceipt, rotatedEnv);

    expect(verdict).toMatchObject({ ok: true, status: "signed-and-valid", key_id: RETIRED_KID });
  });

  it("verifies a receipt signed by the new active key", async () => {
    const newReceipt = await signWith(keyB, ACTIVE_KID);
    expect(newReceipt.key_id).toBe(ACTIVE_KID);

    const verdict = await verifyViaRoute(newReceipt, rotatedEnv);

    expect(verdict).toMatchObject({ ok: true, status: "signed-and-valid", key_id: ACTIVE_KID });
  });

  it("refuses a receipt whose kid is not published, even when its signature would verify under a published key", async () => {
    // Signed by key A but stamped with a kid that is not in the set. The signature is
    // genuine, so a verifier that tried every key and accepted a match would pass this.
    // Selecting by kid and refusing an unmatched kid is what makes the set a key set.
    const strayKid = await signWith(keyA, UNKNOWN_KID);

    const verdict = await verifyViaRoute(strayKid, rotatedEnv);

    expect(verdict).toMatchObject({ ok: false, status: "unverifiable" });
    if (verdict.ok) throw new Error("unreachable: stray kid must not verify");
    expect(verdict.reason).toContain(UNKNOWN_KID);
    expect(verdict.status).not.toBe("signed-and-valid");
  });

  it("rejects the pre-rotation receipt when RECEIPT_SIGNING_KEYS_RETIRED is empty", async () => {
    const oldReceipt = await signWith(keyA, RETIRED_KID);

    const body = await serveJwks(activeOnlyEnv);
    expect(body.keys?.map((k) => k.kid)).toEqual([ACTIVE_KID]);

    const verdict = await verifyViaRoute(oldReceipt, activeOnlyEnv);

    expect(verdict).toMatchObject({ ok: false, status: "unverifiable" });
    expect(verdict.status).not.toBe("signed-and-valid");
  });
});

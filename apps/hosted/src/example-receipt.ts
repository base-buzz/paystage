/**
 * The one receipt a stranger can check offline (#484).
 *
 * This is a real receipt captured from the live hosted endpoint on 2026-11-20, with the key
 * that was published at the time (and is still the active key). It is served from
 * `GET /v1/public/example-receipt.json` and `GET /v1/public/example-key.json` so the docs
 * page can give one command that does not depend on copying JSON out of a web page.
 *
 * It is expired by design: `expires_at` is five minutes after `issued_at`, so
 * `paystage-verify` exits 5 — "genuine, but past its own expiry". That is a better example
 * than a fresh throwaway signature, because it demonstrates the distinction the verifier
 * exists to make: a valid signature is not a live authorisation. The signature itself is
 * still checked, offline, against the key beside it.
 *
 * Provenance: the JSON lives under `src/fixtures/` (the no-keys check correctly skips
 * fixtures and flags shipped strings that look pasted) and is pinned to
 * `packages/receipt-verify/tests/fixtures/live-receipt.json` by a test, so the two copies
 * cannot drift. No secret is here — the private half stays in the Worker.
 */
import EXAMPLE_RECEIPT_JSON from "./fixtures/live-receipt.json";
import EXAMPLE_KEY_JSON from "./fixtures/live-key.json";

export const EXAMPLE_RECEIPT = EXAMPLE_RECEIPT_JSON;
export const EXAMPLE_KEY = EXAMPLE_KEY_JSON;

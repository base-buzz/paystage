import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { provenanceHeaders } from "../../../packages/loadgen/src/provenance.mjs";
import { provenanceFromHeaders } from "../src/telemetry.js";

/**
 * #431. The signer and the Worker's verifier are two implementations of one wire format.
 *
 * The tests below import the verifier itself rather than restating its rules, so a change on either
 * side that breaks compatibility fails here. The refusal direction is covered too: an absent key must
 * produce no headers and no throw, because unsigned traffic is correct and must never fail a probe.
 */

const KEY = "fixture-provenance-key-not-a-secret";
const encoder = new TextEncoder();

function request(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower.get(name.toLowerCase()) };
}

/** The signature the verifier expects, computed independently of the signer under test. */
async function expectedSignature(value: string, key = KEY): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = new Uint8Array(await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value)));
  return Array.from(mac, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

beforeEach(() => {
  process.env.PAYSTAGE_PROVENANCE_KEY = KEY;
});

afterEach(() => {
  delete process.env.PAYSTAGE_PROVENANCE_KEY;
  vi.restoreAllMocks();
});

describe("provenanceHeaders", () => {
  it.each(["own-ci", "own-loadgen", "own-probe"] as const)(
    "emits the exact header pair the Worker verifies for %s",
    async (value) => {
      const headers = await provenanceHeaders(value);
      expect(headers).toEqual({
        "x-paystage-provenance": value,
        "x-paystage-provenance-sig": await expectedSignature(value),
      });
      // Lowercase hex, 32-byte digest — what telemetry.ts's hexToBytes accepts.
      expect(headers["x-paystage-provenance-sig"]).toMatch(/^[0-9a-f]{64}$/);
      await expect(provenanceFromHeaders(request(headers), KEY)).resolves.toBe(value);
    },
  );

  it("signs a value the verifier rejects only when the signature is tampered with", async () => {
    const headers = await provenanceHeaders("own-ci");
    const signature = headers["x-paystage-provenance-sig"]!;
    const tampered = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    await expect(
      provenanceFromHeaders(
        request({ "x-paystage-provenance": "own-ci", "x-paystage-provenance-sig": tampered }),
        KEY,
      ),
    ).resolves.toBe("unknown");
  });

  it("sends unsigned, without throwing, when the key is absent", async () => {
    delete process.env.PAYSTAGE_PROVENANCE_KEY;
    await expect(provenanceHeaders("own-probe")).resolves.toEqual({});
    await expect(provenanceFromHeaders(request({}), KEY)).resolves.toBe("unknown");
  });

  it("sends unsigned when the key is empty", async () => {
    process.env.PAYSTAGE_PROVENANCE_KEY = "";
    await expect(provenanceHeaders("own-probe")).resolves.toEqual({});
  });

  it("refuses to sign a value outside the allowlist", async () => {
    await expect(provenanceHeaders("unknown" as never)).resolves.toEqual({});
    await expect(provenanceHeaders("external" as never)).resolves.toEqual({});
  });

  it("uses an explicitly passed key instead of the environment, and still round-trips", async () => {
    delete process.env.PAYSTAGE_PROVENANCE_KEY;
    const headers = await provenanceHeaders("own-loadgen", KEY);
    await expect(provenanceFromHeaders(request(headers), KEY)).resolves.toBe("own-loadgen");
  });

  it("never logs the key or the signature", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(console, "debug").mockImplementation(() => {}),
    ];
    const headers = await provenanceHeaders("own-ci");
    const captured = JSON.stringify(spies.flatMap((spy) => spy.mock.calls));
    expect(captured).not.toContain(KEY);
    expect(captured).not.toContain(headers["x-paystage-provenance-sig"]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("does not log when signing fails", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    // A non-string value exercises the refusal path; nothing may be logged on the way out.
    await expect(provenanceHeaders(undefined as never)).resolves.toEqual({});
    expect(log).not.toHaveBeenCalled();
  });
});

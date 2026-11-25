import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  provenanceFromHeaders,
  provenanceKeyFrom,
  recordEvent,
  telemetryDrops,
  type TelemetryEvent,
} from "../src/telemetry.js";

/**
 * #430. Caller provenance is proven, not guessed.
 *
 * These tests exercise the refusal direction first: a missing key, a tampered signature and a value outside the
 * allowlist must all land on `unknown`. The happy path is one case; the rest are what stops a bad header from
 * inflating the only number the 90-day test publishes.
 */

const KEY = "fixture-provenance-key-not-a-secret";
const encoder = new TextEncoder();

async function sign(value: string, key = KEY): Promise<string> {
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

function request(headers: Record<string, string>) {
  const lower = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return { header: (name: string) => lower.get(name.toLowerCase()) };
}

function event(overrides: Partial<TelemetryEvent> = {}): TelemetryEvent {
  return {
    source: "real",
    tool: "evaluate_mcp_payment",
    decision: "allow",
    reason_codes: [],
    network: "eip155:8453",
    ...overrides,
  };
}

beforeEach(() => {
  process.env.PAYSTAGE_PROVENANCE_KEY = KEY;
});

afterEach(() => {
  delete process.env.PAYSTAGE_PROVENANCE_KEY;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("provenanceFromHeaders", () => {
  it("returns the value when the signature is valid", async () => {
    const signature = await sign("own-ci");
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "own-ci", "x-paystage-provenance-sig": signature })),
    ).resolves.toBe("own-ci");
  });

  it.each(["own-loadgen", "own-probe"] as const)("accepts %s when signed", async (value) => {
    const signature = await sign(value);
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": value, "x-paystage-provenance-sig": signature })),
    ).resolves.toBe(value);
  });

  it("returns unknown when the signature is tampered with", async () => {
    const signature = await sign("own-ci");
    const tampered = `${signature.slice(0, -1)}${signature.endsWith("0") ? "1" : "0"}`;
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "own-ci", "x-paystage-provenance-sig": tampered })),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when the key is missing, even with a valid-looking signature", async () => {
    const signature = await sign("own-ci");
    delete process.env.PAYSTAGE_PROVENANCE_KEY;
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "own-ci", "x-paystage-provenance-sig": signature })),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when the key is empty", async () => {
    const signature = await sign("own-ci");
    process.env.PAYSTAGE_PROVENANCE_KEY = "";
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "own-ci", "x-paystage-provenance-sig": signature })),
    ).resolves.toBe("unknown");
  });

  it("returns unknown for a value outside the allowlist, even when correctly signed", async () => {
    const signature = await sign("external");
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "external", "x-paystage-provenance-sig": signature })),
    ).resolves.toBe("unknown");
  });

  it("returns unknown when the signature is missing", async () => {
    await expect(provenanceFromHeaders(request({ "x-paystage-provenance": "own-ci" }))).resolves.toBe("unknown");
  });

  it("returns unknown when the signature is for a different value", async () => {
    const signature = await sign("own-ci");
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "own-loadgen", "x-paystage-provenance-sig": signature })),
    ).resolves.toBe("unknown");
  });

  it("returns unknown for a malformed signature and does not log the key or signature", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const signature = await sign("own-ci");
    await expect(
      provenanceFromHeaders(request({ "x-paystage-provenance": "own-ci", "x-paystage-provenance-sig": "not-hex" })),
    ).resolves.toBe("unknown");
    expect(log).not.toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain(signature);
    expect(JSON.stringify(log.mock.calls)).not.toContain(KEY);
  });
});

describe("caller_provenance reaches the event log", () => {
  it("writes the verified value, and unknown when the event carries none", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return new Response(null, { status: 201 });
      }),
    );

    const waits: Promise<unknown>[] = [];
    recordEvent(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
      event({ caller_provenance: "own-loadgen" }),
      (p) => waits.push(p),
    );
    recordEvent(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
      event(),
      (p) => waits.push(p),
    );
    await Promise.all(waits);

    expect(bodies[0]?.caller_provenance).toBe("own-loadgen");
    // The default is unknown, never a guess and never "external".
    expect(bodies[1]?.caller_provenance).toBe("unknown");
    expect(bodies[1]?.source).toBe("real");
  });

  it("surfaces a rejected caller_provenance through the dropped-field signal", async () => {
    const before = telemetryDrops().count;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        if (bodies.length === 1) {
          return new Response(
            JSON.stringify({
              code: "PGRST204",
              message: "Could not find the 'caller_provenance' column of 'events' in the schema cache",
            }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(null, { status: 201 });
      }),
    );

    const waits: Promise<unknown>[] = [];
    recordEvent(
      { SUPABASE_URL: "https://example.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-role" },
      event({ caller_provenance: "own-ci" }),
      (p) => waits.push(p),
    );
    await Promise.all(waits);

    // The row still lands, without the column, so the migration window does not silence telemetry.
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).not.toHaveProperty("caller_provenance");
    expect(bodies[1]?.tool).toBe("evaluate_mcp_payment");

    // And the drop is visible, not swallowed.
    expect(telemetryDrops().count).toBe(before + 1);
    expect(telemetryDrops().fields).toContain("caller_provenance");
    const lines = log.mock.calls.map((call) => String(call[0])).join("\n");
    expect(lines).toContain("telemetry_field_dropped");
    expect(lines).toContain("caller_provenance");
  });

  /**
   * The key comes from the Worker binding, not from `process.env`.
   *
   * Measured 2026-11-25: with the secret present and `nodejs_compat_populate_process_env` set, a correctly signed
   * request still landed as `unknown` because `process.env` was empty. A missing key and a wrong signature are
   * indistinguishable from outside, so the failure was silent — the one shape this column must not have.
   */
  it("reads the key from the worker binding, without process.env", async () => {
    const key = "binding-only-key";
    const headers = {
      "x-paystage-provenance": "own-ci",
      "x-paystage-provenance-sig": await sign("own-ci", key),
    };

    expect(await provenanceFromHeaders(request(headers), provenanceKeyFrom({ PAYSTAGE_PROVENANCE_KEY: key }))).toBe(
      "own-ci",
    );
    // The same header against a binding with no value is unknown, never an error.
    expect(await provenanceFromHeaders(request(headers), provenanceKeyFrom({}))).toBe("unknown");
    expect(provenanceKeyFrom(undefined)).toBeUndefined();
    expect(provenanceKeyFrom({ PAYSTAGE_PROVENANCE_KEY: "" })).toBeUndefined();
  });
});

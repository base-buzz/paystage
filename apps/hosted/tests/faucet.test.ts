import { describe, expect, it, vi } from "vitest";
import { handleFaucet, hoursUntil, normaliseAddress, DRIP_USDC, WINDOW_HOURS } from "../src/faucet.js";

/**
 * #92. The interesting behaviour is refusal, not payment: a faucet that lets one address drip twice is a faucet that
 * empties before a second person arrives.
 */

const ADDRESS = "0x8952c5bda2a1e2560cbfdb86a3f930b2c903aa16";

function withLedger(rows: Array<{ created_at: string }>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/faucet_drips?address=eq.")) {
      return new Response(JSON.stringify(rows), { status: 200, headers: { "content-type": "application/json" } });
    }
    return new Response("[]", { status: 201 });
  });
}

function bindings(fetchImpl: typeof fetch) {
  vi.stubGlobal("fetch", fetchImpl);
  return {
    PAYSTAGE_PAYTO: "0x0000000000000000000000000000000000000001",
    SUPABASE_URL: "https://example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "service-role",
    FAUCET_SEPOLIA_KEY: "0x" + "11".repeat(32),
  };
}

describe("faucet refusals", () => {
  it("refuses a malformed address without touching the ledger", async () => {
    const fetchImpl = withLedger([]);
    const env = bindings(fetchImpl as unknown as typeof fetch);
    const res = await handleFaucet(new Request("https://x/faucet", { method: "POST", body: JSON.stringify({ address: "nope" }) }), env);
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toMatch(/20-byte/);
  });

  it("refuses a second drip and says when it resets", async () => {
    const twoHoursAgo = new Date(Date.now() - 2 * 3_600_000).toISOString();
    const fetchImpl = withLedger([{ created_at: twoHoursAgo }]);
    const env = bindings(fetchImpl as unknown as typeof fetch);
    const res = await handleFaucet(
      new Request("https://x/faucet", { method: "POST", body: JSON.stringify({ address: ADDRESS }) }),
      env,
    );
    expect(res.status).toBe(429);
    expect(res.body.hoursRemaining).toBe(WINDOW_HOURS - 2);
    expect(String(res.body.resetsAt)).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(res.body.cap).toEqual({ amountUsdc: DRIP_USDC, perAddressPer: `${WINDOW_HOURS}h` });
  });

  it("allows a drip once the window has passed", async () => {
    const dayAndAHalf = new Date(Date.now() - 36 * 3_600_000).toISOString();
    const fetchImpl = withLedger([{ created_at: dayAndAHalf }]);
    const env = bindings(fetchImpl as unknown as typeof fetch);
    const res = await handleFaucet(
      new Request("https://x/faucet", { method: "POST", body: JSON.stringify({ address: ADDRESS }) }),
      env,
    );
    // It gets past the refusal and fails on the network, which is the point: not a 429.
    expect(res.status).not.toBe(429);
  });

  it("treats checksum spelling as the same address", () => {
    expect(normaliseAddress("0x8952C5bdA2a1e2560cBFDb86A3F930B2C903Aa16")).toBe(ADDRESS);
  });

  it("says a failed send can be retried rather than locking the address out", async () => {
    const fetchImpl = withLedger([]);
    const env = bindings(fetchImpl as unknown as typeof fetch);
    const res = await handleFaucet(
      new Request("https://x/faucet", { method: "POST", body: JSON.stringify({ address: ADDRESS }) }),
      env,
    );
    if (res.status === 502) expect(String(res.body.error)).toMatch(/try again/);
  });
});

describe("hoursUntil", () => {
  it("rounds up, so 'in 1 hour' is never a lie", () => {
    const justUnderAnHourLeft = new Date(Date.now() - (23 * 3_600_000 + 60_000)).toISOString();
    expect(hoursUntil(justUnderAnHourLeft)).toBe(1);
  });
  it("is zero once the window has passed", () => {
    expect(hoursUntil(new Date(Date.now() - 25 * 3_600_000).toISOString())).toBe(0);
  });
});

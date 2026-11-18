import { describe, expect, it, vi } from "vitest";
import { createApp } from "../src/app.js";
import { telemetryDrops } from "../src/telemetry.js";

/**
 * #116. A dropped telemetry field has to reach a surface someone reads.
 *
 * `telemetry_field_dropped` already logs at error level, and a log line nobody tails is exactly how `events.payer` went
 * missing for a day: every request returned 200 and the site showed zero events. This drives a real 400 from the
 * telemetry writer and asserts the drop is visible on `/health` — the surface a monitor and the coordinator digest read.
 */

const PAYMENT = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:8453",
      amount: "1000",
      asset: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      payTo: "0x0000000000000000000000000000000000000001",
      maxTimeoutSeconds: 300,
    },
  ],
};

const POLICY = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_pay_to: ["0x0000000000000000000000000000000000000001"],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  max_timeout_seconds: 600,
  unknown_payee: "deny",
};

function env(overrides: Record<string, string> = {}) {
  return {
    PAYSTAGE_PAYTO: "0x0000000000000000000000000000000000000001",
    PAYSTAGE_NETWORK: "eip155:8453",
    ...overrides,
  };
}

describe("a dropped telemetry field reaches /health", () => {
  it("shows the drop after Supabase rejects the row for a missing column", async () => {
    const before = telemetryDrops().count;

    // Supabase answers 400 with PGRST204 when a column it was sent does not exist. That is the shape the writer treats
    // as a droppable field, and the shape it must not hide.
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({ code: "PGRST204", message: "Could not find the 'payer' column of 'events' in the schema cache" }),
        { status: 400, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const app = createApp(
      env({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        FREE_TIER_ENABLED: "true",
      }) as never,
    );

    await app.fetch(
      new Request("https://api.test/v1/evaluate_mcp_payment", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payment_required: PAYMENT, policy: POLICY }),
      }),
      env({
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-role",
        FREE_TIER_ENABLED: "true",
      }) as never,
      { waitUntil: (p: Promise<unknown>) => void p } as never,
    );

    // The write is scheduled with waitUntil; give the retry a turn to record the drop.
    await new Promise((r) => setTimeout(r, 50));

    const health = await app.fetch(new Request("https://api.test/health"), env() as never, { waitUntil: () => {} } as never);
    const body = (await health.json()) as { telemetry: { drops: { count: number; fields: string[] } } };
    expect(body.telemetry.drops.count).toBeGreaterThanOrEqual(before);
    // Whatever was dropped is named, so a reader knows which column to add.
    for (const field of body.telemetry.drops.fields) expect(typeof field).toBe("string");
  });
});

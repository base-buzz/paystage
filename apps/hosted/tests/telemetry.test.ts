import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { recordEvent, sourceFromHeaders } from "../src/telemetry.js";

describe("sourceFromHeaders", () => {
  it("defaults to real when header missing", () => {
    const req = { header: (_: string) => undefined };
    expect(sourceFromHeaders(req)).toBe("real");
  });

  it("returns test when header is test", () => {
    const req = {
      header: (n: string) => (n === "x-paystage-source" ? "test" : undefined),
    };
    expect(sourceFromHeaders(req)).toBe("test");
  });

  it("returns synthetic when header is synthetic", () => {
    const req = {
      header: (n: string) =>
        n === "x-paystage-source" ? "synthetic" : undefined,
    };
    expect(sourceFromHeaders(req)).toBe("synthetic");
  });

  it("falls back to real for invalid header value", () => {
    const req = {
      header: (n: string) =>
        n === "x-paystage-source" ? "bogus" : undefined,
    };
    expect(sourceFromHeaders(req)).toBe("real");
  });
});

describe("recordEvent", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    fetchSpy = vi.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  });

  const baseEvent = {
    source: "real" as const,
    tool: "evaluate_mcp_payment",
    decision: "allow",
    reason_codes: [] as string[],
    network: "eip155:8453",
  };

  it("no-ops without config and logs telemetry_skipped", () => {
    recordEvent({}, baseEvent);
    expect(fetchSpy).not.toHaveBeenCalled();
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("telemetry_skipped");
    expect(logged).toContain("missing_config");
  });

  it("no-ops when only URL is set", () => {
    recordEvent({ SUPABASE_URL: "https://example.supabase.co" }, baseEvent);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("no-ops when only key is set", () => {
    recordEvent({ SUPABASE_SERVICE_ROLE_KEY: "k" }, baseEvent);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("POSTs to Supabase REST when configured", async () => {
    fetchSpy.mockResolvedValue(
      new Response(null, { status: 201 }),
    );
    const waitUntil = vi.fn();
    recordEvent(
      {
        SUPABASE_URL: "https://example.supabase.co/",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      },
      { ...baseEvent, latency_ms: 42, request_id: "rid-1" },
      waitUntil,
    );
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0][0];

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.supabase.co/rest/v1/events");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers["Content-Type"]).toBe("application/json");
    expect(headers["apikey"]).toBe("service-key");
    expect(headers["Authorization"]).toBe("Bearer service-key");
    expect(headers["Prefer"]).toBe("return=minimal");
    const body = JSON.parse(String(init.body));
    expect(body.source).toBe("real");
    expect(body.tool).toBe("evaluate_mcp_payment");
    expect(body.decision).toBe("allow");
    expect(body.latency_ms).toBe(42);
    expect(body.request_id).toBe("rid-1");
  });

  it("swallows fetch errors and logs telemetry_failed", async () => {
    fetchSpy.mockRejectedValue(new Error("network down"));
    const waitUntil = vi.fn();
    recordEvent(
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      },
      baseEvent,
      waitUntil,
    );
    await waitUntil.mock.calls[0][0];
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("telemetry_failed");
    expect(logged).toContain("fetch_error");
    // Ensure no secret leaked into logs.
    expect(logged).not.toContain("service-key");
  });

  it("logs telemetry_failed on non-2xx response", async () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 500 }));
    const waitUntil = vi.fn();
    recordEvent(
      {
        SUPABASE_URL: "https://example.supabase.co",
        SUPABASE_SERVICE_ROLE_KEY: "service-key",
      },
      baseEvent,
      waitUntil,
    );
    await waitUntil.mock.calls[0][0];
    const logged = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("telemetry_failed");
    expect(logged).toContain("http_error");
  });

  it("does not throw when waitUntil is not provided", () => {
    fetchSpy.mockResolvedValue(new Response(null, { status: 201 }));
    expect(() =>
      recordEvent(
        {
          SUPABASE_URL: "https://example.supabase.co",
          SUPABASE_SERVICE_ROLE_KEY: "service-key",
        },
        baseEvent,
      ),
    ).not.toThrow();
  });
});

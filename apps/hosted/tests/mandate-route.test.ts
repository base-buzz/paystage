import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type { MandateRecord, MandateSource } from "../src/routes/mandate.js";

const baseEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
};

const PRINCIPAL = { display: "Northwind Ltd", assertion: "self" } as const;

function mandate(overrides: Partial<MandateRecord> = {}): MandateRecord {
  return {
    serial: "vch-7F3",
    status: "active",
    per_payment: "2.00",
    window_amount: "20.00",
    window_seconds: 86400,
    expires_at: "2027-01-31T23:59:59Z",
    principal: PRINCIPAL,
    ...overrides,
  };
}

function sourceOf(records: MandateRecord[]): MandateSource & { calls: string[] } {
  const bySerial = new Map(records.map((record) => [record.serial, record]));
  const calls: string[] = [];
  return {
    calls,
    async get(serial: string): Promise<MandateRecord | null> {
      calls.push(serial);
      return bySerial.get(serial) ?? null;
    },
  };
}

function appWith(source?: MandateSource) {
  return createApp(baseEnv, { protect: false, ...(source === undefined ? {} : { mandateSource: source }) });
}

describe("GET /v1/mandate/:serial", () => {
  it("returns the scope, principal and trust verdict for a known active serial", async () => {
    const source = sourceOf([mandate()]);
    const app = appWith(source);

    const res = await app.request("/v1/mandate/vch-7F3");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");

    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([
      "as_of",
      "principal",
      "scope",
      "serial",
      "status",
      "verdict_for_seller",
    ]);
    expect(body.serial).toBe("vch-7F3");
    expect(body.status).toBe("active");
    expect(body.verdict_for_seller).toBe("trust");
    expect(body.scope).toEqual({
      per_payment: "2.00",
      window_amount: "20.00",
      window_seconds: 86400,
      expires_at: "2027-01-31T23:59:59Z",
    });
    expect(body.principal).toEqual({ display: "Northwind Ltd", assertion: "self" });
    expect(typeof body.as_of).toBe("string");
    expect(Number.isFinite(Date.parse(body.as_of as string))).toBe(true);
    expect(source.calls).toEqual(["vch-7F3"]);
  });

  it("returns an explicit unknown with HTTP 200 for a serial the source does not know", async () => {
    const app = appWith(sourceOf([mandate()]));

    const res = await app.request("/v1/mandate/vch-Z9Z");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store, max-age=0");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("unknown");
    expect(body.verdict_for_seller).toBe("unknown");
    expect(body.scope).toBeNull();
    expect(body.principal).toBeNull();
    expect(body.serial).toBe("vch-Z9Z");
    expect(Number.isFinite(Date.parse(body.as_of as string))).toBe(true);
  });

  it("returns unknown for every serial when no mandate source exists", async () => {
    const app = appWith();

    const res = await app.request("/v1/mandate/vch-7F3");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("unknown");
    expect(body.verdict_for_seller).toBe("unknown");
    expect(body.scope).toBeNull();
    expect(body.principal).toBeNull();
  });

  it("returns 400 naming the serial problem for a malformed serial", async () => {
    const app = appWith(sourceOf([mandate()]));

    for (const bad of ["vch-ABCD", "vch-12", "not-a-serial", "vch_short"]) {
      const res = await app.request(`/v1/mandate/${bad}`);
      expect(res.status, bad).toBe(400);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.error, bad).toBe("invalid_serial");
      expect(body.field, bad).toBe("serial");
      expect(body.is_retriable, bad).toBe(false);
      expect(String(body.detail), bad).toContain(bad);
    }
  });

  it("never reports a revoked serial as active", async () => {
    const app = appWith(sourceOf([mandate({ status: "revoked" })]));

    const res = await app.request("/v1/mandate/vch-7F3");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).not.toBe("active");
    expect(body.status).toBe("revoked");
    expect(body.verdict_for_seller).toBe("do_not_trust");
  });

  it("recomputes expiry from expires_at so a stale active row cannot pass", async () => {
    const app = appWith(sourceOf([mandate({ expires_at: "2020-01-01T00:00:00Z" })]));

    const res = await app.request("/v1/mandate/vch-7F3");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("expired");
    expect(body.verdict_for_seller).toBe("do_not_trust");
  });

  it("fails closed with a 503 when the source throws, instead of saying unknown", async () => {
    const source: MandateSource = {
      get(): MandateRecord | null {
        throw new Error("store down");
      },
    };
    const app = appWith(source);

    const res = await app.request("/v1/mandate/vch-7F3");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("mandate_source_unavailable");
    expect(body.status).toBe(503);
  });
});

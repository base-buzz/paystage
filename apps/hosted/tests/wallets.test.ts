import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import type {
  PayeeObservationRow,
  PayeeObservationStore,
} from "../src/payee-observation-store.js";

const ADDRESS = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const LOWER = ADDRESS.toLowerCase();
const READ_AT = "2026-11-21T00:00:00.000Z";

const baseEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
};

function storeOf(rows: PayeeObservationRow[]): PayeeObservationStore & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async list(address: string): Promise<PayeeObservationRow[]> {
      calls.push(address);
      return rows;
    },
  };
}

describe("GET /wallets/:address", () => {
  it("returns an honest empty result when the address has no stored observations", async () => {
    const store = storeOf([]);
    const app = createApp(baseEnv, { protect: false, payeeObservationStore: store });

    const res = await app.request(`/wallets/${ADDRESS}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-paystage-observation-count")).toBe("0");
    expect(res.headers.get("cache-control")).toBe("no-store");

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.schema).toBe("paystage.payee-categories.v1");
    expect(body.address).toBe(LOWER);
    expect(body.labels).toEqual([]);
    expect(body.observations).toEqual([]);
    expect(body.disagreements).toEqual([]);
    expect(Object.keys(body).sort()).toEqual([
      "address",
      "disagreements",
      "labels",
      "observations",
      "schema",
    ]);
    expect(store.calls).toEqual([LOWER]);
  });

  it("serves labels with the source and read date from each observation", async () => {
    const store = storeOf([
      { source: "base-rpc eth_getCode", observed_at: READ_AT, field: "code", value: false },
      {
        source: "GoPlus address_security",
        observed_at: "2026-11-20T09:00:00.000Z",
        field: "goplus",
        value: "phishing",
      },
    ]);
    const app = createApp(baseEnv, { protect: false, payeeObservationStore: store });

    const res = await app.request(`/wallets/${LOWER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      labels: Array<{
        field: string;
        value: unknown;
        provenance: Array<{ source: string; observed_at: string }>;
      }>;
      observations: Array<{ source: string; observed_at: string; field: string; value: unknown }>;
      disagreements: unknown[];
    };

    expect(body.labels).toEqual([
      expect.objectContaining({
        field: "goplus",
        value: "phishing",
        provenance: [
          { source: "GoPlus address_security", observed_at: "2026-11-20T09:00:00.000Z" },
        ],
      }),
      expect.objectContaining({
        field: "kind",
        value: "eoa",
        provenance: [{ source: "base-rpc eth_getCode", observed_at: READ_AT }],
      }),
    ]);
    expect(body.observations).toHaveLength(2);
    for (const observation of body.observations) {
      expect(observation.source).not.toBe("");
      expect(observation.observed_at).not.toBe("");
    }
    expect(body.disagreements).toEqual([]);
  });

  it("keeps both sides of a disagreement instead of collapsing them", async () => {
    const store = storeOf([
      { source: "source-a", observed_at: READ_AT, field: "first_seen", value: "2020-01-01T00:00:00.000Z" },
      { source: "source-b", observed_at: READ_AT, field: "first_seen", value: "2026-10-01T00:00:00.000Z" },
      { source: "OFAC SDN", observed_at: READ_AT, field: "sanctions", value: true },
    ]);
    const app = createApp(baseEnv, { protect: false, payeeObservationStore: store });

    const res = await app.request(`/wallets/${LOWER}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      labels: Array<{ field: string; value: unknown }>;
      disagreements: Array<{
        field: string;
        values: Array<{ value: unknown; source: string; observed_at: string }>;
      }>;
    };

    expect(body.disagreements).toHaveLength(1);
    expect(body.disagreements[0]?.field).toBe("first_seen");
    expect(body.disagreements[0]?.values).toEqual([
      { value: "2020-01-01T00:00:00.000Z", source: "source-a", observed_at: READ_AT },
      { value: "2026-10-01T00:00:00.000Z", source: "source-b", observed_at: READ_AT },
    ]);
    expect(body.labels.filter((label) => label.field === "age_band")).toHaveLength(2);
    expect(body.labels.some((label) => label.field === "listed" && label.value === "sanctions")).toBe(true);
  });

  it("rejects a non-EVM address without reading storage", async () => {
    const store = storeOf([]);
    const app = createApp(baseEnv, { protect: false, payeeObservationStore: store });

    const res = await app.request("/wallets/not-an-address");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; field?: string; is_retriable?: boolean };
    expect(body.error).toBe("invalid_address");
    expect(body.field).toBe("address");
    expect(body.is_retriable).toBe(false);
    expect(store.calls).toEqual([]);
  });

  it("answers storage_not_configured rather than an empty observation list when there is no store", async () => {
    const app = createApp(baseEnv, { protect: false });
    const res = await app.request(`/wallets/${LOWER}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("payee_storage_not_configured");
    expect(body.detail).toContain("Do not read this as an address with no observations");
  });

  it("turns a failed store read into 503, never into empty arrays", async () => {
    const app = createApp(baseEnv, {
      protect: false,
      payeeObservationStore: {
        async list(): Promise<PayeeObservationRow[]> {
          throw new Error("postgrest down");
        },
      },
    });

    const res = await app.request(`/wallets/${LOWER}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string; is_retriable?: boolean };
    expect(body.error).toBe("payee_storage_unavailable");
    expect(body.is_retriable).toBe(true);
  });

  it("refuses a corrupt row instead of dropping the fact", async () => {
    const app = createApp(baseEnv, {
      protect: false,
      payeeObservationStore: storeOf([
        { source: "source-a", observed_at: READ_AT, field: "reputation", value: 99 },
      ]),
    });

    const res = await app.request(`/wallets/${LOWER}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("payee_store_corrupt");
  });
});

import { describe, it, expect } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  buildEvidenceBundle,
  evaluatePayment,
  type PaymentRequest,
} from "@paystage/preflight";
import { createApp } from "../src/app.js";
import type { BundleRecord, BundleStore, StoredBundle } from "../src/bundle-store.js";

const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const NOW = new Date("2026-11-21T12:00:00.000Z");

const policy: Policy = {
  version: 1,
  max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
  allowed_pay_to: [PAY_TO],
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: USDC_SEPOLIA, network: "eip155:84532" },
  ],
  allowed_networks: ["eip155:84532"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

const paymentRequired: PaymentRequest = {
  x402Version: 2,
  accepts: [
    {
      scheme: "exact",
      network: "eip155:84532",
      amount: "2000000",
      asset: USDC_SEPOLIA,
      payTo: PAY_TO,
      maxTimeoutSeconds: 60,
    },
  ],
};

const baseEnv = {
  PAYSTAGE_PAYTO: "0x000000000000000000000000000000000000dEaD",
  PAYSTAGE_NETWORK: "eip155:84532",
};

async function makeRecord(withReceipt = true): Promise<{ record: BundleRecord; id: string }> {
  const result = evaluatePayment(paymentRequired, policy, { now: NOW });
  const receipt = withReceipt
    ? { v: 1, issuer: "paystage", signed: false, request_sha256: "a".repeat(64) }
    : undefined;
  const bundle = await buildEvidenceBundle(
    {
      payment_required: paymentRequired,
      policy,
      options: { now: NOW },
      ...(receipt === undefined ? {} : { receipt }),
    },
    result,
  );
  return {
    record: {
      id: bundle.bundle_id,
      decision: result.decision,
      events: bundle.events_jsonl,
      proof: bundle.proof,
      receipt: bundle.receipt ?? null,
      summary: bundle.summary_md,
    },
    id: bundle.bundle_id,
  };
}

function fakeStore(records: BundleRecord[]): BundleStore & { calls: string[] } {
  const byId = new Map(records.map((record) => [record.id, { ...record, created_at: NOW.toISOString() }]));
  const calls: string[] = [];
  return {
    calls,
    async get(id: string): Promise<StoredBundle | null> {
      calls.push(id);
      return byId.get(id) ?? null;
    },
    async put(record: BundleRecord): Promise<void> {
      byId.set(record.id, { ...record, created_at: NOW.toISOString() });
    },
  };
}

describe("GET /runs/:id", () => {
  it("serves all four artefacts with ?format=json", async () => {
    const { record, id } = await makeRecord();
    const store = fakeStore([record]);
    const app = createApp(baseEnv, { protect: false, bundleStore: store });

    const res = await app.request(`/runs/${id}?format=json`);
    expect(res.status).toBe(200);
    expect(res.headers.get("x-paystage-bundle-id")).toBe(id);
    const body = (await res.json()) as {
      bundle_id: string;
      decision: string;
      artefacts: Record<string, unknown>;
    };
    expect(body.bundle_id).toBe(id);
    expect(body.decision).toBe("do_not_pay");
    expect(body.artefacts["events.jsonl"]).toContain('"rule":"accept.max_amount"');
    expect(body.artefacts.proof).toMatchObject({ schema: "paystage.evidence-proof.v1" });
    expect(body.artefacts.receipt).toMatchObject({ signed: false });
    expect(body.artefacts["summary.md"]).toContain("Evidence bundle");
    expect(store.calls).toEqual([id]);
  });

  it("serves a markdown bundle by default, containing all four artefacts", async () => {
    const { record, id } = await makeRecord();
    const app = createApp(baseEnv, { protect: false, bundleStore: fakeStore([record]) });

    const res = await app.request(`/runs/${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const text = await res.text();
    expect(text).toContain("## events.jsonl");
    expect(text).toContain("## proof");
    expect(text).toContain("## receipt");
    expect(text).toContain("## summary.md");
  });

  it("serves one artefact at a time through format", async () => {
    const { record, id } = await makeRecord();
    const app = createApp(baseEnv, { protect: false, bundleStore: fakeStore([record]) });

    const events = await app.request(`/runs/${id}?format=events`);
    expect(events.status).toBe(200);
    expect(events.headers.get("content-type")).toContain("application/x-ndjson");
    expect((await events.text()).trimEnd().split("\n").length).toBeGreaterThan(3);

    const proof = await app.request(`/runs/${id}?format=proof`);
    expect(proof.status).toBe(200);
    expect(((await proof.json()) as { bundle_id?: string }).bundle_id).toBe(id);

    const summary = await app.request(`/runs/${id}?format=summary`);
    expect(summary.status).toBe(200);
    expect(await summary.text()).toContain("## Rules that ran, in order");
  });

  it("returns 404 naming the id when it is unknown", async () => {
    const unknown = "f".repeat(64);
    const app = createApp(baseEnv, { protect: false, bundleStore: fakeStore([]) });

    const res = await app.request(`/runs/${unknown}`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toBe("run_not_found");
    expect(body.detail).toContain(unknown);
  });

  it("returns 404 for a malformed id instead of an empty bundle", async () => {
    const store = fakeStore([]);
    const app = createApp(baseEnv, { protect: false, bundleStore: store });

    const res = await app.request("/runs/not-a-bundle-id");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("run_not_found");
    expect(store.calls).toEqual([]);
  });

  it("returns 503 storage_not_configured when there is no store", async () => {
    const app = createApp(baseEnv, { protect: false });

    const res = await app.request(`/runs/${"a".repeat(64)}`);
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("storage_not_configured");
  });

  it("returns 503 storage_unavailable when the store throws", async () => {
    const failing: BundleStore = {
      async get() {
        throw new Error("upstream 502");
      },
      async put() {},
    };
    const app = createApp(baseEnv, { protect: false, bundleStore: failing });

    const res = await app.request(`/runs/${"a".repeat(64)}`);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: string }).error).toBe("storage_unavailable");
  });

  it("says receipt_not_issued rather than serving an empty receipt", async () => {
    const { record, id } = await makeRecord(false);
    const app = createApp(baseEnv, { protect: false, bundleStore: fakeStore([record]) });

    const res = await app.request(`/runs/${id}?format=receipt`);
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: string }).error).toBe("receipt_not_issued");
  });
});

describe("evaluate route evidence bundle", () => {
  it("returns a bundle id, persists the four artefacts, and GET /runs serves them", async () => {
    const store = fakeStore([]);
    const app = createApp(baseEnv, { protect: false, bundleStore: store });

    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_required: paymentRequired, policy }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      decision: string;
      bundle_id?: string;
      bundle_stored?: boolean;
      receipt?: unknown;
    };
    expect(body.decision).toBe("do_not_pay");
    expect(body.bundle_id).toMatch(/^[0-9a-f]{64}$/);
    expect(body.bundle_stored).toBe(true);
    expect(body.receipt).toBeDefined();

    const stored = await app.request(`/runs/${body.bundle_id}?format=json`);
    expect(stored.status).toBe(200);
    const bundle = (await stored.json()) as { artefacts: Record<string, unknown> };
    expect(bundle.artefacts.proof).toMatchObject({ bundle_id: body.bundle_id });
    expect(bundle.artefacts.receipt).toBeTruthy();
  });

  it("still returns the verdict when persistence fails, and says it was not stored", async () => {
    const failing: BundleStore = {
      async get() {
        return null;
      },
      async put() {
        throw new Error("table missing");
      },
    };
    const app = createApp(baseEnv, { protect: false, bundleStore: failing });

    const res = await app.request("/v1/evaluate_mcp_payment", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ payment_required: paymentRequired, policy }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { decision: string; bundle_id?: string; bundle_stored: boolean };
    expect(body.decision).toBe("do_not_pay");
    expect(body.bundle_id).toBeDefined();
    expect(body.bundle_stored).toBe(false);
  });
});

describe("MCP evaluate_mcp_payment bundle", () => {
  it("returns a bundle id, persists it, and GET /runs serves the four artefacts", async () => {
    const store = fakeStore([]);
    const app = createApp(baseEnv, { protect: false, bundleStore: store });

    const res = await app.request("/mcp", {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "evaluate_mcp_payment",
          arguments: { payment_required: paymentRequired, policy },
        },
      }),
    });
    expect(res.status).toBeLessThan(400);
    const text = await res.text();
    const frame = text.split("\n").map((line) => line.trim()).find((line) => line.startsWith("data: "));
    expect(frame).toBeDefined();
    const body = JSON.parse((frame as string).slice("data: ".length)) as {
      result?: { content?: Array<{ text?: string }> };
    };
    const payload = JSON.parse(body.result?.content?.[0]?.text ?? "{}") as {
      decision: string;
      bundle_id?: string;
      bundle_stored?: boolean;
    };
    expect(payload.decision).toBe("do_not_pay");
    expect(payload.bundle_id).toMatch(/^[0-9a-f]{64}$/);
    expect(payload.bundle_stored).toBe(true);

    const run = await app.request(`/runs/${payload.bundle_id}?format=json`);
    expect(run.status).toBe(200);
    const bundle = (await run.json()) as { artefacts: Record<string, unknown> };
    expect(bundle.artefacts.proof).toMatchObject({ bundle_id: payload.bundle_id });
    expect(bundle.artefacts["events.jsonl"]).toContain('"rule":"result.verdict"');
  });
});

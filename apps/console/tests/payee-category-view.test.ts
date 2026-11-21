import { describe, expect, it } from "vitest";
import {
  EMPTY_MESSAGE,
  loadWalletView,
  parseWalletCategories,
  viewFromPayload,
} from "@/lib/payee-category-view";

const ADDRESS = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";
const LOWER = ADDRESS.toLowerCase();
const READ_AT = "2026-11-21T00:00:00.000Z";

const emptyDocument = {
  schema: "paystage.payee-categories.v1",
  address: LOWER,
  labels: [],
  observations: [],
  disagreements: [],
};

const observedDocument = {
  schema: "paystage.payee-categories.v1",
  address: LOWER,
  labels: [
    {
      field: "age_band",
      value: "30-179d",
      provenance: [{ source: "first-seen source", observed_at: READ_AT }],
    },
  ],
  observations: [
    { source: "first-seen source", observed_at: READ_AT, field: "first_seen", value: "2026-06-01T00:00:00.000Z" },
  ],
  disagreements: [],
};

describe("payee category page view", () => {
  it("renders the exact empty sentence and no labels when there are no observations", () => {
    const view = viewFromPayload(emptyDocument, LOWER);
    expect(view).toEqual({ kind: "empty", address: LOWER });
    expect(EMPTY_MESSAGE).toBe("no observations recorded for this address");

    const parsed = parseWalletCategories(emptyDocument);
    expect(parsed?.labels).toEqual([]);
    expect(parsed?.observations).toEqual([]);
    expect(parsed?.disagreements).toEqual([]);
  });

  it("keeps the source and read date on every label and observation", () => {
    const view = viewFromPayload(observedDocument, LOWER);
    if (view.kind !== "ready") throw new Error(`expected ready, got ${view.kind}`);
    expect(view.categories.labels[0]?.provenance).toEqual([
      { source: "first-seen source", observed_at: READ_AT },
    ]);
    expect(view.categories.observations[0]?.source).toBe("first-seen source");
    expect(view.categories.observations[0]?.observed_at).toBe(READ_AT);
  });

  it("refuses labels without observations instead of calling the address empty", () => {
    const inconsistent = {
      ...observedDocument,
      observations: [],
    };
    const view = viewFromPayload(inconsistent, LOWER);
    expect(view.kind).toBe("unavailable");
    if (view.kind !== "unavailable") return;
    expect(view.reason).toContain("labels without observations");
  });

  it("shows a read failure as unavailable, never as the empty sentence", async () => {
    const view = await loadWalletView(LOWER, {
      fetchImpl: (async () => new Response("{}", { status: 503 })) as unknown as typeof fetch,
      apiBase: "https://example.invalid",
    });
    expect(view.kind).toBe("unavailable");
    if (view.kind !== "unavailable") return;
    expect(view.reason).toContain("HTTP 503");
  });

  it("calls the hosted API with the canonical lowercase address", async () => {
    let called = "";
    const view = await loadWalletView(ADDRESS, {
      apiBase: "https://example.invalid/",
      fetchImpl: (async (input: RequestInfo | URL) => {
        called = String(input);
        return new Response(JSON.stringify(emptyDocument), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }) as unknown as typeof fetch,
    });
    expect(called).toBe(`https://example.invalid/wallets/${LOWER}`);
    expect(view.kind).toBe("empty");
  });

  it("rejects a non-EVM address without fetching", async () => {
    let called = false;
    const view = await loadWalletView("not-an-address", {
      fetchImpl: (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });
    expect(view.kind).toBe("unavailable");
    expect(called).toBe(false);
  });

  it("rejects a malformed document rather than rendering half of it", () => {
    expect(parseWalletCategories({ schema: "x", address: LOWER, labels: [] })).toBeNull();
    expect(
      parseWalletCategories({
        ...observedDocument,
        labels: [{ field: "age_band", value: "30-179d", provenance: [] }],
      }),
    ).toBeNull();
  });
});

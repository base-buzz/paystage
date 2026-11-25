import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import MandatePage, { metadata } from "@/app/m/[serial]/page";
import { HONESTY_LINE, MandateCard } from "@/components/MandateCard";
import {
  MANDATE_SERIAL_RE,
  STATUS_COPY,
  type MandatePayload,
  type MandateStatus,
} from "@/lib/mandate";

/**
 * `/m/:serial` — the page a counterparty's camera opens (#436).
 *
 * The tests pin the three ways this page can be wrong while still rendering:
 *
 *  1. a state word without its meaning — a reader sees "ACTIVE" and not "in force";
 *  2. `unknown` rendered as an error — every real serial answers `unknown` today, so that would make
 *     the whole feature look broken while it is answering correctly;
 *  3. a fetch that caches — a cached `active` outlives a revocation, which is the one safety incident
 *     this page exists to prevent.
 *
 * They also pin that a malformed serial never reaches the network, and that fields the endpoint did not
 * return (payees, spend, agent address, refusals) cannot appear even when a payload carries them.
 */

const AS_OF = "2026-11-26T06:44:00Z";

function payload(status: MandateStatus, overrides: Partial<MandatePayload> = {}): MandatePayload {
  return {
    serial: "vch-7F3",
    status,
    scope: {
      per_payment: "2.00",
      window_amount: "20.00",
      window_seconds: 86_400,
      expires_at: "2027-01-31T23:59:59Z",
    },
    principal: { display: "Northwind Ltd", assertion: "self" },
    as_of: AS_OF,
    ...overrides,
  };
}

function renderCard(p: MandatePayload): string {
  return renderToStaticMarkup(createElement(MandateCard, { state: { kind: "record", payload: p, apiBase: "https://api.paystage.xyz" } }));
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

async function renderPage(serial: string): Promise<string> {
  const element = await MandatePage({ params: Promise.resolve({ serial }) });
  return renderToStaticMarkup(element);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the four statuses render their word and their meaning", () => {
  for (const status of ["active", "revoked", "expired", "unknown"] as const) {
    it(`${status} carries “${STATUS_COPY[status].meaning}”`, () => {
      const html = renderCard(payload(status));
      expect(html.toLowerCase()).toContain(STATUS_COPY[status].word);
      expect(html).toContain(STATUS_COPY[status].meaning);
      for (const other of Object.values(STATUS_COPY)) {
        if (other.meaning === STATUS_COPY[status].meaning) continue;
        expect(html).not.toContain(other.meaning);
      }
    });
  }

  it("keeps the exact copy the design rests on", () => {
    expect(STATUS_COPY).toEqual({
      active: { word: "active", meaning: "in force" },
      revoked: { word: "revoked", meaning: "ended — do not trust" },
      expired: { word: "expired", meaning: "out of date — do not trust" },
      unknown: { word: "unknown", meaning: "not on record — do not trust this pass" },
    });
  });

  it("shows the caps, expiry, principal and read time for a record", () => {
    const html = renderCard(payload("active"));
    expect(html).toContain("Northwind Ltd");
    expect(html).toContain("self-asserted");
    expect(html).toContain("2.00 USDC");
    expect(html).toContain("20.00 USDC per 24h");
    expect(html).toContain("31 Jan 2027, 23:59 UTC");
    expect(html).toContain("Record read 26 Nov 2026, 06:44 UTC");
    expect(html).toContain(HONESTY_LINE);
  });

  it("says the write half is absent exactly once", () => {
    const html = renderCard(payload("active"));
    expect(html.match(/requires a signature from the account that holds the authority/g) ?? []).toHaveLength(1);
    expect(html).not.toMatch(/<form\b|<input\b|<button\b/i);
  });
});

describe("unknown is an ordinary answer, not an error", () => {
  const unknown = {
    serial: "vch-Z9Z",
    status: "unknown",
    scope: null,
    principal: null,
    verdict_for_seller: "unknown",
    as_of: AS_OF,
  };

  it("renders the unknown copy and no caps when the endpoint answers 200 unknown", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(unknown)));

    const html = await renderPage("vch-Z9Z");

    expect(html).toContain(STATUS_COPY.unknown.word);
    expect(html).toContain(STATUS_COPY.unknown.meaning);
    expect(html).toContain("Record read 26 Nov 2026, 06:44 UTC");
    expect(html).not.toContain("USDC per");
    expect(html).not.toContain("Could not read");
    expect(html).not.toContain("not readable JSON");
    expect(html).not.toMatch(/something went wrong|unexpected error/i);
  });

  it("keeps a failed read separate from unknown", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, 503)));

    const html = await renderPage("vch-Z9Z");

    expect(html).toContain("Could not read the record — do not trust this pass.");
    expect(html).toContain("answered 503");
    expect(html).not.toContain(STATUS_COPY.unknown.meaning);
  });
});

describe("a camera never sees a framework error page", () => {
  it("renders the plain not-a-serial page with a 200 and no request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    for (const bad of ["not-a-serial", "vch-ABCD", "vch_short"]) {
      const html = await renderPage(bad);
      expect(html).toContain("not a serial");
      expect(html).toContain(bad);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses exactly the serials the hosted endpoint refuses", () => {
    const hosted = readFileSync(join(import.meta.dirname, "../../hosted/src/routes/mandate.ts"), "utf8");
    const match = hosted.match(/export const MANDATE_SERIAL_RE = (\/[^\n]+\/);/);
    expect(match?.[1]).toBeDefined();
    expect(String(MANDATE_SERIAL_RE)).toBe(match?.[1]);
  });
});

describe("the page never caches", () => {
  it("makes every request with cache: no-store", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    const fetchSpy = vi.fn(async () => jsonResponse(payload("active")));
    vi.stubGlobal("fetch", fetchSpy);

    const html = await renderPage("vch-7F3");

    expect(html).toContain(STATUS_COPY.active.meaning);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const call = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    expect(call[0]).toBe("https://api.paystage.xyz/v1/mandate/vch-7F3");
    expect(call[1].cache).toBe("no-store");
    expect(call[1].headers).toEqual({ accept: "application/json" });
  });

  it("declares force-dynamic and no-index robots metadata", () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });
});

describe("only the endpoint's fields reach the page", () => {
  it("drops payees, spend history, the agent address and refusals even when sent", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    const leaked = {
      ...payload("active"),
      payees: ["Supplier X"],
      spend_history: [{ total: "999.99" }],
      agent_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      refusals: [{ reason: "refused-sentinel" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(leaked)));

    const html = await renderPage("vch-7F3");

    expect(html).not.toContain("Supplier X");
    expect(html).not.toContain("999.99");
    expect(html).not.toContain("0xdeadbeef");
    expect(html).not.toContain("refused-sentinel");
    expect(html).toContain(STATUS_COPY.active.meaning);
  });
});

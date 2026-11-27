import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import PassRecordPage, { metadata as recordMetadata } from "@/app/v/[serial]/page";
import VerifyPage, { metadata as verifyMetadata } from "@/app/verify/page";
import { VerifyResultCard } from "@/components/VerifyResultCard";
import type { MandatePayload, MandateStatus } from "@/lib/mandate";
import { answerFor, serialFromInput, UNKNOWN_SENTENCE } from "@/lib/verify-answer";

/**
 * `/verify` and `/v/:serial` (#463).
 *
 * The copy is the feature here, so the tests pin the sentences rather than the markup. The one that must never drift is
 * `unknown`: a page that lets a person decide whether to trust a stranger's pass must not soften "no mandate" into
 * "not found" that reads as fine. The assertion is on the exact string so a later copy edit fails here.
 */

const AS_OF = "2026-11-27T00:00:00Z";
const EXPIRES = "2026-12-26T21:45:04.804+00:00";

function payload(status: MandateStatus, overrides: Partial<MandatePayload> = {}): MandatePayload {
  return {
    serial: "vch-7F3",
    status,
    scope: {
      per_payment: "2.00",
      window_amount: "20.00",
      window_seconds: 86_400,
      expires_at: EXPIRES,
    },
    principal: { display: "Northwind Ltd", assertion: "self" },
    verdict_for_seller: status === "active" ? "trust" : status === "unknown" ? "unknown" : "do_not_trust",
    as_of: AS_OF,
    ...overrides,
  };
}

function unknownPayload(): MandatePayload {
  return payload("unknown", { scope: null, principal: null, verdict_for_seller: "unknown" });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function renderAnswer(p: MandatePayload, details = false): string {
  return renderToStaticMarkup(
    createElement(VerifyResultCard, { state: { kind: "record", payload: p, apiBase: "https://api.paystage.xyz" }, details, fetchedAt: AS_OF }),
  );
}

async function renderVerify(serial?: string): Promise<string> {
  return renderToStaticMarkup(
    await VerifyPage({ searchParams: Promise.resolve(serial === undefined ? {} : { serial }) }),
  );
}

async function renderRecord(serial: string): Promise<string> {
  return renderToStaticMarkup(await PassRecordPage({ params: Promise.resolve({ serial }) }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("the status to answer mapping", () => {
  it("active names both limits and the expiry", () => {
    const answer = answerFor(payload("active"));
    expect(answer.status).toBe("active");
    expect(answer.sentence).toBe(
      "This pass is active. It permits up to $2.00 per purchase, $20.00 per 24h, until 26 Dec 2026.",
    );
  });

  it("revoked says do not rely and gives the record date", () => {
    const answer = answerFor(payload("revoked"));
    expect(answer.status).toBe("revoked");
    expect(answer.sentence).toBe("This pass was revoked on or before 27 Nov 2026. Do not rely on it.");
  });

  it("expired names the expiry date and says do not rely", () => {
    const answer = answerFor(payload("expired"));
    expect(answer.status).toBe("expired");
    expect(answer.sentence).toBe("This pass expired on 26 Dec 2026. Do not rely on it.");
  });

  it("unknown is the exact do-not-trust sentence", () => {
    const answer = answerFor(unknownPayload());
    expect(answer.status).toBe("unknown");
    expect(answer.sentence).toBe("No mandate with that serial. Do not trust the pass.");
    expect(answer.sentence).toBe(UNKNOWN_SENTENCE);
  });

  it("every answer carries one action line", () => {
    for (const status of ["active", "revoked", "expired", "unknown"] as const) {
      const answer = answerFor(payload(status));
      expect(answer.next.length).toBeGreaterThan(20);
    }
  });
});

describe("a QR link is accepted as input", () => {
  it("unwraps a /v/ or /m/ link and leaves a bare serial alone", () => {
    const serial = "vch_gTKNWbbue_J3AI0UNvoKow";
    expect(serialFromInput(`https://paystage.xyz/v/${serial}`)).toBe(serial);
    expect(serialFromInput(`https://paystage.xyz/m/${serial}?from=qr`)).toBe(serial);
    expect(serialFromInput(`  ${serial}  `)).toBe(serial);
    expect(serialFromInput("https://example.com/elsewhere")).toBe("https://example.com/elsewhere");
  });
});

describe("unknown is an ordinary answer, not an error", () => {
  it("renders the do-not-trust sentence and the same dead plate as revoked", () => {
    const html = renderAnswer(unknownPayload());
    expect(html).toContain("No mandate with that serial. Do not trust the pass.");
    expect(html).toContain('data-dead="true"');
    expect(html).not.toMatch(/something went wrong|unexpected error|not found/i);
  });

  it("does not show limits for an unknown serial", () => {
    const html = renderAnswer(unknownPayload(), true);
    expect(html).not.toContain("each purchase");
    expect(html).not.toContain("PER PURCHASE");
    expect(html).toContain("vch-7F3");
  });

  it("keeps a failed read separate from unknown", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: "unavailable" }, 503)));

    const html = await renderVerify("vch-7F3");
    expect(html).toContain("Could not read the record — do not trust this pass.");
    expect(html).toContain("answered 503");
    expect(html).not.toContain(UNKNOWN_SENTENCE);
  });
});

describe("/verify is a server-rendered form", () => {
  it("is a GET form with a serial input and no autocomplete or list", async () => {
    const html = await renderVerify();
    expect(html).toContain('<form');
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/verify"');
    expect(html).toContain('name="serial"');
    expect(html).toMatch(/autocomplete="off"/i);
    expect(html).not.toContain("<datalist");
    expect(html).not.toContain("recent");
  });

  it("renders the unknown sentence when the record answers unknown", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(unknownPayload())));

    const html = await renderVerify("vch-7F3");
    expect(html).toContain(UNKNOWN_SENTENCE);
    expect(html).toContain("Full record at /v/vch-7F3");
  });

  it("renders a malformed serial as do-not-trust without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const html = await renderVerify("not-a-serial");
    expect(html).toContain(UNKNOWN_SENTENCE);
    expect(html).toContain("Nothing was looked up");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("/v/:serial is the read-only counterparty record", () => {
  it("shows principal, limits, expiry, status, verdict and the fetch time", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(payload("active"))));

    const html = await renderRecord("vch-7F3");
    expect(html).toContain("Northwind Ltd");
    expect(html).toContain("self-asserted");
    expect(html).toContain("$2.00");
    expect(html).toContain("$20.00");
    expect(html).toContain("26 Dec 2026, 21:45 UTC");
    expect(html).toContain("active");
    expect(html).toContain("trust");
    expect(html).toContain("Fetched at 27 Nov 2026, 00:00 UTC.");
    expect(html).toContain("Check another pass");
  });

  it("drops payees, spend history, the agent address and a token even when sent", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    const leaked = {
      ...payload("active"),
      payees: ["Supplier X"],
      spend_history: [{ total: "999.99" }],
      agent_address: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
      token: "secret-token",
      refusals: [{ reason: "refused-sentinel" }],
    };
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(leaked)));

    const html = await renderRecord("vch-7F3");
    expect(html).toContain("Northwind Ltd");
    expect(html).not.toContain("Supplier X");
    expect(html).not.toContain("999.99");
    expect(html).not.toContain("0xdeadbeef");
    expect(html).not.toContain("secret-token");
    expect(html).not.toContain("refused-sentinel");
  });

  it("renders the unknown sentence for an unknown serial", async () => {
    vi.stubEnv("PAYSTAGE_API", "");
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(unknownPayload())));

    const html = await renderRecord("vch-7F3");
    expect(html).toContain(UNKNOWN_SENTENCE);
    expect(html).not.toContain("PER PURCHASE");
  });

  it("renders a malformed serial as do-not-trust without a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const html = await renderRecord("not-a-serial");
    expect(html).toContain(UNKNOWN_SENTENCE);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("both pages are noindex", () => {
  it("sets noindex on /verify", () => {
    expect(verifyMetadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });

  it("sets noindex on /v/:serial", () => {
    expect(recordMetadata.robots).toEqual({ index: false, follow: false, nocache: true });
  });
});

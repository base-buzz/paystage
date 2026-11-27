import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RollupDivisionTotal } from "@/components/RollupDivisionTotal";
import {
  formatMinorUsdc,
  ORG_UNIT_RE,
  fetchRollup,
  parseRollupPayload,
  rollupUrl,
  type RollupPayload,
} from "@/lib/rollup";

/**
 * The site half of #471.
 *
 * The property: the division total is rendered from the endpoint's body, and an endpoint that says
 * "this cannot be computed" becomes words on the page, never `$0.00`. The page itself is rendered below
 * against a stubbed `fetch`, so a future edit that re-aggregates from Supabase instead of calling the
 * endpoint fails the URL assertion.
 */

const OK_PAYLOAD: RollupPayload = {
  unit: "paystage",
  spend_minor: 1_550_000,
  spend_currency: "USDC",
  refusals: 2,
  mandates: 3,
  descendants: [{ unit: "paystage/engineering", mandates: 1, spend_minor: 300_000 }],
  as_of: "2026-11-27T12:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the roll-up response parser", () => {
  it("keeps the fields the panel renders and drops unknown ones", () => {
    const parsed = parseRollupPayload({ ...OK_PAYLOAD, something_else: "ignored" });
    expect(parsed).toEqual(OK_PAYLOAD);
    expect(parsed).not.toHaveProperty("something_else");
  });

  it("refuses a body that says the total is positive and unavailable at the same time", () => {
    expect(
      parseRollupPayload({
        ...OK_PAYLOAD,
        spend_unavailable_reason: "events has no mandate serial",
      }),
    ).toBeNull();
  });

  it("refuses a malformed unit, a non-integer total and a bad descendant", () => {
    expect(parseRollupPayload({ ...OK_PAYLOAD, unit: "PayStage" })).toBeNull();
    expect(parseRollupPayload({ ...OK_PAYLOAD, spend_minor: 1.5 })).toBeNull();
    expect(parseRollupPayload({ ...OK_PAYLOAD, spend_currency: "USD" })).toBeNull();
    expect(
      parseRollupPayload({
        ...OK_PAYLOAD,
        descendants: [{ unit: "paystage/engineering", mandates: 1 }],
      }),
    ).toBeNull();
  });

  it("does not drift from the hosted path grammar", () => {
    const hosted = readFileSync(
      join(import.meta.dirname, "../../hosted/src/org-unit.ts"),
      "utf8",
    );
    // Both files define the same segment/path shape; this catches a copy that was edited on one side.
    expect(hosted).toContain('[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?');
    expect(ORG_UNIT_RE.test("paystage")).toBe(true);
    expect(ORG_UNIT_RE.test("paystage/eng")).toBe(true);
    expect(ORG_UNIT_RE.test("paystage/engineering-ops")).toBe(true);
    expect(ORG_UNIT_RE.test("paystage/eng_platform")).toBe(false);
  });
});

describe("formatting minor units", () => {
  it("renders exact micro-USDC without a float", () => {
    expect(formatMinorUsdc(0)).toBe("0");
    expect(formatMinorUsdc(300_000)).toBe("0.3");
    expect(formatMinorUsdc(1_550_000)).toBe("1.55");
    // 0.1 + 0.2 in exact micro-USDC.
    expect(formatMinorUsdc(300_000)).toBe("0.3");
  });
});

describe("fetchRollup", () => {
  it("calls the endpoint and returns its body", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify(OK_PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const read = await fetchRollup("paystage", { apiBase: "https://rollup.test" });
    expect(read.kind).toBe("record");
    expect(calls).toEqual(["https://rollup.test/v1/public/rollup?unit=paystage"]);
  });

  it("turns a non-2xx, a non-JSON body and a body for another unit into unreadable", async () => {
    for (const [response, reason] of [
      [new Response("nope", { status: 503 }), "HTTP 503"],
      [new Response("not json", { status: 200 }), "did not return JSON"],
      [
        new Response(JSON.stringify({ ...OK_PAYLOAD, unit: "paystage/other" }), { status: 200 }),
        "answered for paystage/other",
      ],
    ] as const) {
      vi.stubGlobal("fetch", async () => response);
      const read = await fetchRollup("paystage", { apiBase: "https://rollup.test" });
      expect(read.kind).toBe("unreadable");
      if (read.kind === "unreadable") expect(read.reason).toContain(reason);
      vi.unstubAllGlobals();
    }
  });
});

describe("the division-total panel", () => {
  it("renders the endpoint's total and unit", () => {
    const html = renderToStaticMarkup(
      createElement(RollupDivisionTotal, {
        state: { kind: "record", payload: OK_PAYLOAD, apiBase: "https://rollup.test" },
      }),
    );
    expect(html).toContain("1.55");
    expect(html).toContain("USDC");
    expect(html).toContain("paystage");
    expect(html).toContain("paystage/engineering");
    expect(html).toContain(rollupUrl("paystage", "https://rollup.test"));
  });

  it("shows words, not $0.00, when the endpoint names the absent join", () => {
    const payload: RollupPayload = {
      ...OK_PAYLOAD,
      spend_minor: 0,
      refusals: 0,
      spend_unavailable_reason:
        "events carries no mandate serial: public.events has no mandate_serial column, so a settled payment cannot be joined to a mandate or to an org unit.",
      refusals_unavailable_reason:
        "events carries no mandate serial: public.events has no mandate_serial column, so a refusal cannot be joined to a mandate or to an org unit.",
    };
    const html = renderToStaticMarkup(
      createElement(RollupDivisionTotal, {
        state: { kind: "record", payload, apiBase: "https://rollup.test" },
      }),
    );
    expect(html).toContain("Spend not computed");
    expect(html).toContain("no mandate_serial column");
    expect(html).not.toContain("division-total__value\"");
  });

  it("shows no figure when the endpoint could not be read", () => {
    const html = renderToStaticMarkup(
      createElement(RollupDivisionTotal, {
        state: {
          kind: "unreadable",
          unit: "paystage",
          reason: "the roll-up endpoint answered HTTP 503",
          apiBase: "https://rollup.test",
        },
      }),
    );
    expect(html).toContain("could not be read");
    expect(html).toContain("HTTP 503");
    expect(html).not.toContain("USDC");
  });
});

describe("/lab/refusals renders the total from the endpoint", () => {
  it("fetches /v1/public/rollup and prints its body", async () => {
    vi.resetModules();
    vi.doMock("@/lib/supabase", () => ({
      selectRowsStrict: async () => ({ ok: true, rows: [] }),
    }));
    const calls: string[] = [];
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      calls.push(String(input));
      return new Response(JSON.stringify(OK_PAYLOAD), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubEnv("PAYSTAGE_API", "https://rollup.test");
    vi.stubEnv("PAYSTAGE_ROLLUP_UNIT", "paystage");

    const { default: RefusalsPage } = await import("@/app/lab/refusals/page");
    const html = renderToStaticMarkup(await RefusalsPage());

    expect(calls).toEqual(["https://rollup.test/v1/public/rollup?unit=paystage"]);
    expect(html).toContain("1.55");
    expect(html).toContain("Division total");
    expect(html).toContain("paystage/engineering");
  });
});

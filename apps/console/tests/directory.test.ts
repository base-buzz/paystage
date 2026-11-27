import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import DirectoryPage from "@/app/directory/page";
import { GET } from "@/app/directory.json/route";
import {
  DIRECTORY,
  LISTING_MEANING,
  ORDER_EXPLANATION,
  demandLabel,
  directoryPayload,
  directoryView,
} from "@/lib/directory";

/**
 * `/directory` and `/directory.json` are one list, not two copies that are supposed to match (#497).
 *
 * The page is server-rendered from the same module the endpoint serves, so this test renders it and compares the
 * result with the endpoint's payload. It also pins the three sentences the page exists to carry — what a listing
 * means, where demand comes from, and why the order is what it is — because those are the claims, not decoration.
 */
const html = renderToStaticMarkup(createElement(DirectoryPage));
const view = directoryView(DIRECTORY);

describe("/directory and /directory.json", () => {
  it("serves exactly the snapshot the page renders, with the same rows", async () => {
    const response = GET();
    expect(response.headers.get("content-type")).toContain("application/json");
    const payload = await response.json();
    expect(payload).toEqual(JSON.parse(JSON.stringify(directoryPayload())));
    expect(payload.rows).toEqual(DIRECTORY.rows);
    expect(payload.rows).toHaveLength(view.rows.length);
  });

  it("links every row to its live resource, and no generator row is left off the page", () => {
    for (const row of view.rows) {
      expect(html).toContain(`href="${row.resource}"`);
      expect(html).toContain(row.host);
    }
    expect(view.withheld).toBe(0);
  });

  it("carries the listing-meaning line and the order, in the page's own words", () => {
    expect(html).toContain(LISTING_MEANING);
    expect(html).toContain(ORDER_EXPLANATION);
    expect(html).toContain("answered a payment challenge when we asked");
    expect(html).toContain("not that anybody paid it");
  });

  it("shows an explorer figure only with its source and date, and 'not known' everywhere else", () => {
    const withDemand = view.rows.filter((row) => row.x402scan !== null);
    const withoutDemand = view.rows.filter((row) => row.x402scan === null);
    expect(withDemand.length).toBe(DIRECTORY.counts.withDemand);
    expect(withoutDemand.length).toBe(DIRECTORY.counts.withoutDemand);

    for (const row of withDemand) {
      expect(row.x402scan!.source).toBe("x402scan");
      expect(row.x402scan!.capturedOn).toBe(DIRECTORY.source.demand!.capturedOn);
      expect(html).toContain(`href="${row.x402scan!.url}"`);
      expect(html).toContain(demandLabel(row.x402scan));
    }
    for (const row of withoutDemand) {
      expect(row.x402scan).toBeNull();
    }
    // One "not known" in the header, the caption, and per row without an explorer match; never a 0 demand cell.
    const notKnown = html.match(/not known/g) ?? [];
    expect(notKnown.length).toBeGreaterThanOrEqual(withoutDemand.length);
    expect(html).not.toContain("0 payments");
    expect(html).toContain("Do not sum this column");
  });

  it("states the order and the visible rows are in it", () => {
    expect(DIRECTORY.ordering.by).toBe("priceUsd");
    expect(DIRECTORY.ordering.direction).toBe("ascending");
    let previous = -1;
    for (const row of view.rows) {
      expect(row.priceUsd).toBeGreaterThanOrEqual(previous);
      previous = row.priceUsd;
    }
  });

  it("says what the census did not verify: four probed endpoints are not listed", () => {
    expect(DIRECTORY.counts.censusRows - DIRECTORY.counts.resources).toBe(DIRECTORY.counts.notAnswered);
    expect(html).toContain(`${DIRECTORY.counts.resources} of the`);
    expect(html).toContain(`${DIRECTORY.counts.notAnswered} endpoints`);
  });
});

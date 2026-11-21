import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { groupByChannel, unknownSentence } from "@/lib/channel-counts";
import { ChannelAttributionPanel } from "@/components/ChannelAttributionPanel";

/**
 * `/lab` channel grouping (#326).
 *
 * The null row is the point: a listing table that reports only known channels can make a 2% "direct" share look like
 * the whole story. These cases fail if unknown is dropped, merged, or labelled a channel.
 */
describe("groupByChannel", () => {
  it("groups counts per channel, highest first", () => {
    const counts = groupByChannel([
      { channel: "glama" },
      { channel: "glama" },
      { channel: "mcp.so" },
      { channel: "npm" },
    ]);
    expect(counts.channels).toEqual([
      { channel: "glama", count: 2 },
      { channel: "mcp.so", count: 1 },
      { channel: "npm", count: 1 },
    ]);
    expect(counts.unknown).toBe(0);
    expect(counts.total).toBe(4);
  });

  it("keeps null as its own row, never as a channel and never dropped from the total", () => {
    const counts = groupByChannel([
      { channel: "glama" },
      { channel: null },
      { channel: null },
      { channel: null },
      { channel: "glama" },
    ]);
    expect(counts.channels).toEqual([{ channel: "glama", count: 2 }]);
    expect(counts.unknown).toBe(3);
    expect(counts.total).toBe(5);
    expect(counts.channels.map((row) => row.channel)).not.toContain(null);
    expect(counts.channels.map((row) => row.channel)).not.toContain("direct");
  });

  it("counts an empty string as unknown rather than a nameless channel", () => {
    const counts = groupByChannel([{ channel: "" }, { channel: "glama" }]);
    expect(counts.channels).toEqual([{ channel: "glama", count: 1 }]);
    expect(counts.unknown).toBe(1);
  });

  it("returns a zero total for an empty window", () => {
    expect(groupByChannel([])).toEqual({ channels: [], unknown: 0, total: 0 });
  });

  it("states the unknown count and share in words", () => {
    const sentence = unknownSentence(groupByChannel([{ channel: null }, { channel: null }, { channel: "glama" }, { channel: "glama" }]));
    expect(sentence).toContain("2 of 4 events");
    expect(sentence).toContain("no channel");
    expect(sentence).toContain("own row");
  });
});

describe("ChannelAttributionPanel", () => {
  it("renders the unknown row and its count, not just the known channels", () => {
    const counts = groupByChannel([
      { channel: "glama" },
      { channel: "glama" },
      { channel: null },
      { channel: null },
    ]);
    const html = renderToStaticMarkup(
      createElement(ChannelAttributionPanel, {
        counts,
        reason: null,
        windowLabel: "the last 7 days",
      }),
    );
    expect(html).toContain("unknown channel");
    expect(html).toContain("2 of 4 events");
    expect(html).toContain("glama");
    expect(html).not.toContain(">direct<");
  });

  it("says a failed read is absent, not zero", () => {
    const html = renderToStaticMarkup(
      createElement(ChannelAttributionPanel, {
        counts: null,
        reason: "the database could not be reached",
        windowLabel: "the last 7 days",
      }),
    );
    expect(html).toContain("The counts are absent, not zero");
  });
});

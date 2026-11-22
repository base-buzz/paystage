import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { LISTS } from "@/lib/lists.generated";

/**
 * #370: /lists must show the current on-chain state and the date of the last event per address, not just "collected".
 *
 * The failure this guards is a page that still says an address is refused after Circle unfroze it — or one that shows
 * a state row with no date. The page source is checked for the rendering contract, and the generated manifest for the
 * data it renders: one state row per address, a block timestamp for the event that decided it, and the coverage caveat
 * still present.
 */
const PAGE = readFileSync(join(import.meta.dirname, "../src/app/lists/page.tsx"), "utf8");

describe("Circle on-chain state (#370)", () => {
  it("states the latest-event rule and renders the last-event date per address", () => {
    expect(PAGE).toContain("UnBlacklisted");
    expect(PAGE).toMatch(/latest one decides\s+the state/);
    expect(PAGE).toContain("entry.since");
    expect(PAGE).toContain("entry.state");
    expect(PAGE).toContain("Last event");
    // The #369 limitation sentence must be gone: an unfreeze is now reflected.
    expect(PAGE).not.toMatch(/no `UnBlacklisted` feed yet/);
    expect(PAGE).not.toMatch(/there is no\s*<code>UnBlacklisted<\/code> feed yet/);
  });

  it("keeps the coverage caveat, because an unfreeze below the range is still invisible", () => {
    expect(PAGE).toMatch(/Earlier history is not covered/);
    expect(PAGE).toMatch(/events below block/);
    expect(PAGE).toMatch(/unfreeze below that block/);
  });

  it("carries state, since and blockNumber in the generated manifest, not just membership", () => {
    const circle = LISTS.circleBlacklist;
    expect(circle.delistingTracked).toBe(true);
    expect(circle.unblacklistedTopic).toMatch(/^0x117e3210bb9aa7d9baff172026820255c6f6c30ba8999d1c2fd88e2848137c4e$/);
    expect(circle.states.length).toBe(circle.addresses + circle.unblacklisted);
    expect(circle.states.filter((entry) => entry.state === "blacklisted")).toHaveLength(circle.addresses);
    for (const entry of circle.states) {
      expect(["blacklisted", "unblacklisted"]).toContain(entry.state);
      expect(entry.address).toMatch(/^0x[0-9a-f]{40}$/);
      expect(Number.isSafeInteger(entry.blockNumber)).toBe(true);
      if (entry.since !== null) {
        expect(entry.since).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      }
    }
  });

  it("shows a real unfreeze date when the covered range contains one", () => {
    // `as const` narrows today's all-blacklisted snapshot to one literal, so widen the rows before filtering.
    const states: readonly { address: string; state: string; since: string | null; blockNumber: number }[] =
      LISTS.circleBlacklist.states;
    const unfrozen = states.filter((entry) => entry.state === "unblacklisted");
    for (const entry of unfrozen) {
      // A state row with no date would render "date not recorded", which is not "the date of the last event".
      expect(entry.since, `unfrozen ${entry.address} has no last-event date`).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
      );
    }
    if (unfrozen.length > 0) {
      expect(LISTS.circleBlacklist.lastUnblacklistAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    }
  });
});

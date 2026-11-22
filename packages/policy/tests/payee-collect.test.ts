import { describe, expect, it } from "vitest";
import {
  GOPLUS_RAW_KEYS,
  collectSource,
  goPlusObservations,
  mapGoPlusResult,
  normaliseGoPlusKey,
} from "../src/payee-collect.js";
import type { PayeeObservation } from "../src/payee-category.js";

const READ_AT = "2026-11-22T00:00:00.000Z";

/** A GoPlus body shaped like the live one: recognised keys, all five present, all negative. */
function allNegative(): Record<string, unknown> {
  return Object.fromEntries(GOPLUS_RAW_KEYS.map((key) => [key, "0"]));
}

describe("GoPlus raw key → normalised flag", () => {
  it("maps exactly the five raw keys the classifier accepts", () => {
    expect(normaliseGoPlusKey("cybercrime")).toBe("cybercrime");
    expect(normaliseGoPlusKey("phishing_activities")).toBe("phishing");
    expect(normaliseGoPlusKey("money_laundering")).toBe("laundering");
    expect(normaliseGoPlusKey("sanctioned")).toBe("sanctioned");
    expect(normaliseGoPlusKey("blacklist_doubt")).toBe("blacklist_doubt");
    expect(GOPLUS_RAW_KEYS).toHaveLength(5);
  });

  it("returns undefined for a raw key outside the five, rather than guessing", () => {
    expect(normaliseGoPlusKey("stealing_attack")).toBeUndefined();
    expect(normaliseGoPlusKey("contract_address")).toBeUndefined();
    expect(normaliseGoPlusKey("")).toBeUndefined();
  });

  it("produces only positive flags, in the classifier's order", () => {
    const mapping = mapGoPlusResult({
      ...allNegative(),
      phishing_activities: "1",
      money_laundering: "1",
      sanctioned: "1",
    });
    expect(mapping.flags).toEqual(["phishing", "laundering", "sanctioned"]);
    expect(mapping.missing).toEqual([]);
    expect(mapping.malformed).toEqual([]);
  });

  it("keeps a missing key as missing, never as a negative observation", () => {
    const body = allNegative();
    delete body["sanctioned"];
    const mapping = mapGoPlusResult(body);

    expect(mapping.flags).toEqual([]);
    expect(mapping.missing).toEqual(["sanctioned"]);
    // The rule the item is about: absent is unknown. It must not become a `false` row.
    expect(goPlusObservations(mapping, "GoPlus address_security", READ_AT)).toEqual([]);
  });

  it("surfaces a positive raw key outside the five instead of silently dropping it", () => {
    const mapping = mapGoPlusResult({ ...allNegative(), stealing_attack: "1" });
    expect(mapping.flags).toEqual([]);
    expect(mapping.unrecognised).toEqual(["stealing_attack"]);
  });

  it("treats a non-boolean value as malformed, not false", () => {
    const mapping = mapGoPlusResult({ ...allNegative(), cybercrime: "yes" });
    expect(mapping.flags).toEqual([]);
    expect(mapping.malformed).toEqual(["cybercrime"]);
  });

  it("emits one observation per positive flag, with the source and read date", () => {
    const mapping = mapGoPlusResult({ ...allNegative(), blacklist_doubt: "1" });
    expect(goPlusObservations(mapping, "GoPlus address_security", READ_AT)).toEqual([
      { source: "GoPlus address_security", observed_at: READ_AT, field: "goplus", value: "blacklist_doubt" },
    ]);
  });
});

describe("a failed source is unknown, not false", () => {
  it("returns no observations and status unknown when the source throws", async () => {
    const result = await collectSource({
      source: "test-rpc eth_getCode",
      observed_at: READ_AT,
      fields: ["code"],
      read: async (): Promise<boolean> => {
        throw new Error("HTTP 503");
      },
      toObservations: (value) => [
        { source: "test-rpc eth_getCode", observed_at: READ_AT, field: "code", value },
      ],
    });

    expect(result.report.status).toBe("unknown");
    expect(result.report.detail).toContain("HTTP 503");
    expect(result.observations).toEqual([]);
    // The only thing worse than an empty answer is an invented `false`.
    expect(result.observations.some((row) => row.field === "code" && row.value === false)).toBe(false);
  });

  it("returns no observations when the source answers but its body cannot be read", async () => {
    const result = await collectSource({
      source: "test-rpc eth_getCode",
      observed_at: READ_AT,
      fields: ["code"],
      read: async (): Promise<{ body: string }> => ({ body: "not json" }),
      toObservations: () => {
        throw new Error("unexpected token");
      },
    });

    expect(result.report.status).toBe("unknown");
    expect(result.observations).toEqual([]);
  });

  it("keeps observations as observed when the source answers", async () => {
    const result = await collectSource({
      source: "test-rpc eth_getCode",
      observed_at: READ_AT,
      fields: ["code"],
      read: async (): Promise<boolean> => true,
      toObservations: (value) => [
        { source: "test-rpc eth_getCode", observed_at: READ_AT, field: "code", value },
      ],
    });

    expect(result.report.status).toBe("observed");
    expect(result.observations).toEqual([
      { source: "test-rpc eth_getCode", observed_at: READ_AT, field: "code", value: true },
    ]);
  });

  it("rejects an observation attributed to another source, instead of keeping unattributable provenance", async () => {
    const result = await collectSource({
      source: "test-rpc eth_getCode",
      observed_at: READ_AT,
      fields: ["code"],
      read: async (): Promise<boolean> => true,
      toObservations: (value): PayeeObservation[] => [
        { source: "somewhere else", observed_at: READ_AT, field: "code", value },
      ],
    });

    expect(result.report.status).toBe("unknown");
    expect(result.observations).toEqual([]);
  });
});

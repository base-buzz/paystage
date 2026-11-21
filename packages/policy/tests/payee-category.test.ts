import { describe, expect, it } from "vitest";
import {
  categorise,
  ageBand,
  activityBand,
  InvalidPayeeObservationError,
  type PayeeLabel,
  type PayeeObservation,
} from "../src/payee-category.js";

const READ_AT = "2026-11-21T00:00:00.000Z";
const DAY_MS = 86_400_000;

function daysBefore(days: number): string {
  return new Date(Date.parse(READ_AT) - days * DAY_MS).toISOString();
}

function labelValues(labels: readonly PayeeLabel[], field: PayeeLabel["field"]): unknown[] {
  return labels.filter((label) => label.field === field).map((label) => label.value);
}

describe("payee categories", () => {
  it("reads contract vs EOA from code presence, and keeps the source and read date", () => {
    const contract = categorise([
      { source: "base-rpc eth_getCode", observed_at: READ_AT, field: "code", value: true },
    ]);
    expect(labelValues(contract.labels, "kind")).toEqual(["contract"]);
    expect(contract.labels[0]?.provenance).toEqual([
      { source: "base-rpc eth_getCode", observed_at: READ_AT },
    ]);

    const eoa = categorise([
      { source: "base-rpc eth_getCode", observed_at: READ_AT, field: "code", value: false },
    ]);
    expect(labelValues(eoa.labels, "kind")).toEqual(["eoa"]);
  });

  it("age bands change at 30, 180 and 730 days, measured at the read date", () => {
    const cases: Array<[number, string]> = [
      [0, "<30d"],
      [29, "<30d"],
      [30, "30-179d"],
      [179, "30-179d"],
      [180, "180-729d"],
      [729, "180-729d"],
      [730, ">=730d"],
    ];
    for (const [days, expected] of cases) {
      const observed = categorise([
        {
          source: "dated first-seen source",
          observed_at: READ_AT,
          field: "first_seen",
          value: daysBefore(days),
        },
      ]);
      expect(labelValues(observed.labels, "age_band"), `${days} days`).toEqual([expected]);
      expect(ageBand(daysBefore(days), READ_AT)).toBe(expected);
    }
  });

  it("keeps a GoPlus flag as its own labelled observation, not as an answer", () => {
    const observed = categorise([
      {
        source: "GoPlus address_security",
        observed_at: "2026-11-20T12:00:00.000Z",
        field: "goplus",
        value: "phishing",
      },
    ]);

    expect(observed.labels).toHaveLength(1);
    expect(observed.labels[0]).toEqual({
      field: "goplus",
      value: "phishing",
      provenance: [
        { source: "GoPlus address_security", observed_at: "2026-11-20T12:00:00.000Z" },
      ],
    });
    expect(observed.observations).toHaveLength(1);
    expect(observed.disagreements).toEqual([]);
  });

  it("keeps both conflicting age sources and flags the field in disagreements", () => {
    const observed = categorise([
      {
        source: "source-a",
        observed_at: READ_AT,
        field: "first_seen",
        value: "2020-01-01T00:00:00.000Z",
      },
      {
        source: "source-b",
        observed_at: READ_AT,
        field: "first_seen",
        value: "2026-10-01T00:00:00.000Z",
      },
    ]);

    // Neither source is picked as the winner: both derived bands survive.
    expect(labelValues(observed.labels, "age_band").sort()).toEqual(["30-179d", ">=730d"]);
    expect(observed.observations).toHaveLength(2);

    expect(observed.disagreements).toHaveLength(1);
    expect(observed.disagreements[0]?.field).toBe("first_seen");
    expect(observed.disagreements[0]?.values).toEqual([
      { value: "2020-01-01T00:00:00.000Z", source: "source-a", observed_at: READ_AT },
      { value: "2026-10-01T00:00:00.000Z", source: "source-b", observed_at: READ_AT },
    ]);
  });

  it("keeps a positive list hit as listed, and never turns false into a clearing label", () => {
    const hit = categorise([
      { source: "OFAC SDN", observed_at: READ_AT, field: "sanctions", value: true },
      { source: "PayStage drainer list", observed_at: READ_AT, field: "drainer", value: true },
    ]);
    expect(labelValues(hit.labels, "listed").sort()).toEqual(["drainer", "sanctions"]);

    const miss = categorise([
      { source: "OFAC SDN", observed_at: READ_AT, field: "sanctions", value: false },
    ]);
    expect(labelValues(miss.labels, "listed")).toEqual([]);
    expect(miss.observations).toHaveLength(1);
  });

  it("bands activity from nonce or transaction count without inventing a reputation", () => {
    const cases: Array<[number, string]> = [
      [0, "0"],
      [1, "1-9"],
      [9, "1-9"],
      [10, "10-99"],
      [99, "10-99"],
      [100, "100-999"],
      [999, "100-999"],
      [1000, ">=1000"],
    ];
    for (const [count, expected] of cases) {
      const observed = categorise([
        { source: "base-rpc eth_getTransactionCount", observed_at: READ_AT, field: "nonce", value: count },
      ]);
      expect(labelValues(observed.labels, "activity_band"), `${count}`).toEqual([expected]);
      expect(activityBand(count)).toBe(expected);
    }
  });

  it("keeps holds_asset tied to the named asset", () => {
    const observed = categorise([
      {
        source: "base-rpc eth_call balanceOf",
        observed_at: READ_AT,
        field: "holds_asset",
        value: { asset: "USDC", holds: false },
      },
    ]);
    expect(observed.labels).toEqual([
      {
        field: "holds_asset",
        value: { asset: "USDC", holds: false },
        provenance: [{ source: "base-rpc eth_call balanceOf", observed_at: READ_AT }],
      },
    ]);
  });

  it("produces the same output when observations are reordered", () => {
    const observations: PayeeObservation[] = [
      { source: "source-b", observed_at: READ_AT, field: "code", value: true },
      { source: "source-a", observed_at: READ_AT, field: "code", value: false },
      { source: "GoPlus", observed_at: READ_AT, field: "goplus", value: "cybercrime" },
      { source: "OFAC SDN", observed_at: READ_AT, field: "sanctions", value: true },
      { source: "source-a", observed_at: READ_AT, field: "nonce", value: 12 },
    ];

    const forward = categorise(observations);
    const reversed = categorise([...observations].reverse());
    const shuffled = categorise([observations[3]!, observations[0]!, observations[4]!, observations[1]!, observations[2]!]);

    expect(reversed).toEqual(forward);
    expect(shuffled).toEqual(forward);
  });

  it("emits only labels, observations and disagreements — no score field exists", () => {
    const observed = categorise([
      { source: "base-rpc eth_getCode", observed_at: READ_AT, field: "code", value: true },
      { source: "GoPlus", observed_at: READ_AT, field: "goplus", value: "sanctioned" },
    ]);

    expect(Object.keys(observed).sort()).toEqual(["disagreements", "labels", "observations"]);
    for (const label of observed.labels) {
      expect(Object.keys(label).sort()).toEqual(["field", "provenance", "value"]);
      for (const key of Object.keys(label)) {
        expect(key).not.toMatch(/score|trust|risk|reputation|verdict/i);
      }
    }
    for (const key of Object.keys(observed)) {
      expect(key).not.toMatch(/score|trust|risk|reputation|verdict/i);
    }
    // Values are facts (boolean, range string, asset name, list name, flag), never an aggregate number.
    for (const label of observed.labels) {
      expect(typeof label.value).not.toBe("number");
    }
  });

  it("cannot produce a label without provenance", () => {
    expect(categorise([])).toEqual({ labels: [], observations: [], disagreements: [] });

    expect(() =>
      categorise([
        { source: "", observed_at: READ_AT, field: "code", value: true },
      ]),
    ).toThrow(InvalidPayeeObservationError);

    expect(() =>
      categorise([
        { source: "base-rpc eth_getCode", observed_at: "  ", field: "code", value: true },
      ]),
    ).toThrow(InvalidPayeeObservationError);

    // Every label that does exist carries at least one named source and date.
    const observed = categorise([
      {
        source: "source-a",
        observed_at: READ_AT,
        field: "first_seen",
        value: "2026-01-01T00:00:00.000Z",
      },
    ]);
    expect(observed.labels.length).toBeGreaterThan(0);
    for (const label of observed.labels) {
      expect(label.provenance.length).toBeGreaterThan(0);
      for (const provenance of label.provenance) {
        expect(provenance.source).not.toBe("");
        expect(provenance.observed_at).not.toBe("");
      }
    }
  });

  it("rejects a field it does not recognise instead of guessing a category", () => {
    expect(() =>
      categorise([
        // Deliberately outside the union at runtime; the collector must be fixed, not guessed around.
        { source: "someone", observed_at: READ_AT, field: "reputation", value: 99 } as unknown as PayeeObservation,
      ]),
    ).toThrow(InvalidPayeeObservationError);
  });
});

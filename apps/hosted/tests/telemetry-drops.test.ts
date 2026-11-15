import { describe, it, expect } from "vitest";
import { recordDroppedField, telemetryDrops } from "../src/telemetry.js";

describe("dropped-field signal", () => {
  it("starts empty and reports what was dropped", () => {
    const before = telemetryDrops();
    recordDroppedField("payer");
    const after = telemetryDrops();
    expect(after.count).toBe(before.count + 1);
    expect(after.fields).toContain("payer");
    expect(after.last).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("de-duplicates field names but keeps counting", () => {
    const start = telemetryDrops().count;
    recordDroppedField("payer");
    recordDroppedField("payer");
    expect(telemetryDrops().count).toBe(start + 2);
    expect(telemetryDrops().fields.filter((f) => f === "payer")).toHaveLength(1);
  });

  it("stays bounded", () => {
    for (let i = 0; i < 100; i++) recordDroppedField(`field_${i}`);
    expect(telemetryDrops().count).toBeLessThanOrEqual(20);
  });
});

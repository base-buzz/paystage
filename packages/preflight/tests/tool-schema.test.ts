import { describe, expect, it } from "vitest";
import { evaluateToolInput } from "../src/tool-schema.js";

/**
 * `tools/list` advertises this document, so it is a public surface: an agent's client builds its
 * tool call from it. The value below is exactly what zod 4.6.7 emitted for
 * `z.object({ payment_required: z.unknown(), policy_path: z.string().optional(), policy: z.unknown().optional() })`
 * on the commit before #181, and the SDK puts it on the wire unchanged (it only prepends
 * `type: "object"` if the root has none).
 */
const EXPECTED_JSON_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    payment_required: {},
    policy_path: { type: "string" },
    policy: {},
  },
  required: ["payment_required"],
};

const standard = evaluateToolInput["~standard"];

describe("the MCP tool input schema", () => {
  it("advertises the same tool signature zod produced", () => {
    expect(standard.jsonSchema.input({ target: "draft-2020-12" })).toEqual(EXPECTED_JSON_SCHEMA);
  });

  it("keeps the signature unchanged for a declaration merge", () => {
    // The SDK asks for this target explicitly; other targets are not requested, but the output
    // must still be a valid object schema if a client asks.
    const schema = standard.jsonSchema.input({ target: "draft-07" });
    expect(schema.type).toBe("object");
    expect(schema.required).toEqual(["payment_required"]);
  });

  it("accepts the documented call and strips unknown arguments", () => {
    const result = standard.validate({ payment_required: { x402Version: 2 }, extra: 1 });
    expect(result).toEqual({ value: { payment_required: { x402Version: 2 } } });
  });

  it("passes the optional policy through", () => {
    const result = standard.validate({ payment_required: {}, policy: { version: 1 } });
    expect(result).toEqual({ value: { payment_required: {}, policy: { version: 1 } } });
  });

  it("accepts a policy_path and rejects a non-string one with zod's message", () => {
    expect(standard.validate({ payment_required: {}, policy_path: "/tmp/policy.json" })).toEqual({
      value: { payment_required: {}, policy_path: "/tmp/policy.json" },
    });
    expect(standard.validate({ payment_required: {}, policy_path: 5 })).toEqual({
      issues: [
        {
          expected: "string",
          code: "invalid_type",
          path: ["policy_path"],
          message: "Invalid input: expected string, received number",
        },
      ],
    });
  });

  it("requires payment_required to be present, as z.unknown() did on input", () => {
    expect(standard.validate({ policy_path: "/tmp/policy.json" })).toEqual({
      issues: [
        {
          code: "invalid_type",
          expected: "nonoptional",
          path: ["payment_required"],
          message: "Invalid input: expected nonoptional, received undefined",
        },
      ],
    });
  });

  it("accepts an explicitly-undefined payment_required and drops it, as zod did", () => {
    expect(standard.validate({ payment_required: undefined })).toEqual({ value: {} });
    expect(standard.validate({ payment_required: null })).toEqual({ value: { payment_required: null } });
  });

  it("rejects non-object arguments with zod's messages", () => {
    expect(standard.validate(null)).toEqual({
      issues: [
        {
          expected: "object",
          code: "invalid_type",
          path: [],
          message: "Invalid input: expected object, received null",
        },
      ],
    });
    expect(standard.validate([1])).toEqual({
      issues: [
        {
          expected: "object",
          code: "invalid_type",
          path: [],
          message: "Invalid input: expected object, received array",
        },
      ],
    });
  });

  it("reports the required key before the optional one, in shape order", () => {
    expect(standard.validate({ policy_path: 2 })).toEqual({
      issues: [
        {
          code: "invalid_type",
          expected: "nonoptional",
          path: ["payment_required"],
          message: "Invalid input: expected nonoptional, received undefined",
        },
        {
          expected: "string",
          code: "invalid_type",
          path: ["policy_path"],
          message: "Invalid input: expected string, received number",
        },
      ],
    });
  });
});

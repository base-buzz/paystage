/**
 * The `evaluate_mcp_payment` argument schema, hand-written (#181).
 *
 * `@modelcontextprotocol/server` accepts a
 * [Standard Schema](https://standardschema.dev) for a tool's `inputSchema`: it calls
 * `~standard.jsonSchema.input()` to advertise the arguments in `tools/list` and
 * `~standard.validate()` to check a `tools/call`. zod implemented both; this does the same two
 * jobs in ~60 lines so `@paystage/preflight` no longer depends on zod.
 *
 * The JSON Schema and the validation results are pinned in `tests/tool-schema.test.ts` against
 * the values zod 4.6.7 produced for the same shape — the tool's advertised signature is a
 * public surface, so "close enough" is not the bar.
 *
 * The MCP server itself (`./mcp`) still needs `@modelcontextprotocol/server`, which lists zod as
 * its own dependency. That is the honest scope of this change: the *evaluator* is zero-dependency,
 * the server inherits zod from the official SDK and cannot be made zod-free from here.
 */
import type { StandardSchemaWithJSON } from "@modelcontextprotocol/server";

export interface EvaluateToolInput {
  payment_required: unknown;
  policy_path?: string;
  policy?: unknown;
}

interface ToolIssue {
  readonly code: string;
  readonly expected?: string;
  readonly path: Array<string | number>;
  readonly message: string;
}

/** The type name zod puts in `Invalid input: expected X, received Y`. */
function receivedType(input: unknown): string {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  if (typeof input === "number") {
    if (Number.isNaN(input)) return "NaN";
    if (!Number.isFinite(input)) return String(input);
    return "number";
  }
  if (typeof input === "object") {
    const name = Object.getPrototypeOf(input)?.constructor?.name;
    return typeof name === "string" && name !== "Object" ? name : "object";
  }
  return typeof input;
}

const invalidType = (path: Array<string | number>, expected: string, input: unknown): ToolIssue => ({
  expected,
  code: "invalid_type",
  path,
  message: `Invalid input: expected ${expected}, received ${receivedType(input)}`,
});

/**
 * zod's `z.object({ payment_required: z.unknown(), policy_path: z.string().optional(), policy: z.unknown().optional() })`
 * emits this exact document — key order included — and the SDK puts it on the wire for
 * `tools/list`. `payment_required` stays required even though `z.unknown()` accepts any value.
 */
const JSON_SCHEMA: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  type: "object",
  properties: {
    payment_required: {},
    policy_path: { type: "string" },
    policy: {},
  },
  required: ["payment_required"],
};

function validate(value: unknown): { value: EvaluateToolInput } | { issues: ToolIssue[] } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return { issues: [invalidType([], "object", value)] };
  }
  const input = value as Record<string, unknown>;
  const issues: ToolIssue[] = [];

  // zod accepts a `payment_required` key whose value is explicitly `undefined`, but rejects the
  // key being absent — `z.unknown()` is non-optional on input.
  if (!("payment_required" in input)) {
    issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      path: ["payment_required"],
      message: "Invalid input: expected nonoptional, received undefined",
    });
  }
  if (input.policy_path !== undefined && typeof input.policy_path !== "string") {
    issues.push(invalidType(["policy_path"], "string", input.policy_path));
  }
  if (issues.length > 0) return { issues };

  // Unknown arguments are stripped and optional keys with an `undefined` value are omitted,
  // which is zod's object behaviour and what the handler was already receiving.
  const parsed: EvaluateToolInput = { payment_required: input.payment_required };
  if (input.policy_path !== undefined) parsed.policy_path = input.policy_path as string;
  if (input.policy !== undefined) parsed.policy = input.policy;
  return { value: parsed };
}

export const evaluateToolInput = {
  "~standard": {
    version: 1,
    vendor: "paystage",
    validate,
    jsonSchema: {
      input: () => JSON_SCHEMA,
      output: () => JSON_SCHEMA,
    },
  },
} as unknown as StandardSchemaWithJSON<EvaluateToolInput>;

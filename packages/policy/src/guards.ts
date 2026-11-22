/**
 * The schema engine behind `PolicySchema`, written by hand (#181).
 *
 * `@paystage/policy` is the evaluator every other surface depends on, and it used to depend on
 * zod. That put a package with no relation to a signing path inside one: `npm i
 * @paystage/preflight` pulled in zod because the policy parser needed it. The guards below are
 * the replacement, and the contract they are held to is not "looks equivalent" — it is the
 * differential test in `tests/differential.test.ts`, which runs zod and these guards over the
 * whole corpus (every fixture in the repo plus deterministic mutations) and requires the same
 * accept/reject decision, the same parsed output and the same error message byte for byte.
 *
 * Two behaviours are load-bearing and easy to lose:
 *
 *  - **The message is the JSON issue array.** `error.message` is what `@paystage/x402-guard`
 *    wraps in `invalid policy: …` and what the MCP `validate_policy` tool prints. zod builds it
 *    with `JSON.stringify(issues, replacer, 2)`, so the issue objects here are constructed in
 *    zod's own key order — the order survives into the message.
 *  - **Aborting vs non-aborting issues.** In zod a check can fail `soft` (the value is kept and
 *    later checks still run: `.min()`, `.max()`, `.regex()`, an unsafe integer) or `abort`
 *    (`invalid_type`, `invalid_value`, a bad record key, a tuple of the wrong length). A schema's
 *    `refine`/`superRefine` runs only when nothing before it aborted. `PolicySchema` uses that to
 *    decide whether the cross-field checks (decimals, duplicates, uncapped assets) still run for
 *    a document that already failed — reproducing it is what keeps the issue list identical.
 *
 * Unknown object keys are **stripped**, not rejected, because that is what zod's objects do and
 * rejecting them here would be a regression for documents that parse today.
 */

export type Path = Array<string | number>;

export interface PolicyIssue {
  code: string;
  path: Path;
  message: string;
  [field: string]: unknown;
}

export interface SchemaSink {
  readonly issues: PolicyIssue[];
  /** A failed type/value check: zod stops running this schema's own checks. */
  abort(issue: PolicyIssue): void;
  /** A failed size/format/range check: the value is kept and later checks still run. */
  soft(issue: PolicyIssue): void;
  /** Whether an aborting issue was raised since `start` — the local payload `refine` sees. */
  abortedSince(start: number): boolean;
}

export function createSink(): SchemaSink {
  const issues: PolicyIssue[] = [];
  const aborting = new Set<PolicyIssue>();
  return {
    issues,
    abort(issue) {
      aborting.add(issue);
      issues.push(issue);
    },
    soft(issue) {
      issues.push(issue);
    },
    abortedSince(start) {
      for (let index = start; index < issues.length; index += 1) {
        if (aborting.has(issues[index]!)) return true;
      }
      return false;
    },
  };
}

/** What zod's `ZodError` throws here. Same `.message`, same `.issues`; a name that is ours. */
export class PolicyParseError extends Error {
  readonly issues: PolicyIssue[];

  constructor(issues: PolicyIssue[]) {
    super(
      JSON.stringify(
        issues,
        (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        2,
      ),
    );
    this.name = "PolicyParseError";
    this.issues = issues;
  }
}

/** The received-type name zod puts in `Invalid input: expected X, received Y`. */
function receivedType(input: unknown): string {
  if (input === null) return "null";
  if (Array.isArray(input)) return "array";
  if (typeof input === "number") {
    if (Number.isNaN(input)) return "NaN";
    if (!Number.isFinite(input)) return String(input);
    return "number";
  }
  if (typeof input === "object") {
    // zod names a non-plain object by its constructor: Date, Map, Set, Promise, …
    const name = Object.getPrototypeOf(input)?.constructor?.name;
    return typeof name === "string" && name !== "Object" ? name : "object";
  }
  return typeof input;
}

const invalidType = (path: Path, expected: string, input: unknown): PolicyIssue => {
  const received = receivedType(input);
  // Only `$ZodNumber` records the concrete non-finite value; every other type issue omits it.
  const nonFiniteNumber = expected === "number" && typeof input === "number" && !Number.isFinite(input);
  return {
    expected,
    code: "invalid_type",
    ...(nonFiniteNumber ? { received } : {}),
    path,
    message: `Invalid input: expected ${expected}, received ${received}`,
  };
};

/** `z.number().int()` is zod 4's safe-integer format, and its message is a type message. */
const invalidInteger = (path: Path): PolicyIssue => ({
  expected: "int",
  format: "safeint",
  code: "invalid_type",
  path,
  message: "Invalid input: expected int, received number",
});

const integerRange = (path: Path, tooBig: boolean): PolicyIssue =>
  tooBig
    ? {
        code: "too_big",
        maximum: Number.MAX_SAFE_INTEGER,
        note: "Integers must be within the safe integer range.",
        origin: "int",
        inclusive: true,
        path,
        message: `Too big: expected int to be <=${Number.MAX_SAFE_INTEGER}`,
      }
    : {
        code: "too_small",
        minimum: Number.MIN_SAFE_INTEGER,
        note: "Integers must be within the safe integer range.",
        origin: "int",
        inclusive: true,
        path,
        message: `Too small: expected int to be >=${Number.MIN_SAFE_INTEGER}`,
      };

/**
 * `z.string().min(n)` and `z.array(...).min(n)` are the same zod check, and it runs whenever the
 * value has a `length` — even if the value failed its type check first. That is why an empty
 * array handed to a `z.string().min(1)` reports both an `invalid_type` and a `too_small`.
 */
const tooSmallLength = (path: Path, minimum: number, input: unknown): PolicyIssue => {
  const origin = Array.isArray(input) ? "array" : typeof input === "string" ? "string" : "unknown";
  const unit = origin === "string" ? "characters" : origin === "array" ? "items" : undefined;
  return {
    origin,
    code: "too_small",
    minimum,
    inclusive: true,
    path,
    message:
      unit === undefined
        ? `Too small: expected ${origin} to be >=${minimum}`
        : `Too small: expected ${origin} to have >=${minimum} ${unit}`,
  };
};

/** The length check as zod runs it: only on a non-nullish value that has a `length`. */
function lengthCheck(path: Path, minimum: number, input: unknown): PolicyIssue | undefined {
  if (input === null || input === undefined) return undefined;
  const units = (input as { length?: unknown }).length;
  if (typeof units !== "number") return undefined;
  // zod measures strings in code points. `minimum` is 1 everywhere in this schema, where a
  // non-empty string always clears the floor, so the units count is exact for these guards.
  if (units >= minimum) return undefined;
  return tooSmallLength(path, minimum, input);
}

const tooSmallNumber = (path: Path, minimum: number, inclusive: boolean): PolicyIssue => ({
  origin: "number",
  code: "too_small",
  minimum,
  inclusive,
  path,
  message: `Too small: expected number to be ${inclusive ? ">=" : ">"}${minimum}`,
});

const tooBigNumber = (path: Path, maximum: number): PolicyIssue => ({
  origin: "number",
  code: "too_big",
  maximum,
  inclusive: true,
  path,
  message: `Too big: expected number to be <=${maximum}`,
});

/** Tuple length failures are the tuple schema's own issues, in its own key order. */
const tupleTooSmall = (path: Path, minimum: number): PolicyIssue => ({
  code: "too_small",
  minimum,
  inclusive: true,
  origin: "array",
  path,
  message: `Too small: expected array to have >=${minimum} items`,
});

const tupleTooBig = (path: Path, maximum: number): PolicyIssue => ({
  code: "too_big",
  maximum,
  inclusive: true,
  origin: "array",
  path,
  message: `Too big: expected array to have <=${maximum} items`,
});

const invalidFormat = (path: Path, pattern: RegExp, message: string): PolicyIssue => ({
  origin: "string",
  code: "invalid_format",
  format: "regex",
  pattern: String(pattern),
  path,
  message: message === "" ? `Invalid string: must match pattern ${String(pattern)}` : message,
});

const invalidValue = (path: Path, values: readonly unknown[], message: string): PolicyIssue => ({
  code: "invalid_value",
  values: [...values],
  path,
  message,
});

const invalidRecordKey = (path: Path): PolicyIssue => ({
  code: "invalid_key",
  origin: "record",
  issues: [
    {
      origin: "string",
      code: "too_small",
      minimum: 1,
      inclusive: true,
      path: [],
      message: "Too small: expected string to have >=1 characters",
    },
  ],
  path,
  message: "Invalid key in record",
});

export type Schema =
  | { readonly kind: "string"; readonly min?: number; readonly pattern?: RegExp; readonly patternMessage?: string }
  | {
      readonly kind: "number";
      readonly integer?: true;
      readonly minimum?: number;
      readonly minimumInclusive?: boolean;
      readonly maximum?: number;
    }
  | { readonly kind: "boolean" }
  | { readonly kind: "literal"; readonly value: unknown }
  | { readonly kind: "enum"; readonly values: readonly string[] }
  | { readonly kind: "array"; readonly element: Schema; readonly min?: number }
  | { readonly kind: "tuple"; readonly items: readonly Schema[] }
  | { readonly kind: "record"; readonly value: Schema }
  | { readonly kind: "object"; readonly fields: readonly Field[]; readonly refine?: Refinement };

export interface Field {
  readonly key: string;
  readonly schema: Schema;
  readonly optional?: true;
}

/** The cross-field checks: same signature and same order as the zod `.refine`/`.superRefine`. */
export type Refinement = (value: Record<string, unknown>, sink: SchemaSink) => void;

function isObjectLike(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}

/**
 * Parse one node. Returns the parsed value, or `undefined` when an aborting issue was raised —
 * `undefined` is not a legal value anywhere in the policy schema, so it doubles as the failure
 * marker. Soft failures return the input value, which is what zod does: the cross-field checks
 * still see `decimals: -1` and report against it.
 */
export function parseNode(schema: Schema, input: unknown, path: Path, sink: SchemaSink): unknown {
  switch (schema.kind) {
    case "string": {
      if (typeof input !== "string") {
        sink.abort(invalidType(path, "string", input));
        // A length check still runs on a wrong-typed value that happens to have a `length`.
        if (schema.min !== undefined) {
          const issue = lengthCheck(path, schema.min, input);
          if (issue !== undefined) sink.soft(issue);
        }
        return undefined;
      }
      if (schema.min !== undefined) {
        const issue = lengthCheck(path, schema.min, input);
        if (issue !== undefined) sink.soft(issue);
      }
      if (schema.pattern !== undefined && !schema.pattern.test(input)) {
        sink.soft(invalidFormat(path, schema.pattern, schema.patternMessage ?? ""));
      }
      return input;
    }

    case "number": {
      if (typeof input !== "number" || !Number.isFinite(input)) {
        sink.abort(invalidType(path, "number", input));
        return undefined;
      }
      if (schema.integer === true) {
        if (!Number.isInteger(input)) {
          sink.abort(invalidInteger(path));
          return undefined;
        }
        if (!Number.isSafeInteger(input)) {
          sink.soft(integerRange(path, input > 0));
        }
      }
      if (schema.minimum !== undefined) {
        const inclusive = schema.minimumInclusive !== false;
        if (inclusive ? input < schema.minimum : input <= schema.minimum) {
          sink.soft(tooSmallNumber(path, schema.minimum, inclusive));
        }
      }
      if (schema.maximum !== undefined && input > schema.maximum) {
        sink.soft(tooBigNumber(path, schema.maximum));
      }
      return input;
    }

    case "boolean": {
      if (typeof input !== "boolean") {
        sink.abort(invalidType(path, "boolean", input));
        return undefined;
      }
      return input;
    }

    case "literal": {
      if (input !== schema.value) {
        sink.abort(
          invalidValue(
            path,
            [schema.value],
            `Invalid input: expected ${
              typeof schema.value === "string" ? `"${schema.value}"` : String(schema.value)
            }`,
          ),
        );
        return undefined;
      }
      return input;
    }

    case "enum": {
      if (typeof input !== "string" || !schema.values.includes(input)) {
        sink.abort(
          invalidValue(
            path,
            schema.values,
            `Invalid option: expected one of ${schema.values.map((value) => `"${value}"`).join("|")}`,
          ),
        );
        return undefined;
      }
      return input;
    }

    case "array": {
      if (!Array.isArray(input)) {
        sink.abort(invalidType(path, "array", input));
        if (schema.min !== undefined) {
          const issue = lengthCheck(path, schema.min, input);
          if (issue !== undefined) sink.soft(issue);
        }
        return undefined;
      }
      const parsed = input.map((element, index) =>
        parseNode(schema.element, element, [...path, index], sink),
      );
      // zod runs length checks after the elements, and they are not skipped by an element abort.
      if (schema.min !== undefined) {
        const issue = lengthCheck(path, schema.min, input);
        if (issue !== undefined) sink.soft(issue);
      }
      return parsed;
    }

    case "tuple": {
      if (!Array.isArray(input)) {
        sink.abort(invalidType(path, "tuple", input));
        return undefined;
      }
      if (input.length < schema.items.length) {
        sink.abort(tupleTooSmall(path, schema.items.length));
        return undefined;
      }
      if (input.length > schema.items.length) {
        sink.abort(tupleTooBig(path, schema.items.length));
      }
      return schema.items.map((item, index) => parseNode(item, input[index], [...path, index], sink));
    }

    case "record": {
      if (!isObjectLike(input)) {
        sink.abort(invalidType(path, "record", input));
        return undefined;
      }
      const parsed: Record<string, unknown> = {};
      for (const key of Object.keys(input)) {
        // The only key schema in the policy is `z.string().min(1)`, and object keys are strings.
        if (key.length === 0) {
          sink.abort(invalidRecordKey([...path, key]));
          continue;
        }
        parsed[key] = parseNode(schema.value, input[key], [...path, key], sink);
      }
      return parsed;
    }

    case "object": {
      if (!isObjectLike(input)) {
        sink.abort(invalidType(path, "object", input));
        return undefined;
      }
      const start = sink.issues.length;
      const parsed: Record<string, unknown> = {};
      // Shape order, not input order: zod's output follows the schema, and the issue order does
      // too, so both are reproduced here rather than inherited from the caller's JSON.
      for (const field of schema.fields) {
        const value = input[field.key];
        if (value === undefined && field.optional === true) {
          // A key that is present but `undefined` stays present in zod's output; only an absent
          // key is omitted. The distinction is invisible to JSON but not to `toEqual`.
          if (field.key in input) parsed[field.key] = undefined;
          continue;
        }
        const result = parseNode(field.schema, value, [...path, field.key], sink);
        if (result !== undefined) parsed[field.key] = result;
      }
      // The nested `refine` sees its own payload only: a sibling's abort does not suppress it.
      if (schema.refine !== undefined && !sink.abortedSince(start)) {
        schema.refine(parsed, sink);
      }
      return parsed;
    }
  }
}

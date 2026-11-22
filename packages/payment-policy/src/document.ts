import { PolicySchema, type Policy } from "@paystage/policy";
import { canonicalJson } from "./canonical.js";
import type { PolicyDocument } from "./types.js";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * The fields `@paystage/policy` v1 accepts, read from the schema itself rather than copied into
 * this package. If the shared schema gains a field, it is representable here on the next build;
 * if this package kept its own list, the two vocabularies would drift, which is the failure the
 * dependency exists to prevent.
 */
const POLICY_FIELDS = new Set(Object.keys((PolicySchema as unknown as { shape: Record<string, unknown> }).shape));

function refuseUnknownFields(fields: string[], where: string): void {
  if (fields.length === 0) return;
  throw new Error(
    `${where} contains ${fields.length === 1 ? "field" : "fields"} not in the @paystage/policy v1 schema: ` +
      `${fields.map((field) => `"${field}"`).join(", ")}. Refusing to drop ${fields.length === 1 ? "it" : "them"} silently.`,
  );
}

function refuseUndefinedFields(policy: Record<string, unknown>): void {
  const undefinedFields = Object.keys(policy).filter((field) => policy[field] === undefined);
  if (undefinedFields.length === 0) return;
  throw new Error(
    `policy has undefined field${undefinedFields.length === 1 ? "" : "s"} ` +
      `${undefinedFields.map((field) => `"${field}"`).join(", ")}; omit optional fields instead, ` +
      `because undefined has no JSON representation and emit→parse would not be lossless`,
  );
}

/**
 * Validate a `Policy` and lift `version` above `rules`, which is the shape the draft publishes.
 *
 * Unknown fields are refused rather than stripped: an object with a field this package cannot
 * represent is a finding, and silently returning a document without it would hide the finding.
 */
export function policyDocument(policy: Policy): PolicyDocument {
  if (!isRecord(policy)) throw new TypeError("policy must be an object");

  const unknown = Object.keys(policy).filter((field) => !POLICY_FIELDS.has(field));
  refuseUnknownFields(unknown, "policy");
  refuseUndefinedFields(policy);

  const parsed = PolicySchema.parse(policy) as Record<string, unknown>;
  const { version, ...rules } = parsed;
  return { version: version as 1, rules: rules as PolicyDocument["rules"] };
}

/** Canonical bytes of a policy document: sorted keys, no incidental whitespace. */
export function serializePolicyDocument(document: PolicyDocument): string {
  if (!isRecord(document)) throw new TypeError("policy document must be an object");

  const topLevel = Object.keys(document).sort();
  if (topLevel.length !== 2 || topLevel[0] !== "rules" || topLevel[1] !== "version") {
    throw new Error(
      `policy document must have exactly { version, rules }; found { ${Object.keys(document).sort().join(", ")} }`,
    );
  }
  if (document.version !== 1) throw new Error(`policy document version must be 1; found ${String(document.version)}`);
  if (!isRecord(document.rules)) throw new TypeError("policy document.rules must be an object");

  return canonicalJson(document);
}

/**
 * `emitPolicy(policy)` → the canonical JSON text of the draft's `info` object.
 *
 * Text, not a live object, so the byte-level property is real: the same policy always emits the
 * same bytes, and `emitPolicy(parsePolicy(bytes))` returns those bytes unchanged. Parse it to
 * embed it: `JSON.parse(emitPolicy(policy))`.
 */
export function emitPolicy(policy: Policy): string {
  return serializePolicyDocument(policyDocument(policy));
}

/**
 * `parsePolicy(document)` → a validated `Policy`.
 *
 * Accepts the canonical text or the object form. The rules object is checked field by field
 * against `@paystage/policy` (the shared schema, not a copy), so a document that the schema
 * cannot express is rejected instead of being truncated to the fields this package knows.
 */
export function parsePolicy(document: string | PolicyDocument): Policy {
  let value: unknown = document;
  if (typeof document === "string") {
    try {
      value = JSON.parse(document);
    } catch (error) {
      throw new Error(`parsePolicy: document is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
    }
  }

  if (!isRecord(value)) throw new TypeError("parsePolicy: document must be an object");
  refuseUnknownFields(
    Object.keys(value).filter((field) => field !== "version" && field !== "rules"),
    "policy document",
  );
  if (value.version !== 1) throw new Error(`parsePolicy: version must be 1; found ${String(value.version)}`);
  if (!isRecord(value.rules)) throw new TypeError("parsePolicy: rules must be an object");
  if ("version" in value.rules) throw new Error("parsePolicy: version belongs at the document root, not inside rules");

  refuseUnknownFields(
    Object.keys(value.rules).filter((field) => !POLICY_FIELDS.has(field)),
    "policy document rules",
  );

  // The schema validates the flat @paystage/policy body. `rules` is that body, so the lift is
  // the inverse of `policyDocument` and nothing is renamed on the way through.
  return PolicySchema.parse({ ...value.rules, version: value.version }) as Policy;
}

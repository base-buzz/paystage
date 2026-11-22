import { describe, expect, it } from "vitest";
import { PolicySchema, parsePolicy as parseSharedPolicy, type Policy } from "@paystage/policy";
import {
  emitPolicy,
  parsePolicy,
  policyDocument,
  serializePolicyDocument,
  type PolicyDocument,
} from "../src/index.js";
import { listJson, readJson, readText } from "./helpers.js";

const policyFiles = listJson("policies");
const documentFiles = listJson("documents");

const policies = policyFiles.map((file) => ({
  file,
  policy: parseSharedPolicy(readJson("policies", file)) as Policy,
}));

describe("zero-loss policy round-trip", () => {
  it.each(policies)("parsePolicy(emitPolicy(policy)) deep-equals $file", ({ policy }) => {
    expect(parsePolicy(emitPolicy(policy))).toStrictEqual(policy);
  });

  it("covers every field @paystage/policy v1 accepts", () => {
    const full = policies.find(({ file }) => file === "full-policy.json");
    expect(full).toBeDefined();
    expect(Object.keys(full!.policy).sort()).toEqual(Object.keys(PolicySchema.shape).sort());
  });

  it("the full fixture really does exercise the optional fields", () => {
    const full = policies.find(({ file }) => file === "full-policy.json")!.policy as Record<string, unknown>;
    for (const field of [
      "daily_cap",
      "allow_uncapped_assets",
      "time_window",
      "require_human_above",
      "max_auth_validity_seconds",
      "allowed_spenders",
      "disallow_unlimited_approvals",
      "velocity",
      "agents",
    ]) {
      expect(full[field], `${field} must be present so its survival is proved`).toBeDefined();
    }
  });
});

describe("byte-for-byte document round-trip", () => {
  it.each(documentFiles)("%s is stored in canonical form", (file) => {
    const text = readText("documents", file);
    const document = JSON.parse(text) as PolicyDocument;
    expect(serializePolicyDocument(document)).toBe(text);
  });

  it.each(documentFiles)("emitPolicy(parsePolicy(document)) reproduces %s byte-for-byte", (file) => {
    const text = readText("documents", file);
    expect(emitPolicy(parsePolicy(text))).toBe(text);
  });

  it.each(documentFiles)("the re-emitted %s still parses to the same policy", (file) => {
    const text = readText("documents", file);
    expect(parsePolicy(emitPolicy(parsePolicy(text)))).toStrictEqual(parsePolicy(text));
  });

  it("emit is canonical: sorted keys and no incidental whitespace", () => {
    const policy = policies[0].policy;
    const text = emitPolicy(policy);
    expect(text).not.toMatch(/\s/);
    expect(text.startsWith('{"rules":')).toBe(true);
    expect(text.endsWith('"version":1}')).toBe(true);
    expect(text).toBe(serializePolicyDocument(policyDocument(policy)));
  });
});

describe("unrepresentable input is refused, never dropped", () => {
  const minimal = readJson("policies", "minimal-policy.json") as Record<string, unknown>;

  it("emitPolicy names a field outside the shared schema", () => {
    const withExtra = { ...minimal, not_a_policy_field: true };
    expect(() => emitPolicy(withExtra as unknown as Policy)).toThrow(
      /not in the @paystage\/policy v1 schema: "not_a_policy_field"/,
    );
  });

  it("parsePolicy names a rules field outside the shared schema", () => {
    const minimalRules = (readJson("documents", "minimal-policy.json") as PolicyDocument).rules;
    const document = { version: 1, rules: { ...minimalRules, not_a_policy_field: true } };
    expect(() => parsePolicy(document as unknown as PolicyDocument)).toThrow(
      /policy document rules contains field not in the @paystage\/policy v1 schema: "not_a_policy_field"/,
    );
  });

  it("emitPolicy refuses an undefined field instead of letting JSON drop it", () => {
    const withUndefined = { ...minimal, daily_cap: undefined };
    expect(() => emitPolicy(withUndefined as unknown as Policy)).toThrow(/undefined field "daily_cap"/);
  });

  it("parsePolicy rejects a document with an unknown top-level key", () => {
    const minimalRules = (readJson("documents", "minimal-policy.json") as PolicyDocument).rules;
    const document = { version: 1, rules: minimalRules, extra: true };
    expect(() => parsePolicy(document as unknown as PolicyDocument)).toThrow(
      /policy document contains field not in the @paystage\/policy v1 schema: "extra"/,
    );
  });

  it("parsePolicy rejects version inside rules", () => {
    const document = { version: 1, rules: { ...(minimal as object), version: 1 } };
    expect(() => parsePolicy(document as unknown as PolicyDocument)).toThrow(/version belongs at the document root/);
  });
});

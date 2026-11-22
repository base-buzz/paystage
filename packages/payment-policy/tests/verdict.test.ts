import { describe, expect, it } from "vitest";
import type { Policy } from "@paystage/policy";
import {
  VERDICTS,
  VERDICT_DECISIONS,
  evaluateVerdict,
  parsePolicy,
  type PolicyDocument,
  type Verdict,
} from "../src/index.js";
import { readJson, readText } from "./helpers.js";

const policy = parsePolicy(readText("documents", "minimal-policy.json")) as Policy;
const document = readJson("documents", "full-policy.json") as PolicyDocument;

const verdict = (file: string): unknown => readJson("verdicts", file);

describe("evaluateVerdict returns the four named verdicts", () => {
  it("uses the draft's three decision words verbatim, plus the package's untrusted outcome", () => {
    expect(VERDICT_DECISIONS).toEqual(["pay", "review", "do_not_pay"]);
    expect(VERDICTS).toEqual(["pay", "review", "do_not_pay", "unsupported"]);
  });

  it("'pay' — a valid pay verdict", () => {
    expect(evaluateVerdict(verdict("pay.json"), policy)).toBe<Verdict>("pay");
  });

  it("'review' — a valid review verdict naming a rule in the policy", () => {
    expect(evaluateVerdict(verdict("review.json"), policy)).toBe<Verdict>("review");
  });

  it("'do_not_pay' — a valid do_not_pay verdict naming a rule in the policy", () => {
    expect(evaluateVerdict(verdict("do-not-pay.json"), policy)).toBe<Verdict>("do_not_pay");
  });

  it("'unsupported' — a verdict naming a rule the policy does not contain", () => {
    expect(evaluateVerdict(verdict("unsupported-unknown-rule.json"), policy)).toBe<Verdict>("unsupported");
  });

  it("'unsupported' — a decision outside the draft's three words", () => {
    expect(evaluateVerdict(verdict("unsupported-unknown-decision.json"), policy)).toBe<Verdict>("unsupported");
  });

  it("never trusts a 'pay' whose rule id is absent from the policy", () => {
    expect(evaluateVerdict({ decision: "pay", rule_id: "not_a_rule" }, policy)).toBe("unsupported");
  });

  it("accepts a nested rule id through the document form", () => {
    expect(evaluateVerdict(verdict("review-nested-rule.json"), document)).toBe("review");
  });

  it("fails closed when a rule id is present but no policy was supplied", () => {
    expect(evaluateVerdict({ decision: "review", rule_id: "unknown_payee" })).toBe("unsupported");
    expect(evaluateVerdict({ decision: "do_not_pay" })).toBe("do_not_pay");
  });

  it("rejects malformed verdicts rather than throwing", () => {
    for (const bad of [null, undefined, "pay", 1, [], {}, { decision: 1 }, { decision: "PAY" }]) {
      expect(evaluateVerdict(bad, policy)).toBe("unsupported");
    }
  });

  it("rejects a malformed evaluator", () => {
    const decision = { decision: "pay", evaluator: { name: "paystage" } };
    expect(evaluateVerdict(decision, policy)).toBe("unsupported");
  });

  it("rejects a rule id that is not a dotted identifier", () => {
    expect(evaluateVerdict({ decision: "pay", rule_id: "not a rule" }, policy)).toBe("unsupported");
    expect(evaluateVerdict({ decision: "pay", rule_id: "" }, policy)).toBe("unsupported");
  });

  it("rejects a path that only matches a prefix of a real rule", () => {
    expect(evaluateVerdict({ decision: "pay", rule_id: "allowed_pay_to.nope" }, policy)).toBe("unsupported");
  });

  it("rejects an array slot as a rule id", () => {
    expect(evaluateVerdict({ decision: "pay", rule_id: "allowed_pay_to.0" }, policy)).toBe("unsupported");
  });

  it("fails closed when a document's rules is not an object", () => {
    const malformed = { version: 1, rules: null } as unknown as PolicyDocument;
    expect(evaluateVerdict({ decision: "pay", rule_id: "rules" }, malformed)).toBe("unsupported");
  });
});

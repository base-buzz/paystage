import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/explain-cli.js");
const dir = mkdtempSync(join(tmpdir(), "explain-cli-"));

const receipt = (over: Record<string, unknown> = {}) => ({
  v: 1,
  issuer: "paystage",
  issued_at: "2026-11-15T00:00:00.000Z",
  service: { name: "@paystage/hosted", version: "2026.11.12" },
  verdict: {
    decision: "do_not_pay",
    reasons: ["amount 1 USDC exceeds max_amount 0.05 USDC"],
    summary: "Decision: do_not_pay.",
  },
  ...over,
});

function run(content: unknown): { status: number; out: string } {
  const file = join(dir, `r${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(content));
  try {
    return { status: 0, out: execFileSync("node", [CLI, file], { encoding: "utf8", stdio: "pipe" }) };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("paystage-explain", () => {
  it("turns the amount rule into a sentence a person can act on", () => {
    const r = run(receipt());
    expect(r.out).toContain("It asks for 1 USDC, and the policy allows at most 0.05 USDC.");
    expect(r.out).toContain("Decision: do_not_pay");
  });

  it("says plainly when a receipt cannot be trusted", () => {
    const r = run(receipt({ signed: false, signature: undefined }));
    expect(r.out).toMatch(/UNSIGNED|CANNOT BE TRUSTED/);
  });

  it("translates each rule it knows and quotes the ones it does not", () => {
    const r = run(
      receipt({
        verdict: {
          decision: "do_not_pay",
          reasons: ["known drainer", "some future rule nobody has written yet"],
          summary: "",
        },
      }),
    );
    expect(r.out).toContain("known-drainer list");
    // Unknown reasons are quoted, never paraphrased: guessing at a refusal is worse than repeating it.
    expect(r.out).toContain("some future rule nobody has written yet");
  });
});

describe("paystage-explain remedies", () => {
  it("tells the holder what to do about an over-cap refusal, without suggesting a bypass", () => {
    const r = run(receipt());
    expect(r.out).toContain("→");
    expect(r.out).toMatch(/raise max_amount above 1 USDC|do not pay/);
    expect(r.out).not.toMatch(/disable|bypass|ignore the policy/i);
  });

  it("offers no remedy for a reason it does not understand", () => {
    const r = run(receipt({ verdict: { decision: "do_not_pay", reasons: ["some future rule"], summary: "" } }));
    expect(r.out).toContain("some future rule");
    expect(r.out).not.toContain("→");
  });
});

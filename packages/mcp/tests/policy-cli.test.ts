import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../dist/policy-cli.js");
const dir = mkdtempSync(join(tmpdir(), "policy-cli-"));

const VALID = {
  version: 1,
  max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
  allowed_assets: [
    { symbol: "USDC", decimals: 6, address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", network: "eip155:8453" },
  ],
  allowed_networks: ["eip155:8453"],
  allowed_pay_to: ["0xc64a71e150cd21ebc4b12695850bed6b067743bc"],
  max_timeout_seconds: 300,
  unknown_payee: "deny",
};

function write(name: string, content: unknown): string {
  const path = join(dir, name);
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content));
  return path;
}

/** Run the CLI and capture what a user would see, without throwing on a non-zero exit. */
function run(file: string): { status: number; out: string } {
  try {
    const out = execFileSync("node", [CLI, "check", file], { encoding: "utf8", stdio: "pipe" });
    return { status: 0, out };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? 1, out: `${e.stdout ?? ""}${e.stderr ?? ""}` };
  }
}

describe("paystage-policy check", () => {
  it("exits 0 on a valid policy and summarises it", () => {
    const r = run(write("valid.json", VALID));
    expect(r.status).toBe(0);
    expect(r.out).toContain("valid");
    expect(r.out).toContain("max_amount 0.05");
  });

  it("exits 1 on an invalid policy and names the field", () => {
    const r = run(write("bad-value.json", { ...VALID, max_amount: { value: "lots", asset: "USDC", decimals: 6 } }));
    expect(r.status).toBe(1);
    expect(r.out).toContain("max_amount.value");
  });

  it("exits 1 on malformed JSON, and says so rather than crashing", () => {
    const r = run(write("broken.json", "{ not json"));
    expect(r.status).toBe(1);
    expect(r.out.toLowerCase()).toContain("not valid json");
  });

  it("exits 2 when the file does not exist", () => {
    const r = run(join(dir, "missing.json"));
    expect(r.status).toBe(2);
    expect(r.out.toLowerCase()).toContain("cannot read");
  });
});

import { describe, expect, it } from "vitest";
import { clientFromHeaders } from "../src/telemetry.js";

/**
 * #52. Attribution answers "which installed SDK build is calling". The rules that matter are what it refuses to
 * record: an arbitrary user agent is not ours to store, and a header that identifies a person must not be parsed into
 * a field.
 */

function headers(map: Record<string, string>) {
  return { header: (name: string) => map[name.toLowerCase()] };
}

describe("client attribution", () => {
  it("reads the explicit header", () => {
    expect(clientFromHeaders(headers({ "x-paystage-client": "@paystage/mcp/0.8.10" }))).toEqual({
      package: "@paystage/mcp",
      version: "0.8.10",
    });
  });

  it("falls back to a user agent that carries a paystage package", () => {
    expect(
      clientFromHeaders(headers({ "user-agent": "node/24 @paystage/x402-guard/0.4.7" })),
    ).toEqual({ package: "@paystage/x402-guard", version: "0.4.7" });
  });

  it("accepts a prerelease version", () => {
    expect(clientFromHeaders(headers({ "x-paystage-client": "@paystage/mcp/0.9.0-canary.12" }))).toEqual({
      package: "@paystage/mcp",
      version: "0.9.0-canary.12",
    });
  });

  it("records nothing for a user agent that is not ours", () => {
    expect(
      clientFromHeaders(headers({ "user-agent": "Mozilla/5.0 (Macintosh) curl/8.4.0" })),
    ).toEqual({ package: null, version: null });
  });

  it("records nothing when no header is sent", () => {
    expect(clientFromHeaders(headers({}))).toEqual({ package: null, version: null });
  });
});

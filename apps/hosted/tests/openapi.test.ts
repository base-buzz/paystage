/**
 * The OpenAPI document is a contract, and these tests stop the three ways it broke before:
 *
 *  - it must parse as OpenAPI 3.1 with `info` and `paths`, not a bespoke near-miss;
 *  - every public route `apps/hosted/src/app.ts` serves must appear in it — asserted by running the real parity
 *    checker, so the test exercises the same derivation CI uses rather than a second copy;
 *  - the three paid operations must keep `x-payment-info` and a declared 402, because those are the fields x402scan
 *    reads to decide an operation is payable. A document that still lists the path but loses those fields looks fine
 *    to a human and disappears from the directory.
 */
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { OPENAPI_DOCUMENT } from "../src/routes/openapi.js";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
/**
 * A loose view of an operation: the document's literal type is deeply inferred, and the test is about fields the
 * object actually has, not about re-declaring the whole OpenAPI specification.
 */
interface Operation {
  summary?: string;
  "x-payment-info"?: Record<string, unknown>;
  responses?: Record<
    string,
    { headers?: Record<string, unknown>; content?: Record<string, { schema?: unknown }> }
  >;
}
const PATHS = OPENAPI_DOCUMENT.paths as unknown as Record<string, Record<string, Operation | undefined>>;
const PAID_OPERATIONS = [
  "/v1/evaluate_mcp_payment",
  "/v1/paid/evaluate_mcp_payment",
  "/v1/evaluate_outstanding_auths",
];

describe("GET /openapi.json", () => {
  it("is an OpenAPI 3.1 document with info and paths", () => {
    expect(OPENAPI_DOCUMENT.openapi).toMatch(/^3\.1\./);
    expect(OPENAPI_DOCUMENT.info).toMatchObject({
      title: expect.any(String),
      version: expect.any(String),
      description: expect.any(String),
    });
    expect(Object.keys(OPENAPI_DOCUMENT.paths).length).toBeGreaterThan(0);

    for (const [path, item] of Object.entries(PATHS)) {
      expect(path.startsWith("/")).toBe(true);
      expect(item).toBeTypeOf("object");
    }
    // The document must survive the JSON round-trip the route performs.
    expect(JSON.parse(JSON.stringify(OPENAPI_DOCUMENT))).toEqual(OPENAPI_DOCUMENT);
  });

  it("includes every public route the app serves, as checked by the parity script", () => {
    const output = execFileSync(process.execPath, [join(REPO_ROOT, "scripts/check-openapi-parity.mjs")], {
      cwd: REPO_ROOT,
      encoding: "utf8",
    });
    expect(output).toMatch(/match the document's/);
  });

  it("keeps x-payment-info and a declared 402 on every paid operation", () => {
    for (const path of PAID_OPERATIONS) {
      const operation = PATHS[path]?.post;
      expect(operation, `${path} has no POST operation`).toBeDefined();
      expect(operation?.["x-payment-info"]).toMatchObject({
        protocols: ["x402"],
        network: expect.any(String),
        price: { mode: "fixed", currency: "USD", amount: expect.any(String) },
      });
      expect(operation?.responses?.["402"]).toBeDefined();
      expect(operation?.responses?.["402"]).toHaveProperty("headers.Payment-Required");
    }
  });

  it("describes /supported with the protocol's SupportedResponse shape", () => {
    const schema = PATHS["/supported"]?.get?.responses?.["200"]?.content?.["application/json"]?.schema;
    expect(schema).toMatchObject({
      type: "object",
      required: expect.arrayContaining(["kinds", "extensions", "signers"]),
    });
  });
});

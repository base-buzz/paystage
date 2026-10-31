import { describe, it, expect } from "vitest";
import { toolFromPath } from "../src/app.js";

describe("toolFromPath noise filtering", () => {
  it("returns null for robots.txt", () => {
    expect(toolFromPath("/robots.txt")).toBeNull();
  });
  it("returns null for sitemap.xml", () => {
    expect(toolFromPath("/sitemap.xml")).toBeNull();
  });
  it("returns null for favicon.ico", () => {
    expect(toolFromPath("/favicon.ico")).toBeNull();
  });
  it("returns null for well-known paths", () => {
    expect(toolFromPath("/.well-known/security.txt")).toBeNull();
  });
  it("returns null for static assets", () => {
    expect(toolFromPath("/static/app.js")).toBeNull();
  });
  it("returns null for root", () => {
    expect(toolFromPath("/")).toBeNull();
  });
  it("returns null for public status", () => {
    expect(toolFromPath("/v1/public/status")).toBeNull();
  });
  it("returns tool for evaluate_mcp_payment", () => {
    expect(toolFromPath("/v1/evaluate_mcp_payment")).toBe(
      "evaluate_mcp_payment",
    );
  });
  it("returns tool for evaluate_outstanding_auths", () => {
    expect(toolFromPath("/v1/evaluate_outstanding_auths")).toBe(
      "evaluate_outstanding_auths",
    );
  });
  it("returns null for unknown /v1 path", () => {
    expect(toolFromPath("/v1/unknown_tool")).toBeNull();
  });
});

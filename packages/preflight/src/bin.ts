#!/usr/bin/env node
/**
 * The bin npx chooses for this package: npm runs the bin whose name matches the package name when a
 * package declares several, so `npx -y @paystage/preflight <arg>` lands here.
 *
 * It dispatches rather than replacing: `demo` prints the offline demo, and **no arguments still starts the MCP
 * server**, which is what bare `npx -y @paystage/preflight` did before this bin existed. Making the bare command
 * print a demo instead would break every directory entry and MCP config that launches the package by name without
 * an argument — the server would answer EOF and the client would report a crash.
 */
const [command] = process.argv.slice(2);

if (command === "demo") {
  const { renderDemo } = await import("./demo.js");
  console.log(renderDemo());
  process.exit(0);
}

if (command === "--help" || command === "-h" || command === "help") {
  console.log(
    [
      "@paystage/preflight — x402 spend policy, enforced before the wallet signs",
      "",
      "  npx -y @paystage/preflight demo     evaluate four bundled challenges offline; no keys, no spend",
      "  npx -y @paystage/preflight          start the MCP server (needs @modelcontextprotocol/server)",
      "  npx -y @paystage/preflight --help   this message",
      "",
      "In code: import { evaluatePayment } from \"@paystage/preflight\".",
    ].join("\n"),
  );
  process.exit(0);
}

/** No argument, or anything unrecognised: the MCP server, which handles its own missing-peer message. */
await import("./cli.js");

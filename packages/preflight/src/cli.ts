#!/usr/bin/env node
/**
 * The MCP server entry point. Kept in its own bin so the evaluator stays a pure function.
 *
 * `@modelcontextprotocol/server` is an optional peer dependency: installing `@paystage/preflight` to
 * call `evaluatePayment` should not install an MCP server. This file is the one place that needs it,
 * so it fails here — with the command to fix it — rather than at import time for everyone.
 */
try {
  const { startServer } = await import("./server.js");
  await startServer();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("@modelcontextprotocol/server")) {
    console.error(
      "This bin needs the MCP SDK, which is an optional peer of @paystage/preflight:\n" +
        "  npm install @modelcontextprotocol/server\n" +
        "The evaluator itself (evaluatePayment) does not need it.",
    );
  } else {
    console.error(error);
  }
  process.exit(1);
}

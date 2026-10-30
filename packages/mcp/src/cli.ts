#!/usr/bin/env node
import { startServer } from "./server.js";

startServer().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`paystage-mcp fatal: ${message}\n`);
  process.exit(1);
});

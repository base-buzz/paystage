#!/usr/bin/env node
import { startServer } from "./server.js";

startServer().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`paystage-trade-preflight fatal: ${message}\n`);
  process.exit(1);
});

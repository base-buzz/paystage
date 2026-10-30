#!/usr/bin/env node
import { startServer } from "./server.js";

startServer().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

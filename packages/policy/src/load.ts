import { readFile } from "node:fs/promises";
import type { Policy } from "./types.js";
import { PolicySchema } from "./schema.js";

export function parsePolicy(input: unknown): Policy {
  return PolicySchema.parse(input) as Policy;
}

export async function loadPolicy(path: string): Promise<Policy> {
  const raw = await readFile(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  return parsePolicy(parsed);
}

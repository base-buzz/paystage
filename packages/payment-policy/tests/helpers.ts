import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURES = fileURLToPath(new URL("../fixtures", import.meta.url));

export function fixturePath(...parts: string[]): string {
  return join(FIXTURES, ...parts);
}

export function readText(...parts: string[]): string {
  return readFileSync(fixturePath(...parts), "utf8");
}

export function readJson(...parts: string[]): unknown {
  return JSON.parse(readText(...parts));
}

export function listJson(...parts: string[]): string[] {
  return readdirSync(fixturePath(...parts))
    .filter((file) => file.endsWith(".json"))
    .sort();
}

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * The guard for #181, not the fix: the evaluator was made zero-dependency once, and the way it
 * comes back is a single `import { z } from "zod"` added for one convenient check. That would
 * pass every behavioural test in this package, so the dependency itself is asserted here.
 *
 * `@paystage/preflight`'s runtime dependency has to stay `@paystage/policy` and nothing else:
 * that is what makes `npm i @paystage/preflight` a single installable evaluator.
 */
const PACKAGE = fileURLToPath(new URL("..", import.meta.url));

function sourceFiles(directory: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(directory)) {
    const path = join(directory, entry);
    if (statSync(path).isDirectory()) files.push(...sourceFiles(path));
    else if (path.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("no zod in the evaluator", () => {
  it("declares @paystage/policy as its only runtime dependency", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
    };
    expect(manifest.dependencies).toEqual({ "@paystage/policy": expect.any(String) });
  });

  it("imports zod nowhere in src/", () => {
    const offenders = sourceFiles(join(PACKAGE, "src")).filter((path) =>
      /from\s+["']zod["']|require\(["']zod["']\)/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

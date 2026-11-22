import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * #181's whole point is that this package has no runtime dependency. The parser is the only code
 * here that could grow one back, and it would do so with a single convenient import, so the
 * dependency is asserted rather than remembered.
 *
 * zod stays declared as a **devDependency**: `tests/differential.test.ts` runs the real zod
 * schema beside the hand-written guards, and that oracle is the reason the swap is safe.
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

describe("#181: the policy evaluator is dependency-free", () => {
  it("declares no runtime dependencies", () => {
    const manifest = JSON.parse(readFileSync(join(PACKAGE, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    expect(manifest.dependencies ?? {}).toEqual({});
    expect(manifest.devDependencies?.zod).toBeDefined();
  });

  it("imports zod nowhere in src/", () => {
    const offenders = sourceFiles(join(PACKAGE, "src")).filter((path) =>
      /from\s+["']zod["']|require\(["']zod["']\)/.test(readFileSync(path, "utf8")),
    );
    expect(offenders).toEqual([]);
  });
});

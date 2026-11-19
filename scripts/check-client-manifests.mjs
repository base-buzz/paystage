#!/usr/bin/env node
/**
 * The four client manifests must exist, parse, and point at the hosted endpoint.
 *
 * One repository serving four marketplaces is cheap only while the four files agree. They are hand-written JSON in four
 * different shapes, none of them covered by the tests, so a rename of the endpoint or a dropped key would be found by
 * whichever marketplace happened to validate it — possibly weeks later.
 *
 *   node scripts/check-client-manifests.mjs
 *
 * Exit 0 all four present and pointing at the endpoint · 10 one is missing, unparseable or stale.
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT = "https://api.paystage.xyz/mcp";

const MANIFESTS = [
  { file: ".claude-plugin/plugin.json", needs: (d) => typeof d.name === "string" && typeof d.version === "string" },
  { file: ".cursor-plugin/plugin.json", needs: (d) => typeof d.name === "string" && typeof d.version === "string" },
  { file: "gemini-extension.json", needs: (d) => d.mcpServers !== undefined },
  { file: "mcp.json", needs: (d) => d.mcpServers !== undefined },
];

const problems = [];
for (const { file, needs } of MANIFESTS) {
  const path = join(ROOT, file);
  if (!existsSync(path)) {
    problems.push(`${file}: missing`);
    continue;
  }
  let doc;
  try {
    doc = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    problems.push(`${file}: not valid JSON — ${String(error).slice(0, 60)}`);
    continue;
  }
  if (!JSON.stringify(doc).includes(ENDPOINT)) problems.push(`${file}: does not name ${ENDPOINT}`);
  if (!needs(doc)) problems.push(`${file}: missing a required field for its marketplace`);
}

for (const p of problems) console.error(`  FAIL ${p}`);
console.log(problems.length === 0 ? `client-manifests: ${MANIFESTS.length} manifests, all name ${ENDPOINT}` : `client-manifests: ${problems.length} problem(s)`);
process.exit(problems.length === 0 ? 0 : 10);

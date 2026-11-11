import { PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";

export const dynamic = "force-static";

/**
 * `/llms-full.txt` — the long form: schemas, verdict semantics, policy shape,
 * access surface, verification. Generated from the same manifest as `/llms.txt`
 * and `/.well-known/paystage.json`, so the three cannot disagree.
 */
export function GET() {
  const m = PAYSTAGE_MANIFEST;

  const tools = m.tools
    .map(
      (tool) => `### \`${tool.name}\` — ${tool.package}@${m.package_versions[tool.package]}

${tool.summary}.

- input: ${tool.input}
- output: ${tool.output}
${tool.decisions.length > 0 ? `- decisions: ${tool.decisions.map((d) => "`" + d + "`").join(" | ")}\n` : ""}- network: ${tool.network}
`,
    )
    .join("\n");

  const body = `# PayStage — full reference

> ${m.description}

PayStage is a **read-only seatbelt outside the wallet**. It evaluates a proposed
payment against a policy you write and returns a decision. It holds no keys,
signs nothing, and never moves funds. It is not financial advice.

## Verdicts

Payment tools return one of \`pay\`, \`review\`, \`do_not_pay\`. Trade tools return
\`allow\`, \`review\`, \`do_not_trade\`. Every verdict carries a \`reasons[]\` array;
each entry names the rule that fired, so a denial can be explained without
re-running the evaluation.

- \`pay\` / \`allow\` — proceed.
- \`review\` — a human should look; the policy asked for one (for example an
  unknown payee).
- \`do_not_pay\` / \`do_not_trade\` — blocked. Deny-listed payees, over-cap
  amounts, disallowed networks and failing velocity checks land here.

## Tools

${tools}
## Policy

A single JSON document, read from the tool's \`policy_path\` argument, else
\`PAYSTAGE_POLICY_PATH\`, else \`./policy.json\`. It is never written to.

\`\`\`json
{
  "version": 1,
  "max_amount": { "value": "1.00", "asset": "USDC", "decimals": 6 },
  "allowed_pay_to": ["0x209693Bc6afc0C5328bA36FaF03C514EF312287C"],
  "allowed_networks": ["eip155:8453", "eip155:84532"],
  "unknown_payee": "review"
}
\`\`\`

The known-drainer list is a hard deny that runs before \`unknown_payee\`. It is
curated and small: every entry has a public citation and a retrieval date in
\`packages/preflight/KNOWN_DRAINERS.md\`. Precision over recall — a false positive
blocks a legitimate payment.

## Access surface

${m.access.map((row) => `- **${row.kind}** — ${row.detail}`).join("\n")}

No shell, no \`eval\`, no telemetry, no key custody, no writes.

## Runtime dependencies

${m.runtime_dependencies.map((d) => `- \`${d}\``).join("\n")}

## Hosted API

- Mainnet: ${m.hosted_api.mainnet} (${m.networks.mainnet}), $0.002 USDC per call.
- Sepolia: ${m.hosted_api.sepolia} (${m.networks.sepolia}), $0.002 USDC per call.

The hosted API runs the same evaluation code. Use it when you cannot run a local
process; run locally when you can, because it removes the network hop before a
payment.

## Install and verify

\`\`\`sh
npx -y -p @paystage/mcp paystage-mcp
npm audit signatures
\`\`\`

Provenance is published from GitHub Actions via npm Trusted Publishing (OIDC).
Source, tests and CI are public at ${m.repository}. Security policy and the full
access table: ${m.repository}/blob/main/SECURITY.md.

## Machine surfaces

- \`/llms.txt\` — short map (this file's summary).
- \`/llms-full.txt\` — this file.
- \`/.well-known/paystage.json\` — JSON manifest with versions and access facts.
- MCP Registry: ${m.machine_surfaces.mcp_registry}
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

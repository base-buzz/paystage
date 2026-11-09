import { PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";

export const dynamic = "force-static";

/**
 * `/llms.txt` — the short map an agent reads first.
 *
 * Deliberately terse: what this is, the tools with exact names, how to install,
 * where the hosted API lives. Anything longer belongs in `/llms-full.txt`.
 */
export function GET() {
  const m = PAYSTAGE_MANIFEST;
  const toolLines = m.tools
    .map((tool) => `- \`${tool.name}\` — ${tool.summary} (${tool.package})`)
    .join("\n");

  const body = `# PayStage

> ${m.description}

Not financial advice. The HIP-3/trade tool is a local policy gate: it evaluates an
order against your policy and never places one.

## Tools (available now)

${toolLines}

## Install

\`\`\`
npx -y @paystage/mcp
\`\`\`

Each tool ships in its own package where one exists
(${m.packages.map((p) => "`" + p + "`").join(", ")}); the umbrella bundles all five for
callers that want the whole gate.

## Hosted pay-per-call API

- Base mainnet: https://api.paystage.xyz — ${m.networks.mainnet}
- Base Sepolia: https://sepolia.api.paystage.xyz — ${m.networks.sepolia}
- Price: $0.002 USDC per call on both networks.

## Verify it yourself

\`\`\`
node apps/hosted/scripts/conformance.mjs
\`\`\`

Checks the published surfaces against reality: manifest shape, five tools listed,
machine surfaces distinct, health and Server-Timing on both networks, receipt key
endpoint, unpaid evaluation challenge-only, malformed input fails closed. Read-only,
no payment, no key. Runs daily in CI; history at https://paystage.xyz.

## Machine-readable

- \`/.well-known/paystage.json\` — manifest: tools, verdicts, dependencies, env
  vars, endpoints, \`holds_keys\`, provenance and audit links.
- \`/llms-full.txt\` — tool schemas, verdict semantics, policy schema, access surface.

## Access surface (what it touches)

${m.access.map((row) => `- ${row.kind}: ${row.detail}`).join("\n")}

## Links

- Website: https://paystage.xyz
- GitHub: https://github.com/base-buzz/paystage
- Security policy: https://github.com/base-buzz/paystage/blob/main/SECURITY.md
- Drainer list + sources: https://github.com/base-buzz/paystage/blob/main/packages/preflight/KNOWN_DRAINERS.md
- Changelog: https://github.com/base-buzz/paystage/blob/main/CHANGELOG.md
- npm: https://www.npmjs.com/package/@paystage/mcp
- MCP Registry: https://registry.modelcontextprotocol.io (xyz.paystage/mcp)
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

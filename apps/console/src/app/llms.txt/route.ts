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

## Per-agent budgets

A policy may declare \`agents\`, giving each agent its own ceiling, payee list and
network list as a **narrowing** overlay on the global rules. When it does, callers must
pass \`agent_id\`:

\`\`\`json
{ "payment_required": { ... }, "policy": { ... }, "agent_id": "reader" }
\`\`\`

Missing or unknown \`agent_id\` is \`do_not_pay\` — never a fallback to the loosest rules.
Overrides that widen (raise a ceiling, add a payee) are rejected when the policy loads.

## Verify a receipt

\`\`\`
npx -y -p @paystage/mcp paystage-verify receipt.json
\`\`\`

Checks the ECDSA signature against the key published at
${"`" + m.networks.mainnet + "`"}/v1/public/receipt-key.json. Exit codes: 0 valid,
1 invalid, 2 unsigned, 3 unverifiable. "Could not check" is distinct from "forged" on
purpose.

## Install

\`\`\`
npx -y -p @paystage/mcp paystage-mcp
\`\`\`

Each tool ships in its own package where one exists
(${m.packages.map((p) => "`" + p + "`").join(", ")}); the umbrella bundles all nine for
callers that want the whole gate.

## Hosted pay-per-call API

- Base mainnet: https://api.paystage.xyz — ${m.networks.mainnet}
- Base Sepolia: https://sepolia.api.paystage.xyz — ${m.networks.sepolia}
- Price: $0.002 USDC per call on both networks.

## Verify it yourself

\`\`\`
node apps/hosted/scripts/conformance.mjs
\`\`\`

Checks the published surfaces against reality: manifest shape, nine tools listed,
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
${m.socials.map((social) => `- ${social.label}: ${social.url}`).join("\n")}
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

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

A single JSON document, supplied either **inline** as the \`policy\` argument or as a
path in \`policy_path\`; when neither is given it falls back to \`PAYSTAGE_POLICY_PATH\`,
then \`./policy.json\`. It is never written to. Inline is the right choice for an agent
that already knows its budget; a path is right when several calls share one file.

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
blocks a legitimate payment. Non-receivable sinks (the burn address, the zero
address) are refused too, with their own reason, and are deliberately not listed
as drainers.

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

Then one call, over stdio. Two JSON-RPC lines are enough — this is the whole
protocol surface you need:

\`\`\`jsonc
// request
{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"evaluate_mcp_payment","arguments":{
  "payment_required":{"x402Version":2,"accepts":[{"scheme":"exact","network":"eip155:8453",
    "amount":"12500000","asset":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    "payTo":"0x6160a0d8a3a1f8b0c4e2d1f7b3a9c6e5d4f23757","maxTimeoutSeconds":300}]},
  "policy":{"version":1,"max_amount":{"value":"0.05","asset":"USDC","decimals":6},
    "allowed_assets":[{"symbol":"USDC","decimals":6,
      "address":"0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913","network":"eip155:8453"}],
    "allowed_networks":["eip155:8453"],
    "allowed_pay_to":["0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE"],
    "max_timeout_seconds":300,"unknown_payee":"deny"}}}}

// response (the verdict is JSON inside content[0].text)
{"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":
  "{\"decision\":\"do_not_pay\",\"reasons\":[\"amount 12.5 USDC exceeds max_amount 0.05 USDC\"]}"}]}}
\`\`\`

The same call against the hosted API, if you would rather not run a process:

\`\`\`sh
curl -s -X POST ${m.hosted_api.mainnet}/v1/evaluate_mcp_payment -H 'content-type: application/json' \\
  -d '{"payment_required":{...},"policy":{...}}'
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

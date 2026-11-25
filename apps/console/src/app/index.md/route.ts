import { PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";

export const dynamic = "force-static";

/**
 * `/index.md` and the `Accept: text/markdown` rendering of `/`.
 *
 * The facts below (tool names and count, install command, endpoints, price, access surface) come from
 * `PAYSTAGE_MANIFEST`, the same object the HTML page renders from, so they cannot drift from it. The
 * short prose is a hand-maintained summary of the landing page rather than generated from `page.tsx`:
 * extracting copy from JSX would couple a machine route to the visual component and make both harder
 * to change. Keep this summary in step when the hero copy changes; the facts that safety claims rest
 * on are the manifest's.
 */
export function GET() {
  const m = PAYSTAGE_MANIFEST;
  const tools = m.tools.map((tool) => `- \`${tool.name}\` — ${tool.summary}`).join("\n");

  const body = `# PayStage

> ${m.description}

Stop the payment before it is signed. PayStage is a read-only seatbelt outside the wallet: it
evaluates a proposed x402 payment against your local policy and returns **pay**, **review** or
**do_not_pay** — with the rule that fired. It holds no keys, never signs, and never moves funds.

## Tools (${m.tools.length})

${tools}

## Install

\`\`\`sh
npx -y -p @paystage/mcp paystage-mcp
\`\`\`

## Endpoints

- MCP (streamable HTTP): https://api.paystage.xyz/mcp
- Hosted API: ${m.hosted_api.mainnet} (${m.networks.mainnet}) and ${m.hosted_api.sepolia} (${m.networks.sepolia})
- Price: $${m.hosted_api.price_usdc_per_call} USDC per call; the packages are MIT licensed and run locally.

## What it touches

${m.access.map((row) => `- ${row.kind}: ${row.detail}`).join("\n")}

## More

- /llms.txt — short map for agents
- /llms-full.txt — schemas, verdict semantics, policy shape
- /.well-known/paystage.json — machine manifest
- https://github.com/base-buzz/paystage — source, tests and CI
`;

  return new Response(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
      vary: "Accept",
    },
  });
}

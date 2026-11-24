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

## Verdict vocabulary

Three states. Other gates use their own three words for the same intent, so if you run more than one:

  pay         within policy, sign and send       (ELIGIBLE / GO / authorize)
  review      a human should look first         (STEP_UP / HOLD / challenge)
  do_not_pay  refused, with the rule that fired  (DENY / STOP / deny)

"review" is a policy instruction rather than an oversight: onReview decides whether it pays or refuses.

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
(${m.packages.map((p) => "`" + p + "`").join(", ")}); the umbrella bundles all
${m.tools.length} for callers that want the whole gate.

## Hosted pay-per-call API

- Base mainnet: https://api.paystage.xyz — ${m.networks.mainnet}
- Base Sepolia: https://sepolia.api.paystage.xyz — ${m.networks.sepolia}
- Price: $0.002 USDC per call on both networks.
- **MCP endpoint (canonical): \`https://api.paystage.xyz/mcp\`** — ten tools, no authentication, one remote server. The
  registry carries older entries under other namespaces (\`xyz.paystage/*\`, older \`io.github.base-buzz\` versions, some
  with no remote endpoint); this URL is the one to call, and the canonical registry entry is
  \`io.github.base-buzz/mcp\` at the newest version.

## Verify it yourself

\`\`\`
node apps/hosted/scripts/conformance.mjs
\`\`\`

Checks the published surfaces against reality: manifest shape, every tool listed,
machine surfaces distinct, health and Server-Timing on both networks, receipt key
endpoint, unpaid evaluation challenge-only, malformed input fails closed. Read-only,
no payment, no key. Runs daily in CI; history at https://paystage.xyz.

## Questions an agent asks

| question | call |
|---|---|
| should this x402 payment be signed? | \`evaluate_mcp_payment\` |
| what is this 402 header asking for? | \`decode_payment_required\` |
| which approvals could drain this wallet? | \`list_outstanding_auths\` → \`evaluate_outstanding_auths\` |
| is this spend rate abnormal? | \`evaluate_velocity\` |
| can I trust this receipt? | \`verify_receipt\` |
| is my policy valid? | \`validate_policy\` |
| I need testnet USDC | \`request_testnet_funds\` |
| why did it refuse? | the \`reasons\` array, one sentence per rule |

## Machine-readable

- \`/.well-known/paystage.json\` — manifest: tools, verdicts, dependencies, env
  vars, endpoints, \`holds_keys\`, provenance and audit links.
- \`/llms-full.txt\` — tool schemas, verdict semantics, policy schema, access surface.
- \`/openapi.json\` — the OpenAPI 3.1 description of every hosted endpoint.
- \`/health\`, \`/v1/public/status\` — liveness and the operational flags (failed settlements, facilitator errors).
- \`/v1/public/chain.json\` — the on-chain settlement summary.
- \`GET /runs/:id\` — one evidence bundle (events.jsonl, proof, receipt, summary.md), plus
  \`?format=json\` for all four as JSON. The id is the bundle_id returned by an evaluation.
- \`GET /wallets/:address\` — stored observations about one payee, with the source and read date
  beside each one. Returns labels, observations and disagreements; no score and no combined verdict.
- \`POST /v1/guard-verdict\` — turn a preflight verdict into a receipt-shaped response.
- \`/v1/public/cadence.json\` — release and check history. Read \`current\` for "did the last run pass" and
  \`all_recent_passing\` for the whole window; \`all_passing\` is the window and is kept only for one release under
  its old name.

## Access surface (what it touches)

${m.access.map((row) => `- ${row.kind}: ${row.detail}`).join("\n")}

## 中文（简体）— 在签名之前，判断这笔支付该不该付

PayStage 是面向 AI 智能体（AI agent）的 **x402 支付安全层**：在钱包签名之前，按你写的本地策略
评估待签名的支付，返回 **pay**、**review** 或 **do_not_pay**，并给出触发的那条规则。只读，不持私钥，
不签名，不移动资金。

- **查什么**：收款地址（是否在已知盗币名单）、金额上限、允许的链与资产、授权（ERC-20 / Permit2 /
  EIP-3009）、消费速率（突发、尖峰、失控节奏）、HIP-3 / trade.xyz 下单范围。
- **给谁用**：让智能体自动付钱的开发者（x402 API、MCP 服务）、做钱包安全与风控的团队、需要给
  子智能体设预算上限的编排框架（LangChain、ElizaOS、AgentKit、Vercel AI SDK）。
- **怎么装**：\`npx -y -p @paystage/mcp paystage-mcp\`（MCP 服务），或直接用托管 API
  \`https://api.paystage.xyz\`（Base 主网，每次调用 $0.002 USDC，走 x402）。
- **测网免费**：\`POST https://sepolia.api.paystage.xyz/faucet\` 领取 0.5 Base Sepolia USDC
  （每个地址每 24 小时一次），或调用 MCP 工具 \`request_testnet_funds\`。
- **中文页面**：https://paystage.xyz/zh · 中文 README：
  https://github.com/base-buzz/paystage/blob/main/README.zh-CN.md · 术语表：https://paystage.xyz/glossary

关键词（供检索）：x402、支付安全、支付前校验、智能体支付、agent 支付拦截、盗币地址检查、钱包授权检查、
消费限额、MCP 工具、USDC、Base。

## Links

- Website: https://paystage.xyz
${m.socials.map((social) => `- ${social.label}: ${social.url}`).join("\n")}
- Security policy: https://github.com/base-buzz/paystage/blob/main/SECURITY.md
- Drainer list + sources: https://github.com/base-buzz/paystage/blob/main/packages/preflight/KNOWN_DRAINERS.md
- Changelog: https://github.com/base-buzz/paystage/blob/main/CHANGELOG.md
- npm: https://www.npmjs.com/package/@paystage/mcp
- MCP Registry: https://registry.modelcontextprotocol.io (io.github.base-buzz/x402-payment-safety)
`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

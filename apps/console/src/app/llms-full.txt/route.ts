import { PAYSTAGE_MANIFEST } from "@/lib/agent-manifest";
// The policy shown below is the file `scripts/check-examples.mjs` parses, not a shortened copy: the
// previous inline sketch omitted required fields and failed our own parsePolicy with five errors.
import policyExample from "../../../../../examples/policies/strict.json";

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
${JSON.stringify(policyExample, null, 2)}
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

${m.runtime_dependencies_statement} (the \`@paystage/*\` entries are ours; the rest are third-party).

${m.runtime_dependencies.map((d) => `- \`${d}\``).join("\n")}

## Hosted API

- Mainnet: ${m.hosted_api.mainnet} (${m.networks.mainnet}), $0.002 USDC per call.
- Sepolia: ${m.hosted_api.sepolia} (${m.networks.sepolia}), $0.002 USDC per call.

An evaluation returns a \`bundle_id\` naming its evidence bundle. Fetch the record at
\`GET /runs/:id\` (all four artefacts as markdown), \`GET /runs/:id?format=json\` (structured),
or one artefact at a time with \`?format=events|proof|receipt|summary\`. The bundle is
content-addressed: the id is the SHA-256 of the canonical inputs, so the same decision always
has the same name. Recompute its verdict from \`proof\` alone with
\`npx -y -p @paystage/preflight paystage-verify-bundle proof.json\`.

\`GET /wallets/:address\` returns stored observations about one payee — contract vs EOA, age band,
activity band, whether it holds the asset being paid, our own list hits, and GoPlus flags. Each
observation names the source that reported it and the date it was read. The response has three arrays
(\`labels\`, \`observations\`, \`disagreements\`); there is no score, no "trust" field and no combined
verdict. A field two sources disagree about appears in \`disagreements\` with both values and dates. An
address with no stored rows returns empty arrays; that means no observations were recorded, not that
the address is safe.

\`GET /v1/mandate/:serial\` returns the record behind a Vouch pass: \`status\` (\`active\`, \`revoked\`,
\`expired\` or \`unknown\`), \`scope\` (per-payment cap, window amount and length, expiry), \`principal\`
(the published display name plus \`assertion: "self"\`) and \`verdict_for_seller\` (\`trust\`,
\`do_not_trust\` or \`unknown\`). An unknown serial answers HTTP 200 with \`status: "unknown"\` rather
than 404, because a scanner needs an answer and "unknown" is one. The response is never cached
(\`cache-control: no-store\`), since a cached "active" would outlive a revocation. With no mandate
source configured, every serial answers \`unknown\`; the route reports that rather than inventing an
active mandate.

The hosted API runs the same evaluation code. Use it when you cannot run a local
process; run locally when you can, because it removes the network hop before a
payment.

## Health and check history

\`/v1/public/cadence.json\` reports releases and the daily check history. Two different questions, two fields:

| field | answers |
|---|---|
| \`current\` | did the **last** run pass |
| \`all_recent_passing\` | did every run in the window pass |

\`all_passing\` carries the window as well — it used to mean "the latest run passed", which is the opposite of what
its name promises (a payload read \`all_passing: true\` beside \`passing: 7, total: 12\`). It is kept under the old
name for one release so a consumer reading it gets the stricter meaning, never a looser one.

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
## Questions an agent asks, and the call that answers each

The shortest path from a question to a tool call. Every answer is a tool or endpoint that exists, with the argument
that matters — not a link to prose.

| question | call |
|---|---|
| "should this x402 payment be signed?" | \`evaluate_mcp_payment({ payment_required, policy, agent_id? })\` → \`pay\` / \`review\` / \`do_not_pay\` + the rule that fired |
| "what is this 402 header actually asking for?" | \`decode_payment_required({ header })\` — pure decode, no network, no verdict |
| "which approvals could still drain this wallet?" | \`list_outstanding_auths({ wallet })\` then \`evaluate_outstanding_auths({ auths, policy })\` |
| "is this spend rate abnormal?" | \`evaluate_velocity({ history, proposed, policy })\` |
| "is this HIP-3 / trade.xyz order inside my limits?" | \`evaluate_hip3_trade({ order, policy })\` |
| "can I trust this receipt?" | \`verify_receipt({ receipt })\` — selects the signing key by the receipt's \`key_id\` |
| "is my policy valid before I wire it in?" | \`validate_policy({ policy })\` — an invalid policy makes every evaluation refuse |
| "I need testnet USDC to try this" | \`request_testnet_funds({ address })\` — 0.5 USDC per address per 24h |
| "how do I call this over HTTP instead of stdio?" | \`POST https://api.paystage.xyz/v1/evaluate_mcp_payment\`, or the MCP endpoint at \`/mcp\` |
| "why did it refuse?" | the response's \`reasons\` array, each a stable sentence naming the rule; \`fix\` says what to change |

An agent that cannot answer a question from this table is looking at the wrong product.

## 中文（简体）说明

PayStage 是面向 AI 智能体的 x402 支付安全层：在钱包签名之前评估这笔支付该不该付，返回
**pay**、**review** 或 **do_not_pay**，并给出触发的那条规则。只读、不持私钥、不签名、不移动资金。

**它覆盖的检查**：收款地址是否在已知盗币名单（每条都有公开出处）、金额上限、允许的链与资产、
ERC-20 / Permit2 / EIP-3009 授权是否仍然危险、消费速率是否异常、HIP-3 / trade.xyz 下单是否超出范围。

**裁决语义**：\`pay\` 可以签；\`review\` 需要人看一眼（规则命中但不致命）；\`do_not_pay\` 不要签，
响应里带稳定规则码，例如 \`amount 1.00 USDC exceeds max_amount 0.05 USDC\`。缺字段、未知字段、
未知 \`agent_id\` 一律 \`do_not_pay\` —— 失败方向是拒绝，而不是放行。

**安装**：\`npx -y -p @paystage/mcp paystage-mcp\`（MCP 服务，stdio），或托管 API
\`https://api.paystage.xyz\`（Base 主网，$0.002 USDC / 次，x402 付费）。

**测试网**：\`POST https://sepolia.api.paystage.xyz/faucet\`，body \`{"address":"0x…"}\`，每个地址每
24 小时 0.5 USDC；被拒绝时返回重置时间。对应 MCP 工具 \`request_testnet_funds\`。

**中文资源**：https://paystage.xyz/zh · https://github.com/base-buzz/paystage/blob/main/README.zh-CN.md ·
https://paystage.xyz/glossary

关键词：x402、支付安全、支付前校验、智能体支付、agent 支付拦截、盗币地址检查、钱包授权检查、消费限额、
MCP 工具、USDC、Base。

`;

  return new Response(body, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "public, max-age=300, s-maxage=300",
    },
  });
}

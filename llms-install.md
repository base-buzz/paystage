# Installing PayStage — for agents and for the humans configuring them

PayStage is an MCP server that answers one question before an agent's wallet signs an x402
payment: **should this payment happen?** Tools return `pay`, `review` or `do_not_pay`, with
the rule that fired.

## The command

```sh
npx -y -p @paystage/mcp paystage-mcp
```

Two bins are published (`paystage-mcp` and `paystage-verify`), so `npx @paystage/mcp` on its
own cannot infer which one to run and fails with *"could not determine executable to run"*.
Use `-p` and name the bin.

## Client configuration

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`) use the same
shape:

```json
{
  "mcpServers": {
    "paystage": {
      "command": "npx",
      "args": ["-y", "-p", "@paystage/mcp", "paystage-mcp"],
      "env": { "PAYSTAGE_POLICY_FILE": "/absolute/path/to/policy.json" }
    }
  }
}
```

`PAYSTAGE_POLICY_FILE` is optional. Without it the server starts and answers
`do_not_pay` for anything it cannot judge, rather than guessing — a gate with no policy is
not a permissive gate.

## The ten tools

| Tool | Answers |
|---|---|
| `evaluate_mcp_payment` | should an MCP tool call be paid for |
| `evaluate_outstanding_auths` | should an existing EIP-3009 authorisation be settled |
| `list_outstanding_auths` | what authorisations exist for an address |
| `evaluate_hip3_trade` | does a proposed HIP-3 trade fit the policy (it never places one) |
| `evaluate_velocity` | is this agent's rate or spend pattern normal |

## Verify it installed

```sh
npx -y -p @paystage/mcp paystage-verify --help
```

And to prove the server answers, send it a JSON-RPC `initialize` followed by `tools/list`
over stdio. The repository ships `scripts/mcp-handshake.mjs`, which does exactly that and
asserts ten tools come back.

## Without installing anything

```sh
curl -s -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d '{"payment_required":{"x402Version":2,"accepts":[…]},"policy":{…}}'
```

Returns a real verdict, signed receipt included, with no payment and no account for the
first 1,000 calls per IP per day. A browser demo of the same call is at
<https://paystage.xyz/try>.

## What it does not do

- does not hold keys, sign transactions, or move funds
- does not place orders or recommend trades — the trade tool is a local policy gate
- does not see what happens after settlement; it decides before the signature exists

Source, tests and the receipt format: <https://github.com/base-buzz/paystage>

---

## 中文（简体）

面向 AI 智能体的 x402 支付安全层。在钱包签名之前，用你写的本地策略判断这笔支付该不该付，返回
`pay`、`review` 或 `do_not_pay`，并给出触发的那条规则。只读，不持私钥，不签名，不移动资金。

安装（MCP 服务）：

```sh
npx -y -p @paystage/mcp paystage-mcp
```

只装其中一个包也可以：

```sh
npm i @paystage/x402-guard    # x402 客户端在签名前的策略闸门
npm i @paystage/preflight     # 评估器本体，无网络调用
```

托管 API（Base 主网，$0.002 USDC / 次，走 x402）：`https://api.paystage.xyz`

测试网免费领取：`POST https://sepolia.api.paystage.xyz/faucet`，body `{"address":"0x…"}`，
每个地址每 24 小时 0.5 USDC；被拒绝时会返回重置时间。对应 MCP 工具 `request_testnet_funds`。

中文文档：https://paystage.xyz/zh · https://github.com/base-buzz/paystage/blob/main/README.zh-CN.md

关键词：x402、支付安全、支付前校验、智能体支付、agent 支付拦截、盗币地址检查、消费限额、MCP 工具、USDC、Base。

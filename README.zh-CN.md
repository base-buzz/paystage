# PayStage — 面向 AI 智能体的 x402 支付安全层

> 在钱包签名之前，先判断这笔 x402 支付该不该付。返回 `pay` / `review` / `do_not_pay`，并给出触发的规则。

PayStage 是钱包之外的一层**只读安全带**。它按你写的策略评估一笔待签名的支付，只返回判定结果——**不持有私钥、不签名、不转移资金**。它不是投资建议。

## 它解决的问题

智能体看到一个 402 支付请求就会照付。没有人检查这笔钱的收款方是不是你确认过的地址、金额是不是它被授权支付的上限、或者那个地址是否出现在已知的资金盗取名单里。

PayStage 在签名之前回答这三个问题，并把答案写在回执里。

## 九件工具（只读）

<!-- tools:table:start -->
| 工具 | 它回答什么 |
|---|---|
| `evaluate_mcp_payment` | 这笔 x402 支付该不该签？→ `pay` · `review` · `do_not_pay` |
| `list_outstanding_auths` | 还有哪些 ERC-20 / Permit2 / EIP-3009 授权尚未结清 |
| `evaluate_outstanding_auths` | 哪些授权需要在下一笔支付前处理 |
| `evaluate_hip3_trade` | 这笔 HIP-3 / trade.xyz 订单该不该下？→ `allow` · `review` · `do_not_trade` |
| `evaluate_velocity` | 这次消费是短时爆发、尖峰，还是失控的节奏 |
| `verify_receipt` | 这张回执是不是我们签发的——是否针对这笔支付、是否仍在有效期内 |
| `decode_payment_required` | 这个 base64 的 402 头到底说了什么 |
| `validate_policy` | 这份策略文档是否合法，问题出在哪个字段 |
| `request_testnet_funds` | 测试用的 0.5 Base Sepolia USDC —— 每个地址每 24 小时一次，并给出重置时间 |
| `evaluate_batch` | 同一问题，批量评估多笔支付，每笔一个判定 |
<!-- tools:table:end -->

完整的逐工具说明（何时调用、返回什么、失败时如何表现）见英文 [README.md](README.md#tools)。

## 快速开始

```bash
npx -y -p @paystage/mcp paystage-mcp
```

或者不安装，直接用免费额度调用托管接口：

```bash
curl -s -X POST https://api.paystage.xyz/v1/evaluate_mcp_payment \
  -H 'content-type: application/json' \
  -d @request.json
```

`request.json` 形如 `{ "payment_required": { ... }, "policy": { ... } }`。每日每 IP 前 1,000 次免费，无需账号。

## 与中文支付生态的关系

微信支付、支付宝、抖音支付的智能体 MCP 服务已经存在，它们解决的是"如何收款"。PayStage 解决的是相反方向的问题：**付款方在签名之前如何判断**。两者可以同时使用——PayStage 不接触资金，也不依赖具体的支付通道，只评估 x402 支付请求。

## 事实边界

- 九件工具、渠道、版本号以英文 [README.md](README.md) 为准；本文是摘要，不新增任何声明。
- 已结算的支付无法追回、看起来正规但从不交付的商户、绕开本层的直接签名——这些都不在覆盖范围内，见 [LIMITS.md](LIMITS.md)。
- 源代码 MIT，测试与 CI 公开：https://github.com/base-buzz/paystage

## 其他文档

- [README.md](README.md) — English (canonical)
- [llms.txt](https://paystage.xyz/llms.txt) — 给智能体读的短地图
- [docs/seller-protection.md](docs/seller-protection.md) — 五分钟检查一个商户
- [LIMITS.md](LIMITS.md) — 我们挡不住什么

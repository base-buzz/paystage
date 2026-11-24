# Glossary

Every term this project uses, in the order a stranger meets it. If a word appears on the site and is not here, that
is a bug in this file.

## The protocol

**x402** — an HTTP payment protocol. A server answers `402 Payment Required` with machine-readable terms; the client
pays and retries. Revived by Coinbase in 2025 and now governed in the open. PayStage evaluates the terms *before* the
client pays.

**x402Version** — which revision of the protocol a 402 response speaks. Ours handles `2`. A receipt from another
version is refused rather than interpreted hopefully.

**PAYMENT-REQUIRED** — the HTTP header a server sends with its 402. It carries a base64 JSON document: networks,
assets, amounts, payees, timeouts. `decode_payment_required` turns it into JSON.

**PAYMENT-RESPONSE** — the header a facilitator returns after a successful payment. It carries the settlement result:
`success`, `transaction`, `network`, `payer`. This is the only place the payer appears — not in the request.

**facilitator** — the service that verifies a payment and settles it on chain. Coinbase (CDP) and PayAI are
facilitators. A facilitator moves money; it does not judge whether you should. PayStage is not a facilitator.

**settlement** — the moment value actually moves on chain. Before it, a payment is a signed intention.

**CAIP-2** — the naming scheme for a chain, e.g. `eip155:8453`. The number is the chain id, not a nickname.

**eip155:8453** — Base mainnet. `eip155:84532` is Base Sepolia, the test network.

**EIP-3009** — a token standard allowing a transfer authorised by a signature rather than by the sender holding gas
(`transferWithAuthorization`). This is what makes gasless x402 payments possible, and why a payment can be signed and
settled by someone else.

**Permit2** — a Uniswap contract that batches token approvals. Its authorisations are long-lived, which is why
`evaluate_outstanding_auths` exists: a signature you forgot about is still spendable.

**ERC-20 allowance** — the older approval mechanism. "Infinite approval" is an allowance of `2^256-1`; it survives
almost any incident.

**atomic units** — how tokens are counted on chain. USDC has 6 decimals, so `12500000` is 12.5 USDC. Misreading the
decimals by 10^12 turns a 0.05 cap into a 40,000 USDC payment, which is why the policy schema refuses a mismatch.

**payTo** — the on-chain address that receives the payment, inside the 402 terms. Must be 40 hex characters; a
malformed one is refused because funds sent to it are unrecoverable.

**USDC** — the stablecoin x402 payments are denominated in. On Base, `0x8335…2913`.

**HIP-3** — Hyperliquid's framework for third-party perpetual markets, used by `trade.xyz`. `evaluate_hip3_trade`
judges an order against a local policy; it is not financial advice and cannot place an order.

## The decision

**policy** — the JSON document stating what an agent may pay: a cap, allowed networks, assets and payees, a timeout,
optional velocity and time windows. You write it; we only enforce it.

**allowlist** — the set of payees a policy permits. Unknown payees are denied by default (`unknown_payee: "deny"`),
because an allowlist that defaults to permissive approves everything.

**allowance / authorisation** — a standing permission to spend someone's tokens. Different from a payment: it does not
need a signature each time, which is what makes a drain possible long after the incident.

**velocity** — spend rate over a rolling window. A per-payment cap does not stop twenty small payments; a velocity
check does.

**time window** — the hours (UTC) in which a policy permits payment. `[22, 6]` wraps midnight; the end hour is
exclusive.

**drainer** — an address or approval that takes funds without delivering. Our list is curated and every entry carries
a citation; it is deliberately precise rather than exhaustive.

**sanctions / OFAC** — the US Treasury's list of blocked persons, including crypto addresses. We screen the 123 EVM
addresses the Treasury publishes, regenerated from their own feed.

**verdict** — the answer: `pay`, `review` or `do_not_pay` for payments; `allow`, `review`, `do_not_trade` for trades.
`review` means the payment needs stronger attestation before it is signed — not that a human must be interrupted.
The policy's `step_up` block says which non-interactive answers count; a person is the fallback.

**step-up** — a `review` triggered by a `step_up` threshold: amount above X, a payee the payer has not recorded
paying, or the payer's first payment. The reason names the threshold (`step_up.amount`, `step_up.unknown_payee`,
`step_up.first_payment`) and the result lists the principal's pre-arranged answers — a pre-signed allowance, a
second key, or a bounded auto-approve — so the agent can continue without a browser.

**reason codes** — the rule that fired, as a stable string, e.g. `amount 1.00 USDC exceeds max_amount 0.05 USDC`. This
is what makes a refusal arguable instead of mysterious.

## The evidence

**receipt** — a signed statement of a decision: what was judged, what the verdict was, when, and by which key. Bound to
the payment terms and valid for five minutes.

**verify / provenance** — checking a receipt against our published key without trusting us. `INVALID` (altered),
`EXPIRED` (too old), `payment-mismatch` (about a different payment), `UNVERIFIABLE` (the key could not be fetched —
which is a refusal, not a pass). npm provenance is a separate, unrelated attestation about how a package was built.

## The plumbing

**MCP** — Model Context Protocol, the interface agents use to call tools. `api.paystage.xyz/mcp` speaks Streamable
HTTP; the npm package speaks stdio.

**Streamable HTTP** — the transport where an MCP client POSTs JSON-RPC to one URL and may receive a stream in reply.

**ERC-8021 / builder code** — an attribution tag appended to calldata so a transaction can be credited to the tool that
produced it. Our builder code is `bc_f7k4qn7g`.

**Bazaar** — an index of paid x402 endpoints. Being listed there is discovery, not endorsement.

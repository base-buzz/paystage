# @paystage/auth-watch

Scan and evaluate outstanding token authorizations (ERC-20 allowances, Permit2
allowances, and EIP-3009 nonces) for a wallet against a Paystage policy.

## Install

```sh
pnpm add @paystage/auth-watch
```

## Library usage

```ts
import {
  createRpcClient,
  resolveRpcUrl,
  listOutstandingAuths,
  evaluateOutstandingAuths,
} from "@paystage/auth-watch";
import { loadPolicy } from "@paystage/policy";

const network = "eip155:8453";
const rpc = createRpcClient(resolveRpcUrl(network));
const policy = await loadPolicy("./paystage.policy.json");

const items = await listOutstandingAuths({
  wallet: "0x...",
  network,
  tokens: ["0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913"],
  spenders: policy.allowed_spenders ?? policy.allowed_pay_to,
  rpc,
});

const results = evaluateOutstandingAuths(items, policy);
```

## MCP server

```sh
node dist/cli.js
```

Tools:

- `list_outstanding_auths` — list outstanding authorizations.
- `evaluate_outstanding_auths` — list and evaluate against a policy.

Both accept `wallet`, optional `network`, `tokens`, `spenders`,
`policy_path` or inline `policy`, `eip3009_nonces`, and `rpc_url`.

## Environment

- `PAYSTAGE_RPC_URL` — overrides the default RPC URL for the network.

## Networks

- `eip155:8453` — Base mainnet (`https://mainnet.base.org`)
- `eip155:84532` — Base Sepolia (`https://sepolia.base.org`)

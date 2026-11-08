# x402 service registry

A curated list of services that sell something over **x402 on Base**. It exists so
an agent (or its developer) can find a paid endpoint that is real, and so we can
see who is actually selling rather than guessing from a blog post.

## Add your service

1. Fork the repo and add one object to `services.json` — newest first, do not
   reorder other entries.
2. Open a pull request titled `registry: add <your service>`.
3. A maintainer checks the endpoint answers and the fields are accurate. If it
   does not answer, the entry stays out. That is the whole point of the list.

## Entry format

```json
{
  "name": "Example Search API",
  "url": "https://api.example.com",
  "network": "eip155:8453",
  "description": "Web search results, priced per query",
  "price": "$0.004 per call",
  "asset": "USDC",
  "payTo": "0x…",
  "x402_version": 2,
  "verified_at": "2026-11-09"
}
```

| Field | Required | Notes |
|---|---|---|
| `name` | yes | What it is called. Not a domain. |
| `url` | yes | The x402 endpoint an agent would call. Must answer. |
| `network` | yes | CAIP-2 id. `eip155:8453` is Base mainnet. |
| `description` | yes | One sentence: what an agent gets for its money. |
| `price` | yes | Human-readable price. |
| `asset` | yes | Settlement asset, e.g. `USDC`. |
| `payTo` | yes | The receiving address. Public by nature — it is in the 402 challenge. |
| `x402_version` | yes | Protocol version the endpoint speaks. |
| `verified_at` | yes | Date a maintainer last confirmed the endpoint answers. |

## What gets rejected

- **Anything that cannot be verified.** No endpoint, no entry. Ever.
- **Mixture of advertisement and service.** Entries describe what is sold; they do
  not carry marketing copy.
- **Paid placement.** There is no way to buy a position. If that ever changes it
  will be announced in the changelog and priced publicly, not quietly.
- **Trading, betting or yield claims.** Out of scope for this project and for
  anything it lists.

## Why a service would want to be listed

Discovery. Agents and developers building x402 flows need a place to look, and a
list that only contains verified endpoints is worth reading. Being in it is a
statement that your endpoint answers and your fields are honest — nothing more, and
nothing bought.

## Status

The registry is being seeded. Entries will appear here as services are verified;
the file starts empty rather than padded, because a list of unverified entries is
worse than no list.

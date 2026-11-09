# Promoting PayStage to agents

Plan written 2026-11-09. Scope: the six tool packages (`@paystage/mcp`,
`preflight`, `velocity`, `auth-watch`, `trade-preflight`, `policy`) and the hosted
pay-per-call endpoints on `api.paystage.xyz`.

## The premise

Two readers, and they need different things.

1. **The agent, at runtime.** It never sees a post. It sees `/llms.txt`, an MCP
   registry record, a `402` challenge with an `accepts` array, and whatever its
   builder wired in. If the machine surface is wrong or missing, no amount of
   posting helps: the agent cannot find us, or finds us and cannot parse us.
2. **The builder, at install time.** They search, land on npm or GitHub, read the
   first screen, and decide in about forty seconds. They are the ones who put the
   tool in front of their agent.

So the order of work is: machine surfaces first, findability second, posts last.
Posts amplify something that already works; they cannot repair a 404.

## Shipped today (2026-11-09)

- One source of truth for outbound links:
  [agent-manifest.ts](../apps/console/src/lib/agent-manifest.ts) `SOCIALS` —
  X (`@paystage_xyz`) and GitHub. It feeds the landing footer, the
  `socials[]` field in `/.well-known/paystage.json`, and `/llms.txt`, so the
  three cannot drift.
- X added to the README link block, to all six package READMEs (the npm pages),
  and to `/llms.txt`.
- A vitest case fails if a social URL stops being a loadable `https` URL or if X
  disappears from the list.

Not shipped, deliberately: any claim that `@paystage_xyz` is ours beyond Dave's
word. There is no API that proves handle ownership to us without a logged-in
session, so the assertion lives in `SOCIALS` where one edit fixes it.

## Channel inventory

Status checked by hand on 2026-11-09. "Unverified" means nobody has looked yet —
not that it is absent.

| Surface | Reader | What it needs from us | Status |
|---|---|---|---|
| [Official MCP Registry](https://registry.modelcontextprotocol.io) | agent + builder | `server.json` per package | **Listed** — `xyz.paystage/auth-watch` and siblings answer the search API |
| [mcp.so](https://mcp.so/server/paystage) | builder | listing text | Listed; returns 301, confirm the canonical URL resolves |
| [x402scan.com](https://x402scan.com) | agent builder | a live 402 endpoint | Unverified |
| [Agentic.Market](https://agentic.market) | agent builder | listing | Unverified |
| [pay.sh](https://pay.sh) | agent builder | listing | Unverified |
| [app.ampersend.ai/discover](https://app.ampersend.ai/discover) | agent builder | listing | Unverified |
| [x402-list.com](https://x402-list.com) | agent builder | listing | Unverified |
| Coinbase **Bazaar** (CDP) | agent, via discovery | discoverable 402 resource | Unverified — see Phase 0 |
| Glama, PulseMCP | builder | repo + description | Unverified |
| Smithery | builder | Streamable HTTP server | **Blocked** — we ship stdio; needs an HTTP wrapper or MCPB bundle |
| `punkpeye/awesome-mcp-servers` | builder | one-line entry | Draft ready in [awesome-mcp-servers-pr.md](./awesome-mcp-servers-pr.md); needs Dave to open the PR |
| npm | builder | readable package README | Live; X link added today |
| `paystage.xyz/llms.txt` | agent | terse map, exact tool names | Live; X link added today |
| `registry/services.json` | agent | a fetchable URL | **Gap** — 404 at `paystage.xyz/registry/services.json`; only on GitHub |

The five x402 directories in the middle of that table are the ones the x402
project itself points people at; the list comes from the
[coinbase/x402 README](https://github.com/coinbase/x402) (line 93). They are
community-maintained, so each has its own submission route and none can be
assumed to index us automatically.

## Phase 0 — know where we stand (today, free, no account)

1. Add `apps/hosted/scripts/inventory.mjs`: for each directory above, fetch the
   public search or listing URL for `paystage` / `api.paystage.xyz` and print
   `hit` / `miss` / `error` per surface. No writes, no keys.
2. Run it, paste the dated table into this file under "Channel inventory".
3. Same script checks our own surfaces: `/llms.txt`, `/llms-full.txt`,
   `/.well-known/paystage.json`, `socials[]`, and the 402 challenge on
   `api.paystage.xyz`. Conformance already covers the last one; the socials field
   is new and is not yet in the conformance run.

Why first: every later step assumes an endpoint is live and a listing exists.
A 20-minute check prevents filing five submissions for a service nobody can
call.

## Phase 1 — fix our own surfaces (week 1, free)

1. **Serve the registry.** `registry/services.json` is a list nobody can fetch.
   Either serve it at `/registry/services.json` (a static route in the console
   app, regenerated at build) or point `/llms.txt` at the GitHub raw URL. A
   registry is a discovery channel only if a client can `GET` it.
2. **A `for agents` block in `/llms.txt`.** One `curl` that returns a `402` with
   the real `accepts` array, then the exact price, network and `payTo` semantics.
   Agents learn by trial; give them the first successful trial on the page they
   already fetch.
3. **Bazaar check.** Confirm whether `api.paystage.xyz` appears in Coinbase's
   discovery results. If it does, record the query. If it does not, read the CDP
   discovery docs and find the actual registration step before changing any code.
4. **Smithery decision.** Either publish an HTTP wrapper or leave it out with a
   reason in this file. The current stdio-only shape makes the listing dishonest
   by default.

## Phase 2 — directory presence (week 1–2, needs a human)

These are forms: they want an account, sometimes a repo install, sometimes a
listing fee. Each is a five-minute action by Dave, not an agent action.

1. File to x402scan, Agentic.Market, pay.sh, ampersend discover, x402-list.
   Copy for all five is one paragraph: what the endpoint returns, the three
   verdicts, the price, the network. No marketing adjectives — these catalogs
   are read by machines and skimmed by people who resent padding.
2. Glama and PulseMCP: same paragraph, repo URL, `server.json`.
3. **Only after** the above: open the `awesome-mcp-servers` PR. It is a
   third-party repo, so it stays Dave's action (policy and credential scope both
   point that way). The draft is written and waiting.

Sequencing rule: directories that gate on "does the endpoint answer" should see
a working endpoint and a served registry, not a repo with a good README.

## Phase 3 — the posts (week 2–4, Dave posts)

`launch/x-thread-final.md` is finished copy and `launch/x-post1-intent.txt` is
the intent URL that pre-fills it. The thread's job is not to explain x402 to
people who already know it; it is to make the specific failure — an agent paying
a lookalike address — feel like a live bug rather than a hypothetical.

Cadence: one post per working day, seven total, each standalone. Nothing posts
from this account automatically and no post claims a metric we cannot show.

After the thread, the only recurring content worth the time is a weekly
"what the gate rejected" post — a real verdict from a real call, with the amount
and rule, no addresses, no identities.

## Phase 4 — measurement that cannot lie

| Metric | Source | Honest? |
|---|---|---|
| npm downloads per package | npm registry downloads API | Real, but noisy; never optimise it |
| Hosted calls | `/v1/public/status`, Supabase `events` | Count **non-synthetic only**; synthetic rows stay labelled |
| Receipts issued | receipt endpoint counters | Real |
| Directory presence | the Phase-0 inventory script | Binary, dated |
| X impressions | X analytics | Read, never quoted as users |

Report the first four. Impressions are a distribution signal for us, not a claim
about adoption.

Stop the whole programme if the only way to move a number is to fake it. Wash
trading, sockpuppet installs and inflated counts are out — and on this project
they would also destroy the one thing the product sells, which is that a verdict
from us means something.

## Blocked on Dave

- Opening the `awesome-mcp-servers` PR (third-party repo).
- Accounts on the five x402 directories, if signup is required.
- Posting the thread; `@paystage_xyz` authority is asserted, not verified.
- Smithery: decide wrapper vs. drop.

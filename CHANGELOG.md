# Changelog

## 2026-11-24
- `@paystage/mcp@0.8.18`: **republishes what 0.8.17 does not contain.** The source gained `evaluate_batch`, `request_testnet_funds`,
  `normalizePaymentRequired` and the two receipt verifiers after that tag, so the published tarball was older than the repo — the
  same failure `#421` records and the same one `@paystage/preflight@0.5.4` fixed on 21 Nov. npm refuses a republish, the release
  workflow would still have reported success, and the published package would have kept announcing fewer tools than it has.

- `@paystage/policy@0.4.0`: **the optional `step_up` block reaches npm for the first time.** `#414` added `step_up` — amount
  above, unknown payee, first payment from this payer — and the payee-observation collector and hand-written parser that
  also landed after the 0.3.1 tag. The schema change is additive (a new optional field), so this is a minor. The published
  0.3.1 tarball cannot be replaced: npm refuses a republish, and the release assert is what reported the difference.
- `@paystage/preflight@0.6.0`: **the evaluator that answers step-up ships.** A configured threshold now returns `review`
  carrying the threshold that fired, the threshold value and the principal's non-browser answers
  (`pre_signed_allowance`, `second_key`, `bounded_auto_approve`), with human approval as the fallback rather than the only
  path. It also carries the Circle blacklist, Solana checks and review packet that postdate 0.5.4. Additive behaviour, so
  minor; the 0.5.4 tarball predates all of it and cannot be republished.
- `@paystage/x402-guard@0.5.0`: **the frozen correct-402 predicate is a public export.** `isCorrectChallenge` and the
  builder-code constants now ship with the fixtures that pin them, so a number quoted against the checked-seller run means
  the same thing next month. New public API, so minor; the exact pins move to `@paystage/policy@0.4.0` and
  `@paystage/preflight@0.6.0`, which is also why the 0.4.10 tarball needed a version of its own.

## 2026-11-21
- `@paystage/preflight@0.5.4`: **republishes what 0.5.3 does not contain.** Two features landed after that tag — the review
  packet (#302) and the per-run evidence bundle (#308) — so the tarball on npm was older than the repo, and `assert-artifact`
  said so plainly: *"version 0.5.3 is already published but its dist/ differs from this commit"*. npm refuses a republish, and
  the release would still have looked green, which is exactly the failure that check exists for. No behaviour change beyond
  what 0.5.3 should have been.


- `@paystage/receipt-verify@0.1.0` and `@paystage/channel@0.1.0`: **two new packages, published.** `receipt-verify` checks a
  signed receipt without installing the MCP server — "verify without trusting us" was an advertised promise that cost a
  third party a server install to keep; it takes the receipt and a fetch, selects the key by `kid`, and returns the same
  verdict strings the server does. `channel` reads an x402 deposit channel over `eth_call` only (`balance`, `totalClaimed`,
  `withdrawRequestedAt`, derived expiry) and reports `signedMaxClaimable` as unassessed because that value lives in the
  off-chain voucher, not in contract storage. Both were bootstrapped by hand — the versions before today's CI publish carry
  no provenance attestation — and both are now in `PKGS`, so every later version ships through OIDC.

## 2026-11-20

- `@paystage/velocity@0.2.4` and `@paystage/mcp@0.8.17`: **the per-payee ceiling is now published.** The feature (#39) landed in
  the repo but not on npm — the release that was supposed to carry it published `0.2.3` from an earlier build, so the published
  tarball's `check.js` had no per-payee code while the repo did. That is why every release run since has ended red at "Assert the
  published artifacts match the repo": the assert was right, and it was the only thing saying so. `mcp` moves because it pins
  `velocity` exactly, and a pin that stays at `0.2.3` would hand mcp's users the old evaluator.

## 2026-11-20

- `@paystage/policy@0.3.1`: **the version the repo has been pinning since 2026-11-19 is finally on npm.** It carries the
  asset-address-per-network rule, per-payee velocity ceilings and time windows — so until today a fresh install of any
  package that pins `0.3.1` failed with `ETARGET`, and the daily cadence reported `npm latest is 0.3.0; the repo is 0.3.1`.
  No policy tag had ever been pushed for the bump; tagged now. The release run itself is red for an unrelated reason
  (`@paystage/velocity@0.2.3` publishes a dist that differs from the repo) — recorded, not hidden.

## 2026-11-19

- `@paystage/mcp@0.8.15` and `@paystage/x402-guard@0.4.10`: **keywords for the two buyer queries we lose.** The daily probe
  measures six searches an agent might run; we rank first or second on four and are absent on "stop agent paying drainer"
  and "limit agent spending usdc". Six keyword phrases per package, and the probe re-run the same day says whether that
  moves anything — if it does not, the answer is that npm search cannot answer a sentence, and the record will say so.


## 2026-11-18

- `@paystage/mcp@0.8.14`: **the MCP registry entry is renamed to `io.github.base-buzz/x402-payment-safety`.** The registry
  searches server *names* only, and every capability query an agent would use — "payment", "safety", "policy", "spend",
  "guardrail" — returned 100 other servers and none of ours. A name that does not contain the words an agent searches with
  is a name an agent cannot find. The description also moved to 99 characters so it is not truncated in listings.


## 2026-11-18

- `@paystage/x402-guard@0.4.9`: **published to the MCP registry under a name containing "x402".** The registry's search
  matches server *names* only — 100 of 100 results for "x402" have it in the name — and every entry we had was
  `io.github.base-buzz/{mcp,preflight,...}`, so the one query that describes this product returned none of our packages.
  The guard now publishes as `io.github.base-buzz/x402-guard`.


## 2026-11-18

- `@paystage/ai-sdk@0.1.5` and `@paystage/x-evm@0.1.4`: dependency pins move to `^0.5.2` of the evaluator. They pinned
  `0.5.0` exactly, so every user of either package silently got an evaluator two patches behind — including the
  non-receivable payee rule. Workspace pins are now ranges where the package is published, so a patch release of the
  evaluator does not require four package releases to propagate it.


## 2026-11-18

- `@paystage/x-evm@0.1.3` and `@paystage/ai-sdk@0.1.4`: **two published packages shipped without a `dist/`.** Their
  `main` points at the package's own dist entry, and the tarball did not contain it, so every `import "@paystage/x-evm"` and every
  `import "@paystage/ai-sdk"` failed with `ERR_MODULE_NOT_FOUND` — while `npm view` reported the versions happily. The
  cause: the root `build` script listed seven packages and these two were not among them, so the release published what
  the workspace had never built. The script now builds every workspace package, and the artifact check compares the
  published `dist/` against the repo's.


## 2026-11-18

- `@paystage/x402-guard@0.4.8`: rebuild against `@paystage/preflight@0.5.2`. Its declaration output changed when the
  evaluator's type surface did, so the artifact check reported the published dist/ as differing from the repo — a package
  that is correct at runtime and stale in the types a TypeScript caller compiles against.


## 2026-11-18

- `@paystage/preflight@0.5.1` **published a version document with no tarball** — `npm view` reports it and
  `npm pack` 404s, so every `npm install @paystage/preflight@0.5.1` fails while the registry insists the version
  exists. npm does not allow a version to be republished, so 0.5.2 is the same content under a version that works. The
  tarball check caught it (`check-tarballs.mjs`) — the second time this exact failure has appeared, which is why that
  check exists.


## 2026-11-18

- `@paystage/preflight@0.5.2`: **the non-receivable payee rule ships.** A payee whose address is a known sink (`0x…dEaD`,
  zero address, burn addresses) is now `do_not_pay` — paying it destroys the funds rather than transferring them, which is
  a different fact from "on a drainer list" and has its own reason code. It has been running on the hosted API since it
  was written; the artifact check found the package had never carried it.

## 2026-11-18

- `@paystage/mcp@0.8.13` supersedes 0.8.12 (which was tagged but never published) and depends on `@paystage/preflight@0.5.2`.
- `@paystage/mcp@0.8.12`: **the tools declare their schemas the way the SDK requires**, so a clean build no longer fails.
  Ten tools passed `z.object({...})` where `registerTool` wants a raw shape; it compiled against a local SDK and broke on
  a fresh install, which would have broken this release rather than the last one. Also: `paystage-explain` now prints the
  payment terms and payee the verdict was about, with one command to check the receipt.

## 2026-11-18

- `@paystage/mcp@0.8.11`: **the tenth tool is in the published package.** `request_testnet_funds` lets an agent fund
  itself from the Base Sepolia faucet and finish the whole flow — faucet, pay, verify — with no human step. The faucet
  is rationed per address (0.5 USDC / 24h) and says when it resets. The published 0.8.10 still had nine tools, which
  the cadence job reported as "published package registers 9 tools; source declares 10".

<!-- generated by scripts/check-changelog.mjs --write — every tag, by release day -->
## Every release, by day

- **2026-11-20** — `@paystage/mcp@0.8.16`, `@paystage/preflight@0.5.3`
- **2026-11-19** — `@paystage/mcp@0.8.15`, `@paystage/x402-guard@0.4.10`
- **2026-11-18** — `@paystage/ai-sdk@0.1.4`, `@paystage/mcp@0.8.11`, `@paystage/mcp@0.8.12`, `@paystage/mcp@0.8.14`, `@paystage/preflight@0.5.1`, `@paystage/preflight@0.5.2`, `@paystage/x-evm@0.1.3`, `@paystage/x402-guard@0.4.7`, `@paystage/x402-guard@0.4.8`, `@paystage/x402-guard@0.4.9`
- **2026-11-17** — `0.4.6` (package not stated in the tag), `0.8.8` (package not stated in the tag), `0.8.9` (package not stated in the tag), `@paystage/mcp@0.8.10`, `@paystage/policy@0.3.0`, `@paystage/preflight@0.5.0`
- **2026-11-16** — `0.4.4` (package not stated in the tag), `0.8.6` (package not stated in the tag), `0.8.7` (package not stated in the tag), `@paystage/ai-sdk@0.1.2`, `@paystage/mcp@0.6.0`, `@paystage/mcp@0.7.0`, `@paystage/mcp@0.8.0`, `@paystage/mcp@0.8.1`, `@paystage/mcp@0.8.2`, `@paystage/mcp@0.8.3`, `@paystage/mcp@0.8.4`, `@paystage/mcp@0.8.5`, `@paystage/preflight@0.4.0`, `@paystage/preflight@0.4.1`, `@paystage/preflight@0.4.2`, `@paystage/preflight@0.4.3`, `@paystage/preflight@0.4.4`, `@paystage/x402-guard@0.4.0`, `@paystage/x402-guard@0.4.1`, `@paystage/x402-guard@0.4.2`, `@paystage/x402-guard@0.4.3`
- **2026-11-15** — `@paystage/mcp@0.4.0`, `@paystage/mcp@0.5.0`, `@paystage/preflight@0.3.0`, `@paystage/x402-guard@0.2.0`
<!-- end generated -->
## 2026-11-17

- `@paystage/x402-guard@0.4.7`: **the documented happy path works again.** `guardFetch(fetch, { policy })` with no
  `wrap` called a bare `require("x402-fetch")` inside a `"type": "module"` package, where `require` is undefined. The
  `ReferenceError` was swallowed by the `catch` that exists to make the peer optional, so a caller with `x402-fetch`
  installed was told to install it. It now resolves the peer with `createRequire(import.meta.url)`.
  - No test noticed because every test injected `wrap`; there is now one that exercises `defaultWrap` against a real
    installed peer, plus a guard that fails on a bare `require(` in an ESM source file.
- `registry/services.json`: `verify-registry.mjs` sends `{}` as its POST probe body. It used to send a shaped body with
  empty `accepts`, which endpoints reject during validation before the paywall — so every entry read DEAD, including
  our own. Refreshed: 14/14 live.

## 2026-11-17

- `@paystage/mcp@0.8.10`: **`npx -y @paystage/mcp` now works.** The package declares four binaries and none was named `mcp`, so npm could not pick one and every directory that generates a config from metadata died at startup — mcp.so reported `MCP error -32000: Connection closed` and fell back to a five-tool cache. Added an `mcp` alias bin alongside `paystage-mcp`, which is the bin npm looks for when a package has several (the name must match the package's unscoped name).
- New `scripts/check-bins.mjs` in CI: a multi-binary package must expose a bin named after itself, or the one-liner everyone copies cannot launch it.
- No tool, argument, policy or decision changes. Same nine tools.

## 2026-11-09

- `@paystage/preflight@0.2.1` + `@paystage/mcp@0.3.1`: known-drainer list refresh (+4 cited EVM addresses, 25 total).
- Added from [0xCERT-2026-0314](https://www.0xcert.com/advisory/0xCERT-2026-0314) (Loopscale campaign, two EVM addresses named by Loopscale) and [0xCERT-2026-0309](https://www.0xcert.com/advisory/0xCERT-2026-0309) (CoreVault exploit on BNB Chain: attacker EOA + exploit contract).
- Reviewed and deliberately not added: the week's Ethereum-/Bitcoin-/Solana-only indicators (ZachXBT EU-institution theft, BTCPay hot-wallet sweeps, TENDRIL/USDT, King bot drain) and the Udesk typosquat domains — no EVM payee to block, and the list stays precision-first.
- No code change: `evaluate` behaviour, policy schema and tool arguments are unchanged.

## 2026-11-05

- Released: `@paystage/policy` 0.2.0, `@paystage/preflight` 0.2.0, `@paystage/auth-watch` 0.2.0, `@paystage/velocity` 0.2.0, `@paystage/trade-preflight` 0.2.0, `@paystage/mcp` 0.3.0.
- Security: zod 3 -> ^4.6.7 in all packages, fixing GHSA-mrhx-c7xc-m3w5 (high; memory exhaustion validating oversized constrained collections). Minor bump because policy schemas are now zod 4.
- Supply chain: migrated from `@modelcontextprotocol/sdk` v1 to the official split v2 package `@modelcontextprotocol/server` ^2.4.0. `@paystage/mcp` install tree drops from ~100 packages to ~8 (no express, hono, cors, cross-spawn, jose, ajv, eventsource, etc.).
- MCP: same 5 tools, same names, same arguments; payment decisions verified identical vs 0.2.2. Advertised tool input schemas are now JSON Schema 2020-12; `evaluate_mcp_payment` marks `payment_required` as required (it always was).
- Packaging: source maps no longer shipped; internal `@paystage` deps pinned exact.
- Release: GitHub Actions release workflow now builds before typecheck (fixes the failed 2 Nov run), publishes all six packages in dependency order with npm provenance (Trusted Publishing to be enabled per package).
- New `SECURITY.md` with a "What this package accesses and why" section (policy file read, `PAYSTAGE_POLICY_PATH` / `PAYSTAGE_RPC_URL`, Base RPC + Hyperliquid info reads).
- Known-drainer list: +4 cited addresses (21 total) — three Step Drainer payout wallets (0xCERT-2026-0292) and the Mercado Bitcoin incident address also seen on Base (0xCERT-2026-0303/0308).
- Docs: README quick start notes the server waits silently for an agent app (Ctrl+C to exit) and how to try tools with the MCP Inspector; local-install config (community PRs #1-#3, thanks).
- Dev: vitest 2 -> 4 (clears dev-only tinypool/esbuild advisories); `npm audit` reports 0 vulnerabilities.

## 2026-11-02

- `@paystage/preflight@0.1.1` + `@paystage/mcp@0.2.2`: known-drainer list refresh (+7 cited Base/EVM addresses).


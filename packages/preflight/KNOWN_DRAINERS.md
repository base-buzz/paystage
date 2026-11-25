# Known drainers

`src/known-drainers.ts` is a **small curated** hard-deny list. Preflight
checks it **before** `unknown_payee` review so listed payees return
`do_not_pay` with reason `known drainer`.

## What is not on this list

**Non-receivable sinks.** `0x…dEaD` and the zero address are refused — funds sent to them are destroyed —
but they are not drainers, nobody collects from them, and listing them here made the refusal say "known
drainer" about a placeholder. They live in `NON_RECEIVABLE` with their own reason (`non-receivable payee
… funds are destroyed, not received`); the payment still returns `do_not_pay`.

This was a published false claim, not a gap in coverage: `0x…dEaD` sat in `KNOWN_DRAINERS` until
2026-11-17 and the demo described it as "curated list · known drainer".

**Fixtures.** A test address belongs in a fixture. If one is ever needed in a list test, it must be a
real, cited entry — the curation guard fails on any single-repeated-nibble address (`0x1111…`) in the
published list, which is what a fixture looks like.

## Policy

- Only include addresses with a **public citation** (MEW darklist, 0xCERT IOCs,
  Chainabuse, published incident reports, explorer phishing/exploit labels, etc.).
- Prefer precision over recall — false positives block legitimate payments.
- Matching is case-insensitive / checksum-agnostic.

## Per-entry citations (since 2026-11-22)

`DRAINER_ENTRIES` in `src/known-drainers.ts` is the list. Every entry is
`{ address, source, readDate, note? }`:

- `source` is an `https://` URL that names the address or the incident. It is not a list-level
  publisher page that happens to contain the address somewhere.
- `readDate` is the date a curator opened that URL, not the date of the incident.
- An entry with no findable public source is written `source: "unattributed"` and shown as
  **unattributed** on the `/lists` page. A missing or blank `source` field is a build failure;
  inventing a URL is not an option.

`scripts/check-drainer-citations.mjs` fails CI when an entry has no source, when the source is
not `https://`, or when `readDate` is older than **180 days** (or in the future). Six months is a
re-verification cadence for the URL, not a claim that the incident is recent: these are historical
records, which is why the window is 180 days rather than the comparison matrix's 90. Pass
`--strict-unattributed` to also refuse an explicitly unattributed entry.

The generator reads the same block (`scripts/gen-lists-manifest.mjs`), so the page cannot show a
different citation from the one the check validated, and `KNOWN_DRAINERS` is derived from these
entries — an address cannot exist without a citation slot.

## Sources (retrieved 2026-11-22 UTC)

Each source below is the publisher or publication consulted; the authoritative per-address record
is `source` on the entry.

- [MyEtherWallet ethereum-lists addresses-darklist.json](https://github.com/MyEtherWallet/ethereum-lists/blob/master/src/addresses/addresses-darklist.json)
- [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) (domain list; related ecosystem reference)
- [0xCERT IOC feeds](https://www.0xcert.com/iocs) — Base attacker EOA + exploit contract (`0xCERT-2026-0230`, GoPlus / PeckShield); corroborated Basescan phishing label
- [CryptoTimes / Matcha Meta SwapNet advisory](https://www.cryptotimes.io/2026/01/26/security-alert-matcha-meta-flags-swapnet-bug-as-over-16-8m-is-drained/) — SwapNet router `0x6160…3757e` approval-drain (arbitrary call); Basescan public name tag `SwapNet: Router`. The live article returns HTTP 403 to automated fetches; the entry was verified through its Internet Archive snapshot, and the entry note says so.
- [Chainabuse contract-exploit reports](https://chainabuse.com/category/contract-exploit) — Base EIP-7702 drain (`0xc900…fb03`, forwarder `0x101a…b86a`, 2026-10-08); Bitget Swap2 drain receiver `0x9cc5…e3ad`
- [Chainabuse address report](https://chainabuse.com/address/0x2cff890f0378a11913b6129b2e97417a2c302680) — Base USDC theft Jul 2026 (`0x6782…97a8`)

## Added 2026-11-05 NZDT

- [0xCERT-2026-0292](https://www.0xcert.com/advisory/0xCERT-2026-0292) — Step Drainer payout wallets (55/30/15 split), same address on all EVM chains, per Bitquery: `0x012f…d386`, `0x7bf2…7695`, `0x5aff…8dbf`
- [0xCERT-2026-0303](https://www.0xcert.com/advisory/0xCERT-2026-0303) / [0xCERT-2026-0308](https://www.0xcert.com/advisory/0xCERT-2026-0308) — Mercado Bitcoin incident destination `0xe485…2478` (confirmed by Mercado Bitcoin; seen on Base, Arbitrum, Optimism per Bitquery)

## Added 2026-11-07 NZDT

- [0xCERT-2026-0314](https://www.0xcert.com/advisory/0xCERT-2026-0314) — Loopscale attack campaign, two EVM addresses named by Loopscale: `0xb7ec…f854`, `0xb895…bfb2` (chain not stated by the feed; treated as EVM-wide)
- [0xCERT-2026-0309](https://www.0xcert.com/advisory/0xCERT-2026-0309) — CoreVault exploit on BNB Chain: attacker EOA `0xd356…5304` and the exploit contract it created, `0xc28c…87e2` (CertiK-cited transaction, corroborated on-chain)

2026-11-07 review also covered the other new 0xCERT IOCs from 2026-11-03 through 2026-11-05 (ZachXBT EU-institution theft, BTCPay hot-wallet sweeps, TENDRIL/USDT pool, King bot drain, Udesk typosquat) — none added: Ethereum-/Bitcoin-/Solana-only, or transaction hashes and domains rather than EVM payees.

Reviewed but not added (precision over recall): single anonymous Chainabuse reports without corroboration, non-EVM addresses, and exploit tx hashes.

## Provenance

Size, mtime and sha256 for this file and `SECURITY.md` are generated into
[`PROVENANCE.md`](../../PROVENANCE.md). Regenerate with `node scripts/gen-provenance-table.mjs`;
`node scripts/check-provenance-table.mjs` fails CI when the table no longer matches the files.

## Updating

1. Add one object to `DRAINER_ENTRIES` with a lowercased address, an `https://` `source` that names
   the address or the incident, the real `readDate`, and a one-line `note`. If no source can be
   found, use `source: "unattributed"` and say so in the note rather than inventing a URL.
2. Run `node scripts/check-drainer-citations.mjs` and `node scripts/gen-lists-manifest.mjs`.
3. Extend `tests/known-drainers.test.ts` — and if the new entry changes a verdict, the reason text too.
4. Bump `@paystage/preflight` (and `@paystage/mcp` if it should pick up the list), publish, redeploy hosted Workers that embed preflight.


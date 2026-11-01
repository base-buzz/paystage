# Known drainers

`src/known-drainers.ts` is a **small curated** hard-deny list. Preflight
checks it **before** `unknown_payee` review so listed payees return
`do_not_pay` with reason `known drainer`.

## Policy

- Only include addresses with a **public citation** (MEW darklist, 0xCERT IOCs,
  Chainabuse, published incident reports, explorer phishing/exploit labels, etc.).
- Prefer precision over recall — false positives block legitimate payments.
- Matching is case-insensitive / checksum-agnostic.

## Sources (retrieved 2026-11-02 NZDT)

- [MyEtherWallet ethereum-lists addresses-darklist.json](https://github.com/MyEtherWallet/ethereum-lists/blob/master/src/addresses/addresses-darklist.json)
- [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) (domain list; related ecosystem reference)
- Burn sentinel `0x…dEaD` on [Etherscan](https://etherscan.io/address/0x000000000000000000000000000000000000dead)
- [0xCERT IOC feeds](https://www.0xcert.com/iocs) — Base attacker EOA + exploit contract (`0xCERT-2026-0230`, GoPlus / PeckShield); corroborated Basescan phishing label
- [CryptoTimes / Matcha Meta SwapNet advisory](https://www.cryptotimes.io/2026/01/26/security-alert-matcha-meta-flags-swapnet-bug-as-over-16-8m-is-drained/) — SwapNet router `0x6160…3757e` approval-drain (arbitrary call); Basescan Exploit label
- [Chainabuse contract-exploit category](https://chainabuse.com/category/contract-exploit) — Base EIP-7702 drain (`0xc900…fb03`, forwarder `0x101a…b86a`, 2026-10-08); Bitget Swap2 drain receiver `0x9cc5…e3ad`
- [Chainabuse address report](https://chainabuse.com/address/0x2cff890f0378a11913b6129b2e97417a2c302680) — Base USDC theft Jul 2026 (`0x6782…97a8`)

## Updating

1. Add lowercased address to `KNOWN_DRAINERS` with a comment citing source + date.
2. Update `SOURCES` if needed.
3. Extend `tests/known-drainers.test.ts`.
4. Bump `@paystage/preflight` (and `@paystage/mcp` if it should pick up the list), publish, redeploy hosted Workers that embed preflight.

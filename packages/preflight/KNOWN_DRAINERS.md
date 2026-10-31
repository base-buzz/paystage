# Known drainers

`src/known-drainers.ts` is a **small curated** hard-deny list. Preflight
checks it **before** `unknown_payee` review so listed payees return
`do_not_pay` with reason `known drainer`.

## Policy

- Only include addresses with a **public citation** (MEW darklist, MetaMask
  phishing ecosystem, burn sentinel, etc.).
- Prefer precision over recall — false positives block legitimate payments.
- Matching is case-insensitive / checksum-agnostic.

## Sources (retrieved 2026-11-01 NZDT)

- [MyEtherWallet ethereum-lists addresses-darklist.json](https://github.com/MyEtherWallet/ethereum-lists/blob/master/src/addresses/addresses-darklist.json)
- [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) (domain list; related ecosystem reference)
- Burn sentinel `0x…dEaD` on [Etherscan](https://etherscan.io/address/0x000000000000000000000000000000000000dead)

## Updating

1. Add lowercased address to `KNOWN_DRAINERS` with a comment citing source + date.
2. Update `SOURCES` if needed.
3. Extend `tests/known-drainers.test.ts`.
4. Rebuild `@paystage/preflight` and redeploy console preview.

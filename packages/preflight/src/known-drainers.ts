// Curated hard-deny payees. Matching is checksum-agnostic (lowercase).
// See KNOWN_DRAINERS.md for curation policy and how to extend.

/**
 * A publication a drainer address was actually found in.
 *
 * `readDate` is the date this repository read the page, not the date of the incident. A curator re-reads
 * and re-dates the entry when a source moves; `check-drainer-citations.mjs` fails the build after 180
 * days, because these are historical records but the URL behind them can still disappear.
 */
export interface KnownDrainerCitation {
  /** The address this citation is for. */
  address: string;
  /** An `https://` URL that names the address or the incident, or the literal `"unattributed"`. */
  source: string;
  /** ISO date this source was read; `null` only when the entry is explicitly unattributed. */
  readDate: string | null;
  /** What the source says about this address, in one line. */
  note?: string;
}

export interface KnownDrainerSource {
  name: string;
  url: string;
  retrieved: string;
}

/** List-level sources consulted during curation. Per-entry truth lives in `DRAINER_ENTRIES`. */
export const SOURCES: readonly KnownDrainerSource[] = [
  {
    name: "MyEtherWallet ethereum-lists address darklist",
    url: "https://github.com/MyEtherWallet/ethereum-lists/blob/master/src/addresses/addresses-darklist.json",
    retrieved: "2026-11-22",
  },
  {
    name: "MetaMask eth-phishing-detect (domain list; related ecosystem)",
    url: "https://github.com/MetaMask/eth-phishing-detect",
    retrieved: "2026-11-22",
  },
  {
    name: "0xCERT IOC address feed (Base incidents incl. 0xCERT-2026-0230)",
    url: "https://www.0xcert.com/iocs",
    retrieved: "2026-11-22",
  },
  {
    name: "Matcha Meta / CryptoTimes SwapNet approval-drain advisory",
    url: "https://www.cryptotimes.io/2026/01/26/security-alert-matcha-meta-flags-swapnet-bug-as-over-16-8m-is-drained/",
    retrieved: "2026-11-22",
  },
  {
    name: "Chainabuse contract-exploit reports (Base EIP-7702 / USDC drains)",
    url: "https://chainabuse.com/category/contract-exploit",
    retrieved: "2026-11-22",
  },
  {
    name: "Chainabuse address report (Base USDC theft Jul 2026)",
    url: "https://chainabuse.com/address/0x2cff890f0378a11913b6129b2e97417a2c302680",
    retrieved: "2026-11-22",
  },
  {
    name: "0xCERT advisory 0xCERT-2026-0292 (Step Drainer payout wallets, per Bitquery)",
    url: "https://www.0xcert.com/advisory/0xCERT-2026-0292",
    retrieved: "2026-11-22",
  },
  {
    name: "0xCERT advisories 0xCERT-2026-0303 / 0xCERT-2026-0308 (Mercado Bitcoin incident; confirmed by Mercado Bitcoin, Base per Bitquery)",
    url: "https://www.0xcert.com/advisory/0xCERT-2026-0303",
    retrieved: "2026-11-22",
  },
  {
    name: "0xCERT advisory 0xCERT-2026-0314 (Loopscale attack campaign; EVM addresses named by Loopscale)",
    url: "https://www.0xcert.com/advisory/0xCERT-2026-0314",
    retrieved: "2026-11-22",
  },
  {
    name: "0xCERT advisory 0xCERT-2026-0309 (CoreVault exploit; attacker EOA and exploit contract, BNB Chain per CertiK)",
    url: "https://www.0xcert.com/advisory/0xCERT-2026-0309",
    retrieved: "2026-11-22",
  },
];

/**
 * Small curated subset. Do not add addresses without a public citation.
 *
 * Every entry carries its own source and read date (2026-11-22), so a reader can check one address without
 * trusting the list. `check-drainer-citations.mjs` enforces that shape at build time.
 */
export const DRAINER_ENTRIES: readonly KnownDrainerCitation[] = Object.freeze([
  {
    address: "0x09750ad360fdb7a2ee23669c4503c974d86d8694",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: XRP phishing site (ripple.com.pt) wallet that collects funds; entry dated 2020-11-17",
  },
  {
    address: "0xc915ec7f4cfd1c0a8aba090f03bfaab588aef9b4",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: XRP phishing site (ripple.com.pt) proceeds exchanged to ETH via Coinswitch; entry dated 2020-11-14",
  },
  {
    address: "0xecb6ffac05d8b4660b99b475b359fe454c77d153",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: XRP phishing site (ripple.com.pt) proceeds exchanged to ETH via Coinswitch; entry dated 2020-11-14",
  },
  {
    address: "0x7f85a82a2da50540412f6e526f1d00a0690a77b8",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: XRP phishing site (ripple.com.pt) proceeds exchanged to ETH via Coinswitch; entry dated 2020-11-14",
  },
  {
    address: "0x08389b19ad52f0d983609ab785b3a43a0e90355f",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: scam address for fake Twitter accounts and fake giveaways; entry dated 2018-05-01",
  },
  {
    address: "0xd0cc2b24980cbcca47ef755da88b220a82291407",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: myelherwallel.com wallet; entry dated 2017-07-31",
  },
  {
    address: "0xdafc2a2d4e070f863cfcb5887bc2516e05e18877",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: fake MyEtherWallet; entry dated 2018-03-12",
  },
  {
    address: "0x8444173280e5fdc0525494638123b014cffcc521",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: fake giveaway site asking users to pay miner fees; entry dated 2018-03-12",
  },
  {
    address: "0x5d82db63cf0c54d47006d416bdc7dab09ea2f3f1",
    source: "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
    readDate: "2026-11-22",
    note: "MEW darklist: trust-trading scam; entry dated 2018-03-12",
  },
  {
    address: "0x0b5126e1bc27c0de77e02e97945760a674edb034",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0230",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0230: Base attacker EOA, corroborated by GoPlus Security and PeckShield; BaseScan carries a phishing label",
  },
  {
    address: "0xcdfe91301356da873562ef513828a60dba1f569d",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0230",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0230: Base exploit contract added to a vault borrow allowlist (GoPlus Security)",
  },
  {
    address: "0x616000e384ef1c2b52f5f3a88d57a3b64f23757e",
    source: "https://www.cryptotimes.io/2026/01/26/security-alert-matcha-meta-flags-swapnet-bug-as-over-16-8m-is-drained/",
    readDate: "2026-11-22",
    note: "SwapNet router named in Matcha Meta advisory coverage; BaseScan public name tag reads SwapNet: Router. The live article returned HTTP 403 to automated fetch, so the text was verified via its Internet Archive snapshot of 2026-01-26",
  },
  {
    address: "0xc9002a87e2e3efdcc26cfb0bc9034b919d38fb03",
    source: "https://chainabuse.com/report/cb8aee84-bd78-440f-baa6-6c667e01e6c7",
    readDate: "2026-11-22",
    note: "Chainabuse CONTRACT_EXPLOIT report: 41.62 USDC drained on Base from 10 OLA/Endura wallets via EIP-7702 executeWithSig, 2026-10-08",
  },
  {
    address: "0x101a548bcda171b5f00179aaca0ac32074a2b86a",
    source: "https://chainabuse.com/report/cb8aee84-bd78-440f-baa6-6c667e01e6c7",
    readDate: "2026-11-22",
    note: "Chainabuse CONTRACT_EXPLOIT report: forwarder that received 1 USDC from the 2026-10-08 Base EIP-7702 drain",
  },
  {
    address: "0x678245175aae05ba3301a7812a38f1a2592a97a8",
    source: "https://chainabuse.com/report/274b2b90-ce4c-4c3b-80a8-0d456dc2f3d9",
    readDate: "2026-11-22",
    note: "Chainabuse OTHER_HACK report: Base wallet compromise, 195 USDC, reported July 2026",
  },
  {
    address: "0x9cc58d06f299f2a37050403eb9c90482f38ee3ad",
    source: "https://chainabuse.com/report/bb964330-cc85-4325-81dc-178b0928d925",
    readDate: "2026-11-22",
    note: "Chainabuse CONTRACT_EXPLOIT report: receiver named in a Bitget Swap2 approval-drain incident, 2026-10-22",
  },
  {
    address: "0x012f89ff307568f8409bbe379ca92ed41bc4d386",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0292",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0292: Step Drainer payout wallet, 55% share; same address across EVM chains per Bitquery",
  },
  {
    address: "0x7bf2037264efbff55bd52777772779c1d9e87695",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0292",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0292: Step Drainer payout wallet, 30% share; same address across EVM chains per Bitquery",
  },
  {
    address: "0x5aff449b63c033df386af0c45384cd20c5918dbf",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0292",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0292: Step Drainer payout wallet, 15% share; same address across EVM chains per Bitquery",
  },
  {
    address: "0xe485e7a70b1131216cb47ca4555c4bbb2c742478",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0303",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0303: Mercado Bitcoin incident destination address, confirmed by Mercado Bitcoin; also flagged on Base, Arbitrum and Optimism in 0xCERT-2026-0308",
  },
  {
    address: "0xb7ec7ef24fd73f3000c651ca9d0fa45b61dcf854",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0314",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0314: EVM address named by Loopscale in connection with the attack campaign; the feed does not state the chain",
  },
  {
    address: "0xb8959aca4e4c796a3bada66833eae60b1bc0bfb2",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0314",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0314: EVM address named by Loopscale in connection with the attack campaign; the feed does not state the chain",
  },
  {
    address: "0xd3565b191b28b49cc517189b984dacdb1ff05304",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0309",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0309: attacker EOA that sent the CoreVault exploit transaction on BNB Chain (CertiK-cited)",
  },
  {
    address: "0xc28cfeee046e1421e9dbfb2cf689074bf9f387e2",
    source: "https://www.0xcert.com/advisory/0xCERT-2026-0309",
    readDate: "2026-11-22",
    note: "0xCERT-2026-0309: exploit contract created by the CoreVault attacker on BNB Chain",
  },
]);

/** The deny set itself, derived from the cited entries so an address cannot exist without a citation slot. */
export const KNOWN_DRAINERS: readonly string[] = Object.freeze(DRAINER_ENTRIES.map((entry) => entry.address));

/**
 * Non-receivable sinks — **not** drainers, and deliberately not listed as such.
 *
 * `0x…dEaD` sat in the curated drainer list until 2026-11-17. It is not a drainer: nobody collects from
 * it, funds sent to it are destroyed. The refusal was right and the reason was wrong, and a public list
 * that calls a burn address a thief is a credibility problem rather than a coverage one.
 *
 * Kept separate so both facts survive: paying a sink is still `do_not_pay`, and the reason says "funds are
 * destroyed", which is what actually happens. Anything test-only belongs in a fixture, never here.
 */
export const NON_RECEIVABLE: readonly string[] = Object.freeze([
  // Canonical burn sentinel.
  "0x000000000000000000000000000000000000dead",
  // The zero address: also a sink, and what a payee field looks like when it was never filled in.
  "0x0000000000000000000000000000000000000000",
]);

const NON_RECEIVABLE_SET: ReadonlySet<string> = new Set(NON_RECEIVABLE.map((a) => a.toLowerCase()));

export function isNonReceivable(addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0) return false;
  return NON_RECEIVABLE_SET.has(addr.toLowerCase());
}

const SET: ReadonlySet<string> = new Set(
  KNOWN_DRAINERS.map((a) => a.toLowerCase()),
);

export function isKnownDrainer(addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0) return false;
  return SET.has(addr.toLowerCase());
}

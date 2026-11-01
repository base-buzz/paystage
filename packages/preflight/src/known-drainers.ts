// Curated hard-deny payees. Matching is checksum-agnostic (lowercase).
// See KNOWN_DRAINERS.md for curation policy and how to extend.

export interface KnownDrainerSource {
  name: string;
  url: string;
  retrieved: string;
}

export const SOURCES: readonly KnownDrainerSource[] = [
  {
    name: "MyEtherWallet ethereum-lists address darklist",
    url: "https://github.com/MyEtherWallet/ethereum-lists/blob/master/src/addresses/addresses-darklist.json",
    retrieved: "2026-11-02",
  },
  {
    name: "MetaMask eth-phishing-detect (domain list; related ecosystem)",
    url: "https://github.com/MetaMask/eth-phishing-detect",
    retrieved: "2026-11-02",
  },
  {
    name: "Ethereum burn / non-receivable sentinel 0x…dEaD",
    url: "https://etherscan.io/address/0x000000000000000000000000000000000000dead",
    retrieved: "2026-11-02",
  },
  {
    name: "0xCERT IOC address feed (Base incidents incl. 0xCERT-2026-0230)",
    url: "https://www.0xcert.com/iocs",
    retrieved: "2026-11-02",
  },
  {
    name: "Matcha Meta / CryptoTimes SwapNet approval-drain advisory",
    url: "https://www.cryptotimes.io/2026/01/26/security-alert-matcha-meta-flags-swapnet-bug-as-over-16-8m-is-drained/",
    retrieved: "2026-11-02",
  },
  {
    name: "Chainabuse contract-exploit reports (Base EIP-7702 / USDC drains)",
    url: "https://chainabuse.com/category/contract-exploit",
    retrieved: "2026-11-02",
  },
  {
    name: "Chainabuse address report (Base USDC theft Jul 2026)",
    url: "https://chainabuse.com/address/0x2cff890f0378a11913b6129b2e97417a2c302680",
    retrieved: "2026-11-02",
  },
];

/**
 * Small curated subset. Do not add addresses without a public citation.
 */
export const KNOWN_DRAINERS: readonly string[] = Object.freeze([
  // Canonical burn address — non-receivable sink (demo + sentinel).
  "0x000000000000000000000000000000000000dead",
  // MEW darklist: "XRP phishing website (ripple.com.pt) this wallet collects funds…"
  "0x09750ad360fdb7a2ee23669c4503c974d86d8694",
  // MEW darklist: XRP phishing website (ripple.com.pt) via Coinswitch
  "0xc915ec7f4cfd1c0a8aba090f03bfaab588aef9b4",
  "0xecb6ffac05d8b4660b99b475b359fe454c77d153",
  "0x7f85a82a2da50540412f6e526f1d00a0690a77b8",
  // MEW darklist: "Scam address for various fake twitter accounts and fake giveaways"
  "0x08389b19ad52f0d983609ab785b3a43a0e90355f",
  // MEW darklist: Fake MEW / myelherwallel.com wallet
  "0xd0cc2b24980cbcca47ef755da88b220a82291407",
  // MEW darklist: Fake MyEtherWallet
  "0xdafc2a2d4e070f863cfcb5887bc2516e05e18877",
  // MEW darklist: Fake giveaway site asking to pay miner fees
  "0x8444173280e5fdc0525494638123b014cffcc521",
  // MEW darklist: Trust-trading scam
  "0x5d82db63cf0c54d47006d416bdc7dab09ea2f3f1",

  // --- Added 2026-11-02 NZDT ---
  // 0xCERT-2026-0230 Base attacker EOA (GoPlus Security; PeckShield); Basescan phishing label
  // https://www.0xcert.com/iocs
  "0x0b5126e1bc27c0de77e02e97945760a674edb034",
  // 0xCERT-2026-0230 Base exploit contract (GoPlus)
  // https://www.0xcert.com/iocs
  "0xcdfe91301356da873562ef513828a60dba1f569d",
  // SwapNet router — Matcha Meta approval-drain advisory (arbitrary call); CryptoTimes 2026-01-26; Basescan Exploit
  // https://www.cryptotimes.io/2026/01/26/security-alert-matcha-meta-flags-swapnet-bug-as-over-16-8m-is-drained/
  "0x616000e384ef1c2b52f5f3a88d57a3b64f23757e",
  // Chainabuse Base EIP-7702 drain 2026-10-08; Basescan phishing
  // https://chainabuse.com/category/contract-exploit
  "0xc9002a87e2e3efdcc26cfb0bc9034b919d38fb03",
  // Chainabuse Base drain forwarder 2026-10-08
  // https://chainabuse.com/category/contract-exploit
  "0x101a548bcda171b5f00179aaca0ac32074a2b86a",
  // Chainabuse Base USDC theft Jul 2026
  // https://chainabuse.com/address/0x2cff890f0378a11913b6129b2e97417a2c302680
  "0x678245175aae05ba3301a7812a38f1a2592a97a8",
  // Chainabuse reported drain receiver (Bitget Swap2 incident report)
  // https://chainabuse.com/category/contract-exploit
  "0x9cc58d06f299f2a37050403eb9c90482f38ee3ad",
]);

const SET: ReadonlySet<string> = new Set(
  KNOWN_DRAINERS.map((a) => a.toLowerCase()),
);

export function isKnownDrainer(addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0) return false;
  return SET.has(addr.toLowerCase());
}

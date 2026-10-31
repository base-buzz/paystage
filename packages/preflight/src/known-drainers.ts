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
    retrieved: "2026-11-01",
  },
  {
    name: "MetaMask eth-phishing-detect (domain list; related ecosystem)",
    url: "https://github.com/MetaMask/eth-phishing-detect",
    retrieved: "2026-11-01",
  },
  {
    name: "Ethereum burn / non-receivable sentinel 0x…dEaD",
    url: "https://etherscan.io/address/0x000000000000000000000000000000000000dead",
    retrieved: "2026-11-01",
  },
];

/**
 * Small curated subset. Each entry other than dEaD is taken from the MEW
 * addresses-darklist.json with the comment preserved in the adjacent note.
 * Do not add addresses without a public citation.
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
]);

const SET: ReadonlySet<string> = new Set(
  KNOWN_DRAINERS.map((a) => a.toLowerCase()),
);

export function isKnownDrainer(addr: string): boolean {
  if (typeof addr !== "string" || addr.length === 0) return false;
  return SET.has(addr.toLowerCase());
}

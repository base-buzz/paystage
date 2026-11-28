#!/usr/bin/env node
/**
 * Gas on Base is a distribution, and our band's floor was quoted from one reading (#493).
 *
 * `$0.002–$0.50` rests on a single `0.006395 gwei` measurement, so "at 30 gwei the floor rises 20×" is a sentence we have never
 * quantified. This samples `eth_feeHistory` over a stated number of blocks, reports p50 / p90 / max with the ETH price used, and says
 * which of them the published band should quote — the p90, because a floor that holds only half the time is not a floor.
 *
 *   node bin/gas-distribution.mjs                  # 1,000 blocks (~33 minutes on Base)
 *   node bin/gas-distribution.mjs --blocks 14400   # ~8 hours
 *   node bin/gas-distribution.mjs --json
 *
 * Exit 0 measured · 2 the RPC or the price feed is unreadable · 10 the sample is too small to say anything (fewer than 100 blocks).
 *
 * Read-only. No wallet, no key, no transaction.
 */
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
const PRICE_URL = process.env.ETH_PRICE_URL || "https://api.coinbase.com/v2/prices/ETH-USD/spot";
/** A USDC `transferWithAuthorization` measured on Base; the number our economics page quotes. */
const GAS_UNITS = Number(process.env.GAS_UNITS || 65_000);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const BLOCKS = Math.max(100, Number(arg("blocks", 1000)));
const JSON_OUT = process.argv.includes("--json");

const rpc = async (method, params) => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
};

let head;
let history;
let ethUsd;
try {
  head = Number(await rpc("eth_blockNumber", []));
  /**
   * Public RPCs truncate `eth_feeHistory` — a 14,400-block request returned 1,025 blocks, which would have been reported as an
   * eight-hour sample. So the range is paged backwards in 1,000-block calls and the **actual coverage** is what gets reported: a
   * distribution that silently measures 33 minutes while claiming a day is worse than the single reading it replaces.
   */
  history = { baseFeePerGas: [] };
  let cursor = head;
  const CHUNK = 1000;
  while (history.baseFeePerGas.length < BLOCKS && cursor > 0) {
    const want = Math.min(CHUNK, BLOCKS - history.baseFeePerGas.length);
    const page = await rpc("eth_feeHistory", ["0x" + want.toString(16), "0x" + cursor.toString(16), []]);
    const fees = page?.baseFeePerGas ?? [];
    if (fees.length === 0) break;
    history.baseFeePerGas = [...fees, ...history.baseFeePerGas];
    cursor -= fees.length - 1;
    if (fees.length < 2) break;
  }
  const price = await fetch(PRICE_URL).then((r) => r.json());
  ethUsd = Number(price?.data?.amount);
} catch (error) {
  console.error(`gas-distribution: could not measure (${error instanceof Error ? error.message : String(error)}) — no number invented`);
  process.exit(2);
}

if (!Number.isFinite(ethUsd) || ethUsd <= 0) {
  console.error("gas-distribution: the ETH price feed answered something unusable — the dollar figures would be guesses");
  process.exit(2);
}

const baseFees = (history?.baseFeePerGas ?? []).map((hex) => Number(BigInt(hex)) / 1e9); // gwei
if (baseFees.length < 100) {
  console.error(`gas-distribution: only ${baseFees.length} block(s) sampled — too few to describe a distribution`);
  process.exit(10);
}

const sorted = [...baseFees].sort((a, b) => a - b);
const pct = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
const toUsd = (gwei) => (GAS_UNITS * gwei * 1e-9 * ethUsd);

const stats = {
  sampledAt: new Date().toISOString(),
  rpc: RPC,
  blocksRequested: BLOCKS,
  blocks: sorted.length,
  truncated: sorted.length < BLOCKS,
  head,
  oldestBlock: head - sorted.length + 1,
  ethUsd,
  gasUnits: GAS_UNITS,
  gwei: { p10: pct(10), p50: pct(50), p90: pct(90), max: sorted.at(-1) },
  usd: { p10: toUsd(pct(10)), p50: toUsd(pct(50)), p90: toUsd(pct(90)), max: toUsd(sorted.at(-1)) },
};

/**
 * The comparison the row asks for: does the p90 sit within 10% of the single reading our band quotes today ($0.00065 at 0.006 gwei)?
 * If it does, one number was enough and the row's own drop condition applies.
 */
const QUOTED_USD = 0.00065;
stats.p90Within10pctOfQuoted = Math.abs(stats.usd.p90 - QUOTED_USD) <= QUOTED_USD * 0.1;

if (JSON_OUT) {
  console.log(JSON.stringify(stats, null, 1));
} else {
  console.log(
    `gas-distribution: ${stats.blocks} blocks (${stats.oldestBlock}..${stats.head}) · ETH $${ethUsd.toFixed(2)} · ` +
      `${GAS_UNITS.toLocaleString("en-US")} gas/transfer`,
  );
  console.log(
    `  gwei   p10 ${stats.gwei.p10.toFixed(6)} · p50 ${stats.gwei.p50.toFixed(6)} · p90 ${stats.gwei.p90.toFixed(6)} · max ${stats.gwei.max.toFixed(6)}`,
  );
  console.log(
    `  USD    p10 $${stats.usd.p10.toFixed(6)} · p50 $${stats.usd.p50.toFixed(6)} · p90 $${stats.usd.p90.toFixed(6)} · max $${stats.usd.max.toFixed(6)}`,
  );
  console.log(
    `  quoted floor $${QUOTED_USD.toFixed(6)} vs measured p90 $${stats.usd.p90.toFixed(6)} — ` +
      (stats.p90Within10pctOfQuoted ? "within 10%, so the single reading was enough" : "not within 10%, so the band should quote the p90"),
  );
  console.log(
    `  a $0.002 call pays ${((stats.usd.p90 / 0.002) * 100).toFixed(1)}% of its price in gas at p90, ` +
      `${((stats.usd.max / 0.002) * 100).toFixed(1)}% at the sample's worst block`,
  );
}

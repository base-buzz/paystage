#!/usr/bin/env node
/**
 * The gas wallet is the one thing that can silently break revenue after `FACILITATOR_MODE=self`.
 *
 * Verification is read-only and keeps working with an empty wallet, but `/settle` needs gas. A
 * balance that reaches zero therefore looks like "the facilitator is up" while every payment
 * quietly returns `success: false`. Nothing on chain reports that, and nothing in the app reads
 * the balance, so this script is the check.
 *
 *   node scripts/check-facilitator-gas.mjs
 *
 * Exit 0 the balance is at or above the floor · 10 it is below · 2 Base's RPC could not be read
 * (unknown, not a verdict — `ci-local` runs this advisory, so an RPC outage never fails a build).
 *
 * Read-only: one `eth_getBalance` and one `eth_gasPrice`. No wallet, no key, no transaction.
 */
const RPC = process.env.BASE_RPC_URL || "https://mainnet.base.org";
/** The gas wallet named in docs/runbooks/self-facilitator.md; holds gas only, never customer USDC. */
const ADDRESS = "0x680228D4915ad9f46C1cF72e1D80370b56a42405";
/**
 * ~800 settlements at the 0.006 gwei of the first mainnet settlement. Gas price moves, so the
 * threshold is in ETH and the settlement count is reported at today's price; the floor is what
 * this check gates on, not a predicted count.
 */
const FLOOR_WEI = 500_000_000_000_000n; // 0.0005 ETH
/** Gas used by the first mainnet `transferWithAuthorization` (runbook, 2026-11-28), for the estimate only. */
const GAS_UNITS = 85_720n;

const rpc = async (method, params) => {
  const res = await fetch(RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${method}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(`${method}: ${body.error.message ?? JSON.stringify(body.error)}`);
  return body.result;
};

const eth = (wei, decimals = 6) => (Number(wei) / 1e18).toFixed(decimals);

let balance;
let gasPrice;
try {
  [balance, gasPrice] = await Promise.all([
    rpc("eth_getBalance", [ADDRESS, "latest"]),
    rpc("eth_gasPrice", []),
  ]);
  balance = BigInt(balance);
  gasPrice = BigInt(gasPrice);
  if (gasPrice <= 0n) throw new Error("eth_gasPrice returned 0");
} catch (error) {
  console.error(
    `facilitator-gas: could not read Base (${error instanceof Error ? error.message : String(error)}) — unknown, not a verdict`,
  );
  process.exit(2);
}

const perSettlement = gasPrice * GAS_UNITS;
const settlementsLeft = balance / perSettlement;
const settlementsToFloor = balance <= FLOOR_WEI ? 0n : (balance - FLOOR_WEI) / perSettlement;
const gwei = (Number(gasPrice) / 1e9).toFixed(6);

const short = `${ADDRESS.slice(0, 6)}…${ADDRESS.slice(-4)}`;
console.log(
  `facilitator-gas: ${short} on Base holds ${eth(balance)} ETH (${balance.toString()} wei); floor ${eth(FLOOR_WEI)} ETH`,
);
console.log(
  `  at ${gwei} gwei × ${GAS_UNITS.toString()} gas ≈ ${eth(perSettlement, 9)} ETH/settlement → ≈ ${settlementsLeft.toString()} settlements left, ${settlementsToFloor.toString()} before the floor`,
);

if (balance < FLOOR_WEI) {
  console.error(
    `facilitator-gas: BELOW FLOOR — /settle will start failing when gas runs out. Refill from the treasury (operator decision) or set FACILITATOR_MODE=cdp.`,
  );
  process.exit(10);
}
console.log("facilitator-gas: above the floor");

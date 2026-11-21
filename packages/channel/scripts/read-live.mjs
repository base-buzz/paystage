#!/usr/bin/env node
/**
 * Read one x402 deposit channel on Base mainnet. Read-only: this script only
 * sends `eth_call`.
 *
 *   npm run build -w @paystage/channel
 *   node packages/channel/scripts/read-live.mjs <channelId> [options]
 *
 * Options:
 *   --address <0x...>            batch-settlement contract (default: x402 Base address)
 *   --rpc <url>                  RPC endpoint (default: PAYSTAGE_RPC_URL or mainnet.base.org)
 *   --withdraw-delay <seconds>   ChannelConfig.withdrawDelay, to compute expiry
 *   --signed-max-claimable <n>   cumulative ceiling from a voucher you already hold
 *                                (not readable from the chain)
 */
import { readChannel, createRpcClient } from "../dist/index.js";

const args = process.argv.slice(2);
if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
  console.error(
    "usage: node packages/channel/scripts/read-live.mjs <channelId> [--address 0x..] [--rpc url] [--withdraw-delay n] [--signed-max-claimable n]",
  );
  process.exit(2);
}

const channelId = args[0];
const opts = { address: undefined, rpcUrl: undefined, withdrawDelay: undefined, signedMaxClaimable: undefined };
for (let i = 1; i < args.length; i += 2) {
  const key = args[i];
  const value = args[i + 1];
  if (value === undefined) {
    console.error(`missing value for ${key}`);
    process.exit(2);
  }
  if (key === "--address") opts.address = value;
  else if (key === "--rpc") opts.rpcUrl = value;
  else if (key === "--withdraw-delay") opts.withdrawDelay = Number(value);
  else if (key === "--signed-max-claimable") opts.signedMaxClaimable = value;
  else {
    console.error(`unknown option ${key}`);
    process.exit(2);
  }
}

if (!opts.rpcUrl && process.env.PAYSTAGE_RPC_URL) {
  opts.rpcUrl = process.env.PAYSTAGE_RPC_URL;
}

const reading = await readChannel({
  channelId,
  chain: "eip155:8453",
  address: opts.address,
  client: opts.rpcUrl ? createRpcClient(opts.rpcUrl) : undefined,
  withdrawDelay: opts.withdrawDelay,
  signedMaxClaimable: opts.signedMaxClaimable,
});

const show = (value) => (typeof value === "bigint" ? value.toString() : value);
console.log(`contract          ${reading.contract} (${reading.network})`);
console.log(`channelId         ${reading.channelId}`);
console.log(`balance           ${show(reading.balance)}`);
console.log(`signedMaxClaimable ${reading.signedMaxClaimable === null ? "unassessed (off-chain voucher; pass --signed-max-claimable)" : show(reading.signedMaxClaimable)}`);
console.log(`withdrawRequestedAt ${reading.withdrawRequestedAt}`);
console.log(`expiry            ${reading.expiry === null ? "null" : reading.expiry}`);
console.log(`totalClaimed      ${show(reading.totalClaimed)}`);
console.log(`pendingWithdrawal ${show(reading.pendingWithdrawalAmount)}`);
console.log(`raw.channels      ${reading.raw.channels}`);
console.log(`raw.pending       ${reading.raw.pendingWithdrawals}`);
if (reading.unavailable.length > 0) {
  for (const note of reading.unavailable) console.log(`note: ${note}`);
}

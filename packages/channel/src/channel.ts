import {
  BATCH_SETTLEMENT_ADDRESS,
  CHANNELS_SELECTOR,
  PENDING_WITHDRAWALS_SELECTOR,
} from "./constants.js";
import {
  createRpcClient,
  resolveChain,
  resolveRpcUrl,
  type ChainLike,
  type JsonRpcClient,
} from "./rpc.js";

const BYTES32 = /^0x[0-9a-fA-F]{64}$/;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const WORD = /^[0-9a-fA-F]{64}$/;

export interface ReadChannelOptions {
  /**
   * The batch-settlement contract. Defaults to the x402 address verified on
   * Base and Base Sepolia. This is **not** a per-channel address: one contract
   * stores every channel under a bytes32 `channelId`.
   */
  address?: string;
  /** Channel id (`bytes32`), e.g. from a deposit transaction or the 402 extra. */
  channelId: string;
  /** `eip155:8453` / 8453 / `base`, or `eip155:84532` / 84532 / `base-sepolia`. */
  chain: ChainLike;
  /** Injected JSON-RPC client (tests, or a custom transport). */
  client?: JsonRpcClient;
  /** Explicit RPC URL; ignored when `client` is given. */
  rpcUrl?: string;
  /**
   * Cumulative ceiling from the latest signed voucher. This value is **not**
   * on chain — it only exists in the voucher signature held by the payer or
   * server — so it cannot be recovered by `eth_call`. Omit it and the field is
   * returned as `null` with a note; supply it from the voucher you already hold.
   */
  signedMaxClaimable?: bigint | string | number;
  /**
   * `ChannelConfig.withdrawDelay` in seconds. Needed only to turn
   * `withdrawRequestedAt` into the unlock time; omit it and `expiry` is `null`
   * while a withdrawal is pending.
   */
  withdrawDelay?: number;
}

export interface ChannelReading {
  channelId: string;
  network: string;
  contract: string;
  /** Deposited, not-yet-claimed balance, in token base units. */
  balance: bigint;
  /** From a signed voucher, when supplied. Never read from the chain. */
  signedMaxClaimable: bigint | null;
  /** `pendingWithdrawals(channelId).initiatedAt`, unix seconds; 0 when none. */
  withdrawRequestedAt: number;
  /**
   * `withdrawRequestedAt + withdrawDelay` when a withdrawal is pending and the
   * delay is known; otherwise `null`.
   */
  expiry: number | null;
  /** Informational: total already claimed from this channel. */
  totalClaimed: bigint;
  /** Amount queued by `initiateWithdraw`, in token base units. */
  pendingWithdrawalAmount: bigint;
  /** Raw `eth_call` results, hex, for debugging and reproduction. */
  raw: {
    channels: string;
    pendingWithdrawals: string;
  };
  /** Values this read could not obtain, and why. Empty means all four fields resolved. */
  unavailable: string[];
}

function requireBytes32(value: string, label: string): string {
  if (!BYTES32.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed 32-byte hex string`);
  }
  return value.toLowerCase();
}

function requireAddress(value: string, label: string): string {
  if (!ADDRESS.test(value)) {
    throw new Error(`${label} must be a 0x-prefixed 20-byte hex string`);
  }
  return value.toLowerCase();
}

function wordAt(hex: string, index: number): string {
  const body = hex.slice(2);
  const word = body.slice(index * 64, (index + 1) * 64);
  if (!WORD.test(word)) {
    throw new Error(`Malformed eth_call response: expected at least ${index + 1} 32-byte word(s)`);
  }
  return word;
}

function parseUintWord(hex: string, index: number): bigint {
  return BigInt(`0x${wordAt(hex, index)}`);
}

function parseOptionalBigInt(
  value: bigint | string | number | undefined,
  label: string,
): bigint | null {
  if (value === undefined) return null;
  const parsed = typeof value === "bigint" ? value : BigInt(value);
  if (parsed < 0n) throw new Error(`${label} must be non-negative`);
  return parsed;
}

function callData(selector: string, channelId: string): string {
  return `${selector}${channelId.slice(2)}`;
}

async function ethCall(
  client: JsonRpcClient,
  to: string,
  data: string,
): Promise<string> {
  const result = await client.request("eth_call", [{ to, data }, "latest"]);
  if (typeof result !== "string" || !result.startsWith("0x")) {
    throw new Error("eth_call returned a non-hex result");
  }
  if (result === "0x") {
    throw new Error("eth_call returned empty data; wrong contract or channel id?");
  }
  return result;
}

/**
 * Reads one x402 deposit channel. Two view calls, no signing, no sending.
 *
 * `balance` and `withdrawRequestedAt` come from the batch-settlement contract.
 * `signedMaxClaimable` cannot: it is the cumulative ceiling in an off-chain
 * voucher signature. `expiry` is derived from the on-chain withdrawal request
 * plus the caller-supplied `withdrawDelay`.
 */
export async function readChannel(
  options: ReadChannelOptions,
): Promise<ChannelReading> {
  const chain = resolveChain(options.chain);
  const contract = requireAddress(
    options.address ?? BATCH_SETTLEMENT_ADDRESS,
    "address",
  );
  const channelId = requireBytes32(options.channelId, "channelId");
  const signedMaxClaimable = parseOptionalBigInt(
    options.signedMaxClaimable,
    "signedMaxClaimable",
  );
  if (
    options.withdrawDelay !== undefined &&
    (!Number.isFinite(options.withdrawDelay) || options.withdrawDelay < 0)
  ) {
    throw new Error("withdrawDelay must be a non-negative number of seconds");
  }

  const client =
    options.client ?? createRpcClient(options.rpcUrl ?? resolveRpcUrl(chain.network));

  const channelsRaw = await ethCall(
    client,
    contract,
    callData(CHANNELS_SELECTOR, channelId),
  );
  const pendingRaw = await ethCall(
    client,
    contract,
    callData(PENDING_WITHDRAWALS_SELECTOR, channelId),
  );

  const balance = parseUintWord(channelsRaw, 0);
  const totalClaimed = parseUintWord(channelsRaw, 1);
  const pendingWithdrawalAmount = parseUintWord(pendingRaw, 0);
  const initiatedAtRaw = parseUintWord(pendingRaw, 1);
  const withdrawRequestedAt = Number(initiatedAtRaw);

  const unavailable: string[] = [];
  if (signedMaxClaimable === null) {
    unavailable.push(
      "signedMaxClaimable is in an off-chain cumulative voucher signature, not in contract storage; pass it from the voucher you hold",
    );
  }

  let expiry: number | null = null;
  if (withdrawRequestedAt > 0) {
    if (options.withdrawDelay === undefined) {
      unavailable.push(
        "expiry needs ChannelConfig.withdrawDelay; pass withdrawDelay (seconds) to compute it",
      );
    } else {
      expiry = withdrawRequestedAt + options.withdrawDelay;
    }
  }

  return {
    channelId,
    network: chain.network,
    contract,
    balance,
    signedMaxClaimable,
    withdrawRequestedAt,
    expiry,
    totalClaimed,
    pendingWithdrawalAmount,
    raw: { channels: channelsRaw, pendingWithdrawals: pendingRaw },
    unavailable,
  };
}

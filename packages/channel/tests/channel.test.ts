import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it, expect } from "vitest";
import {
  readChannel,
  BATCH_SETTLEMENT_ADDRESS,
  CHANNELS_SELECTOR,
  PENDING_WITHDRAWALS_SELECTOR,
  type JsonRpcClient,
} from "../src/index.js";
import {
  RECORDED_CHANNEL_ID,
  RECORDED_CHANNELS_HEX,
  RECORDED_PENDING_WITHDRAWALS_HEX,
  SYNTHETIC_PENDING_WITHDRAWALS_HEX,
  VOUCHER_SIGNED_MAX_CLAIMABLE,
} from "./fixtures.js";

interface RecordedCall {
  method: string;
  to: string;
  data: string;
}

function mockRpc(
  channels: string,
  pending: string,
): { client: JsonRpcClient; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const client: JsonRpcClient = {
    async request(method: string, params: unknown[]): Promise<unknown> {
      const call = params[0] as { to: string; data: string };
      calls.push({ method, to: call.to, data: call.data });
      if (method !== "eth_call") throw new Error(`unexpected RPC method ${method}`);
      if (call.data.startsWith(CHANNELS_SELECTOR)) return channels;
      if (call.data.startsWith(PENDING_WITHDRAWALS_SELECTOR)) return pending;
      throw new Error(`unexpected call data ${call.data}`);
    },
  };
  return { client, calls };
}

describe("readChannel against a recorded eth_call", () => {
  it("decodes balance, withdrawRequestedAt, totalClaimed and the pending amount", async () => {
    const { client } = mockRpc(
      RECORDED_CHANNELS_HEX,
      RECORDED_PENDING_WITHDRAWALS_HEX,
    );
    const reading = await readChannel({
      channelId: RECORDED_CHANNEL_ID,
      chain: "eip155:8453",
      client,
    });

    expect(reading.balance).toBe(20_001_600n);
    expect(reading.totalClaimed).toBe(19_958_880n);
    expect(reading.withdrawRequestedAt).toBe(0);
    expect(reading.pendingWithdrawalAmount).toBe(0n);
    expect(reading.expiry).toBeNull();
    expect(reading.raw.channels).toBe(RECORDED_CHANNELS_HEX);
    expect(reading.raw.pendingWithdrawals).toBe(RECORDED_PENDING_WITHDRAWALS_HEX);
    expect(reading.contract).toBe(BATCH_SETTLEMENT_ADDRESS.toLowerCase());
    expect(reading.network).toBe("eip155:8453");
  });

  it("returns signedMaxClaimable as null and says why, because it is not on chain", async () => {
    const { client } = mockRpc(
      RECORDED_CHANNELS_HEX,
      RECORDED_PENDING_WITHDRAWALS_HEX,
    );
    const reading = await readChannel({
      channelId: RECORDED_CHANNEL_ID,
      chain: 8453,
      client,
    });

    expect(reading.signedMaxClaimable).toBeNull();
    expect(reading.unavailable.join(" ")).toContain("off-chain cumulative voucher");
  });

  it("uses a supplied voucher value for signedMaxClaimable without claiming it came from the chain", async () => {
    const { client } = mockRpc(
      RECORDED_CHANNELS_HEX,
      RECORDED_PENDING_WITHDRAWALS_HEX,
    );
    const reading = await readChannel({
      channelId: RECORDED_CHANNEL_ID,
      chain: "base",
      client,
      signedMaxClaimable: VOUCHER_SIGNED_MAX_CLAIMABLE,
    });

    expect(reading.signedMaxClaimable).toBe(25_000_000n);
    expect(reading.unavailable).toEqual([]);
  });

  it("calls only the two view selectors, with eth_call, at the configured contract", async () => {
    const { client, calls } = mockRpc(
      RECORDED_CHANNELS_HEX,
      RECORDED_PENDING_WITHDRAWALS_HEX,
    );
    await readChannel({
      channelId: RECORDED_CHANNEL_ID,
      chain: "eip155:8453",
      client,
    });

    expect(calls).toHaveLength(2);
    expect(calls.every((c) => c.method === "eth_call")).toBe(true);
    expect(calls[0].data).toBe(`${CHANNELS_SELECTOR}${RECORDED_CHANNEL_ID.slice(2)}`);
    expect(calls[1].data).toBe(
      `${PENDING_WITHDRAWALS_SELECTOR}${RECORDED_CHANNEL_ID.slice(2)}`,
    );
    expect(calls[0].to).toBe(BATCH_SETTLEMENT_ADDRESS.toLowerCase());
  });

  it("computes expiry from a SYNTHETIC pending withdrawal and a supplied withdraw delay", async () => {
    const { client } = mockRpc(
      RECORDED_CHANNELS_HEX,
      SYNTHETIC_PENDING_WITHDRAWALS_HEX,
    );
    const reading = await readChannel({
      channelId: RECORDED_CHANNEL_ID,
      chain: "eip155:8453",
      client,
      withdrawDelay: 86_400,
    });

    expect(reading.withdrawRequestedAt).toBe(1_700_000_000);
    expect(reading.pendingWithdrawalAmount).toBe(5_000_000n);
    expect(reading.expiry).toBe(1_700_086_400);
  });

  it("says expiry is unavailable when a withdrawal is pending but the delay is unknown", async () => {
    const { client } = mockRpc(
      RECORDED_CHANNELS_HEX,
      SYNTHETIC_PENDING_WITHDRAWALS_HEX,
    );
    const reading = await readChannel({
      channelId: RECORDED_CHANNEL_ID,
      chain: "eip155:8453",
      client,
    });

    expect(reading.expiry).toBeNull();
    expect(reading.unavailable.join(" ")).toContain("withdrawDelay");
  });

  it("rejects malformed inputs before any RPC call", async () => {
    const { client, calls } = mockRpc(
      RECORDED_CHANNELS_HEX,
      RECORDED_PENDING_WITHDRAWALS_HEX,
    );
    await expect(
      readChannel({ channelId: "0x1234", chain: "eip155:8453", client }),
    ).rejects.toThrow(/channelId/);
    await expect(
      readChannel({
        channelId: RECORDED_CHANNEL_ID,
        chain: "eip155:1",
        client,
      }),
    ).rejects.toThrow(/Unsupported chain/);
    expect(calls).toHaveLength(0);
  });

  it("rejects an empty eth_call result instead of decoding zeroes", async () => {
    const { client } = mockRpc("0x", "0x");
    await expect(
      readChannel({
        channelId: RECORDED_CHANNEL_ID,
        chain: "eip155:8453",
        client,
      }),
    ).rejects.toThrow(/empty data/);
  });
});

/**
 * Crude but honest: the safety claim is that this package has no signing or
 * sending path. Scan the source for the words that would create one.
 */
describe("no write path", () => {
  const readAll = (relative: string): string => {
    const dir = fileURLToPath(new URL(relative, import.meta.url));
    return readdirSync(dir)
      .filter((name) => /\.(ts|mjs|js)$/.test(name))
      .map((name) => readFileSync(join(dir, name), "utf8"))
      .join("\n");
  };
  const source = [readAll("../src/"), readAll("../scripts/")].join("\n");

  const forbidden = [
    "walletClient",
    "writeContract",
    "sendTransaction",
    "sendRawTransaction",
    "privateKey",
    "private_key",
    "mnemonic",
    "signTypedData",
    "signMessage",
    "signTransaction",
    "eth_sendTransaction",
    "eth_sign",
  ];

  it("contains none of the signing/sending identifiers", () => {
    const hits = forbidden.filter((token) => source.includes(token));
    expect(hits).toEqual([]);
  });

  it("declares no runtime dependency that could sign", () => {
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    ) as { dependencies?: Record<string, string> };
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});

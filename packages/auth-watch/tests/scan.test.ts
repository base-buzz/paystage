import { describe, it, expect } from "vitest";
import { listOutstandingAuths } from "../src/scan.js";
import type { JsonRpcClient } from "../src/rpc.js";
import { PERMIT2, USDC_BASE } from "../src/constants.js";

function hexUint(value: bigint): string {
  return "0x" + value.toString(16).padStart(64, "0");
}

function hexPermit2(amount: bigint, expiration: number, nonce: number): string {
  return (
    "0x" +
    amount.toString(16).padStart(64, "0") +
    BigInt(expiration).toString(16).padStart(64, "0") +
    BigInt(nonce).toString(16).padStart(64, "0")
  );
}

function mockRpc(handlers: Record<string, string>): JsonRpcClient {
  return {
    async request(method: string, params: unknown[]): Promise<unknown> {
      if (method !== "eth_call") throw new Error(`unexpected method ${method}`);
      const call = params[0] as { to: string; data: string };
      const key = `${call.to.toLowerCase()}:${call.data.toLowerCase()}`;
      const result = handlers[key];
      if (result === undefined) {
        throw new Error(`no mock for ${key}`);
      }
      return result;
    },
  };
}

describe("listOutstandingAuths", () => {
  const wallet = "0x1111111111111111111111111111111111111111";
  const token = "0x2222222222222222222222222222222222222222";
  const spender = "0x3333333333333333333333333333333333333333";

  it("returns erc20 allowance when amount > 0", async () => {
    const data =
      "0xdd62ed3e" +
      wallet.slice(2).padStart(64, "0") +
      spender.slice(2).padStart(64, "0");
    const rpc = mockRpc({
      [`${token.toLowerCase()}:${data.toLowerCase()}`]: hexUint(1000n),
    });
    const items = await listOutstandingAuths({
      wallet,
      network: "eip155:8453",
      tokens: [token],
      spenders: [spender],
      rpc,
      includePermit2: false,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("erc20_allowance");
    expect(items[0].amount).toBe(1000n);
  });

  it("skips zero allowances", async () => {
    const data =
      "0xdd62ed3e" +
      wallet.slice(2).padStart(64, "0") +
      spender.slice(2).padStart(64, "0");
    const rpc = mockRpc({
      [`${token.toLowerCase()}:${data.toLowerCase()}`]: hexUint(0n),
    });
    const items = await listOutstandingAuths({
      wallet,
      network: "eip155:8453",
      tokens: [token],
      spenders: [spender],
      rpc,
      includePermit2: false,
    });
    expect(items).toHaveLength(0);
  });

  it("returns permit2 allowance when amount > 0", async () => {
    const erc20Data =
      "0xdd62ed3e" +
      wallet.slice(2).padStart(64, "0") +
      spender.slice(2).padStart(64, "0");
    const data =
      "0x927da105" +
      wallet.slice(2).padStart(64, "0") +
      token.slice(2).padStart(64, "0") +
      spender.slice(2).padStart(64, "0");
    const rpc = mockRpc({
      [`${token.toLowerCase()}:${erc20Data.toLowerCase()}`]: hexUint(0n),
      [`${PERMIT2.toLowerCase()}:${data.toLowerCase()}`]: hexPermit2(
        500n,
        1700000000,
        7
      ),
    });
    const items = await listOutstandingAuths({
      wallet,
      network: "eip155:8453",
      tokens: [token],
      spenders: [spender],
      rpc,
      includePermit2: true,
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("permit2");
    expect(items[0].amount).toBe(500n);
    expect(items[0].expirationSeconds).toBe(1700000000);
    expect(items[0].nonce).toBe("7");
  });

  it("reports eip3009 authorization state", async () => {
    const nonce =
      "0x0000000000000000000000000000000000000000000000000000000000000001";
    const data =
      "0xe94a0102" +
      wallet.slice(2).padStart(64, "0") +
      nonce.slice(2).padStart(64, "0");
    const rpc = mockRpc({
      [`${USDC_BASE.toLowerCase()}:${data.toLowerCase()}`]: hexUint(1n),
    });
    const items = await listOutstandingAuths({
      wallet,
      network: "eip155:8453",
      tokens: [],
      spenders: [],
      rpc,
      includePermit2: false,
      eip3009Nonces: [nonce],
    });
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe("eip3009");
    expect(items[0].raw).toEqual({ invalidated: true });
  });
});

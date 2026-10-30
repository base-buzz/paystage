// Pure hex helpers. No ethers dependency.

export const SELECTORS = {
  erc20Allowance: "0xdd62ed3e",
  permit2Allowance: "0x927da105",
  usdcAuthorizationState: "0xe94a0102",
} as const;

function strip0x(hex: string): string {
  return hex.startsWith("0x") || hex.startsWith("0X") ? hex.slice(2) : hex;
}

export function padAddress(addr: string): string {
  const clean = strip0x(addr).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(clean)) {
    throw new Error(`Invalid address: ${addr}`);
  }
  return clean.padStart(64, "0");
}

export function padUint256(value: bigint | number | string): string {
  const v = typeof value === "bigint" ? value : BigInt(value);
  if (v < 0n) throw new Error("uint256 cannot be negative");
  return v.toString(16).padStart(64, "0");
}

export function padBytes32(hex: string): string {
  const clean = strip0x(hex).toLowerCase();
  if (!/^[0-9a-f]{1,64}$/.test(clean)) {
    throw new Error(`Invalid bytes32: ${hex}`);
  }
  return clean.padStart(64, "0");
}

export function encodeAllowance(owner: string, spender: string): string {
  return SELECTORS.erc20Allowance + padAddress(owner) + padAddress(spender);
}

export function encodePermit2Allowance(
  owner: string,
  token: string,
  spender: string
): string {
  return (
    SELECTORS.permit2Allowance +
    padAddress(owner) +
    padAddress(token) +
    padAddress(spender)
  );
}

export function encodeAuthorizationState(owner: string, nonce: string): string {
  return SELECTORS.usdcAuthorizationState + padAddress(owner) + padBytes32(nonce);
}

export function decodeUint256(hex: string): bigint {
  const clean = strip0x(hex);
  if (clean.length === 0) return 0n;
  return BigInt("0x" + clean);
}

export interface Permit2Allowance {
  amount: bigint;
  expiration: number;
  nonce: number;
}

export function decodePermit2Allowance(hex: string): Permit2Allowance {
  const clean = strip0x(hex);
  if (clean.length < 64 * 3) {
    // Some nodes return empty for reverts; treat as zero.
    return { amount: 0n, expiration: 0, nonce: 0 };
  }
  const amount = BigInt("0x" + clean.slice(0, 64));
  const expiration = Number(BigInt("0x" + clean.slice(64, 128)));
  const nonce = Number(BigInt("0x" + clean.slice(128, 192)));
  return { amount, expiration, nonce };
}

export function decodeBool(hex: string): boolean {
  const clean = strip0x(hex);
  if (clean.length === 0) return false;
  return BigInt("0x" + clean) !== 0n;
}

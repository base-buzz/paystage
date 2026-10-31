import { privateKeyToAccount } from "viem/accounts";
import type { Hex } from "viem";

export interface LoadgenWallet {
  index: number;
  address: `0x${string}`;
  account: ReturnType<typeof privateKeyToAccount>;
}

export interface EnvKeys {
  LOADGEN_KEY_1?: string;
  LOADGEN_KEY_2?: string;
  LOADGEN_KEY_3?: string;
}

function normalizeKey(k: string): Hex {
  const t = k.trim();
  return (t.startsWith("0x") ? t : `0x${t}`) as Hex;
}

export function loadWallets(env: EnvKeys): LoadgenWallet[] {
  const keys = [env.LOADGEN_KEY_1, env.LOADGEN_KEY_2, env.LOADGEN_KEY_3];
  const out: LoadgenWallet[] = [];
  keys.forEach((k, i) => {
    if (!k) return;
    try {
      const account = privateKeyToAccount(normalizeKey(k));
      out.push({ index: i + 1, address: account.address, account });
    } catch {
      // Skip malformed keys; never log key material.
    }
  });
  return out;
}

export function publicWalletList(
  wallets: LoadgenWallet[],
): Array<{ index: number; address: string; label: string }> {
  return wallets.map((w) => ({
    index: w.index,
    address: w.address,
    label: "PayStage synthetic load",
  }));
}

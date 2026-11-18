import { createPublicClient, createWalletClient, http, parseUnits, erc20Abi, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import type { Bindings } from "./env.js";

/**
 * The testnet faucet (#92).
 *
 * The constraint that shapes this file: **per address, not per IP**. An agent scripts IPs away in an hour and drains
 * a faucet before a human ever sees it, so the unit of rationing is the thing that would otherwise receive twice.
 *
 * Three rules, and each exists because of a specific way a faucet goes wrong:
 *  - one drip per address per 24h, and the refusal says when it resets (a bare 429 is a wall, a 429 with a time is a
 *    queue);
 *  - the cap is published on the page and in the response, so nobody has to discover it by failing;
 *  - a drip that errors is not recorded, so a person whose transaction failed can try again rather than being locked
 *    out by our failure.
 *
 * The ledger is Supabase, not memory: a Worker isolate is evicted constantly and an in-memory cap is a cap that resets
 * whenever Cloudflare feels like it.
 */

export const DRIP_USDC = "0.5";
export const WINDOW_HOURS = 24;
const USDC_BASE_SEPOLIA: Address = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export interface DripResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

function supabase(env: Bindings): { url: string; key: string } | null {
  const url = env.SUPABASE_URL;
  const key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return { url: url.replace(/\/+$/, ""), key };
}

/** Addresses are compared lowercase: checksum spelling must not buy a second drip. */
export function normaliseAddress(value: unknown): Address | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(trimmed)) return null;
  return trimmed.toLowerCase() as Address;
}

async function lastDrip(env: Bindings, address: Address): Promise<string | null> {
  const sb = supabase(env);
  if (!sb) return null;
  const res = await fetch(
    `${sb.url}/rest/v1/faucet_drips?address=eq.${address}&select=created_at&order=created_at.desc&limit=1`,
    { headers: { apikey: sb.key, authorization: `Bearer ${sb.key}` }, signal: AbortSignal.timeout(15_000) },
  );
  if (!res.ok) throw new Error(`ledger read failed (${res.status})`);
  const rows = (await res.json()) as Array<{ created_at: string }>;
  return rows[0]?.created_at ?? null;
}

async function recordDrip(env: Bindings, address: Address, tx: string): Promise<void> {
  const sb = supabase(env);
  if (!sb) return;
  const res = await fetch(`${sb.url}/rest/v1/faucet_drips`, {
    method: "POST",
    headers: {
      apikey: sb.key,
      authorization: `Bearer ${sb.key}`,
      "content-type": "application/json",
      prefer: "return=minimal",
    },
    body: JSON.stringify([{ address, amount_usdc: DRIP_USDC, tx_hash: tx }]),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`ledger write failed (${res.status})`);
}

/** Hours until the address may drip again, rounded up so "in 1 hour" is never a lie. */
export function hoursUntil(createdAt: string, now = Date.now()): number {
  const elapsed = now - new Date(createdAt).getTime();
  const remaining = WINDOW_HOURS * 3_600_000 - elapsed;
  return Math.max(0, Math.ceil(remaining / 3_600_000));
}

export async function handleFaucet(
  request: Request,
  env: Bindings,
): Promise<DripResult> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return { ok: false, status: 400, body: { error: "body must be JSON", expects: { address: "0x…" } } };
  }

  const address = normaliseAddress((payload as { address?: unknown })?.address);
  if (!address) {
    return {
      ok: false,
      status: 400,
      body: { error: "address must be a 0x-prefixed 20-byte hex address", expects: { address: "0x…" } },
    };
  }

  if (!env.FAUCET_SEPOLIA_KEY) {
    return { ok: false, status: 503, body: { error: "faucet is not configured on this deployment" } };
  }

  try {
    const previous = await lastDrip(env, address);
    if (previous) {
      const wait = hoursUntil(previous);
      if (wait > 0) {
        const resetAt = new Date(new Date(previous).getTime() + WINDOW_HOURS * 3_600_000).toISOString();
        return {
          ok: false,
          status: 429,
          body: {
            error: "this address has already been funded in the last 24 hours",
            address,
            alreadyFundedAt: previous,
            resetsAt: resetAt,
            hoursRemaining: wait,
            cap: { amountUsdc: DRIP_USDC, perAddressPer: `${WINDOW_HOURS}h` },
          },
        };
      }
    }

    const account = privateKeyToAccount(
      (env.FAUCET_SEPOLIA_KEY.startsWith("0x") ? env.FAUCET_SEPOLIA_KEY : `0x${env.FAUCET_SEPOLIA_KEY}`) as `0x${string}`,
    );
    const transport = http(env.SEPOLIA_RPC_URL ?? "https://sepolia.base.org");
    const wallet = createWalletClient({ account, chain: baseSepolia, transport });

    const tx = await wallet.writeContract({
      address: USDC_BASE_SEPOLIA,
      abi: erc20Abi,
      functionName: "transfer",
      args: [address, parseUnits(DRIP_USDC, 6)],
    });

    // Recorded after the transaction is submitted, not before: a failed send must not burn the address's day.
    await recordDrip(env, address, tx).catch((error) => {
      console.error(JSON.stringify({ level: "error", msg: "faucet_ledger_write_failed", tx, error: String(error) }));
    });

    const publicClient = createPublicClient({ chain: baseSepolia, transport });
    return {
      ok: true,
      status: 200,
      body: {
        address,
        amountUsdc: DRIP_USDC,
        txHash: tx,
        explorer: `https://sepolia.basescan.org/tx/${tx}`,
        cap: { amountUsdc: DRIP_USDC, perAddressPer: `${WINDOW_HOURS}h` },
        note: await publicClient
          .waitForTransactionReceipt({ hash: tx, timeout: 20_000 })
          .then(() => "confirmed on Base Sepolia")
          .catch(() => "submitted; confirmation may take a few seconds"),
      },
    };
  } catch (error) {
    console.error(JSON.stringify({ level: "error", msg: "faucet_failed", error: String(error) }));
    return {
      ok: false,
      status: 502,
      body: {
        error: "the faucet could not send right now — nothing was recorded, so this address can try again",
        detail: String(error).slice(0, 200),
      },
    };
  }
}

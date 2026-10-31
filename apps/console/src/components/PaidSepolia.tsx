"use client";

import { useState } from "react";

const BASE_SEPOLIA_CHAIN_ID = "0x14a34"; // 84532
const SEPOLIA_USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const ENDPOINT = "https://sepolia.api.paystage.xyz/v1/evaluate_mcp_payment";

interface EthProvider {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>;
}

function getProvider(): EthProvider | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { ethereum?: EthProvider };
  return w.ethereum ?? null;
}

async function ensureChain(provider: EthProvider): Promise<boolean> {
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: BASE_SEPOLIA_CHAIN_ID }],
    });
    return true;
  } catch (err) {
    const code = (err as { code?: number })?.code;
    if (code === 4902) {
      try {
        await provider.request({
          method: "wallet_addEthereumChain",
          params: [
            {
              chainId: BASE_SEPOLIA_CHAIN_ID,
              chainName: "Base Sepolia",
              nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
              rpcUrls: ["https://sepolia.base.org"],
              blockExplorerUrls: ["https://sepolia.basescan.org"],
            },
          ],
        });
        return true;
      } catch {
        return false;
      }
    }
    return false;
  }
}

export function PaidSepolia() {
  const [status, setStatus] = useState<string | null>(null);
  const [body, setBody] = useState<string | null>(null);
  const [chainOk, setChainOk] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setStatus(null);
    setBody(null);
    const provider = getProvider();
    if (!provider) {
      setStatus("No wallet detected. Install MetaMask or Coinbase Wallet.");
      setBusy(false);
      return;
    }
    const ok = await ensureChain(provider);
    setChainOk(ok);
    if (!ok) {
      setStatus("Switch to Base Sepolia (84532) to continue.");
      setBusy(false);
      return;
    }
    try {
      const requestId =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `demo-${Date.now()}`;
      const res = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-paystage-source": "test",
          "x-paystage-request-id": requestId,
        },
        body: JSON.stringify({
          // Hosted evaluate expects a payment body; 402 is success for demo probe.
          resource: "paystage-console-demo",
        }),
      });
      const text = await res.text();
      setStatus(`HTTP ${res.status}`);
      setBody(text.slice(0, 4000));
    } catch (e) {
      setStatus(e instanceof Error ? e.message : "request_failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="paid-sepolia">
      <p className="muted" style={{ marginTop: 12 }}>
        Base Sepolia only · USDC {SEPOLIA_USDC.slice(0, 8)}… · source=test. No
        mainnet.
      </p>
      <button
        type="button"
        className="scenario-btn"
        onClick={run}
        disabled={busy}
        style={{ marginTop: 8, maxWidth: 320 }}
      >
        {busy ? "Checking…" : "Chain-check + probe Sepolia API"}
      </button>
      {chainOk === false ? (
        <p className="decision decision-review" role="alert">
          Chain check failed. Switch wallet to Base Sepolia.
        </p>
      ) : null}
      {status ? (
        <p className="muted" role="status">
          {status}
        </p>
      ) : null}
      {body ? (
        <>
          <pre className="detail-block">{body}</pre>
          {status?.startsWith("HTTP 402") ? (
            <p className="muted">
              Payment required — sign the x402 payment in your wallet (Sepolia
              test USDC) via the hosted Try-it flow. Preview does not auto-broadcast.
            </p>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

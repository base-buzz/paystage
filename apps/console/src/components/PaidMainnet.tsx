"use client";

import { useState } from "react";
import {
  PRESETS,
  createBrowserSigner,
  ensureWalletChain,
  getWalletChainId,
  runPaidEvaluate,
} from "@/lib/try-it/pay";

/**
 * The real-money control.
 *
 * Everything else on this site lets a stranger read, evaluate and verify without spending anything. This is the
 * one button that moves their own money, so it is deliberately harder to press: mainnet only, an explicit
 * acknowledgement first, and the cost stated in the button label rather than in a footnote.
 *
 * What it proves that the Sepolia control cannot: a wallet we do not control can pay the hosted endpoint on Base,
 * receive a settlement receipt, and appear in telemetry as a real caller rather than a labelled test.
 *
 * We never hold the key and never see it — the signature happens in the visitor's wallet.
 */
const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const BASE_CHAIN_ID = 8453;

type Eth = { request(args: { method: string; params?: unknown[] }): Promise<unknown> };

export function PaidMainnet() {
  const [ack, setAck] = useState(false);
  const [status, setStatus] = useState<"idle" | "signing" | "settling" | "done" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);

  const eth = (): Eth | null => {
    const w = window as unknown as { ethereum?: Eth };
    return w.ethereum ?? null;
  };

  async function pay() {
    const provider = eth();
    if (!provider) {
      setStatus("error");
      setMessage("No browser wallet found. Install a wallet, or use the free evaluation above.");
      return;
    }
    setStatus("signing");
    setMessage("Confirm in your wallet — this charges 0.002 USDC on Base.");

    try {
      const accounts = (await provider.request({ method: "eth_requestAccounts" })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("wallet returned no account");

      const chainId = await getWalletChainId(provider);
      if (chainId !== BASE_CHAIN_ID) {
        await ensureWalletChain(provider, BASE_CHAIN_ID);
      }

      // Two waits, two sentences. The first is a person deciding in their wallet; the second is ~1.5s of
    // facilitator verification where a frozen label reads as broken. Wrapping the signer is the seam — the
    // handshake itself stays in the library.
    const base = createBrowserSigner(provider, address);
    const signer = {
      address: base.address,
      signTypedData: async (typedData: unknown) => {
        const signature = await base.signTypedData(typedData);
        setStatus("settling");
        setMessage("Settling on Base…");
        return signature;
      },
    };
      const body = PRESETS.small_pay?.body ?? PRESETS[Object.keys(PRESETS)[0]].body;

      const result = await runPaidEvaluate({
        signer,
        baseUrl: "https://api.paystage.xyz",
        networkCaip: "eip155:8453",
        body,
        // No `source` header: this caller is real, and labelling it anything else would flatter our numbers.
      });

      setDecision(result.decision ?? null);
      if (result.txHash) {
        setTxUrl(result.txUrl ?? `https://basescan.org/tx/${result.txHash}`);
        setMessage(`Settled: ${result.txHash.slice(0, 18)}… — verdict ${result.decision ?? "unknown"}`);
        setStatus("done");
      } else {
        setMessage(`HTTP ${result.status} — no settlement. ${result.decision ?? "no verdict"}`);
        setStatus(result.status === 402 ? "error" : "done");
      }
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  return (
    <div className="lp-paid-mainnet">
      <div className="lp-paid-head">
        <strong>Pay with real money</strong>
        <span>0.002 USDC on Base · charges your wallet · no account</span>
      </div>

      <label className="lp-paid-ack">
        <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} />
        <span>
          I understand this sends <strong>0.002 USDC</strong> from my wallet to PayStage on Base mainnet, and that it
          is not refundable.
        </span>
      </label>

      <button
        className="lp-paid-button"
        onClick={pay}
        disabled={!ack || status === "signing" || status === "settling"}
        aria-disabled={!ack || status === "signing" || status === "settling"}
      >
        {status === "signing" ? (
          "Sign in wallet…"
        ) : status === "settling" ? (
          "Settling on Base…"
        ) : status === "done" ? (
          "Paid · unlocked"
        ) : status === "error" ? (
          "Retry"
        ) : (
          <>
            Pay <span className="lp-price">0.002 USDC</span>
          </>
        )}
      </button>

      {message && <p className={`lp-paid-msg is-${status}`}>{message}</p>}
      {txUrl && (
        <p className="lp-paid-msg">
          <a href={txUrl} target="_blank" rel="noopener noreferrer">
            view the settlement on basescan
          </a>
          {decision ? ` · verdict: ${decision}` : ""}
        </p>
      )}
      <p className="lp-paid-note">
        The payment is signed in your wallet — we never see a key. USDC contract {USDC_BASE.slice(0, 10)}… on
        eip155:8453.
      </p>
    </div>
  );
}

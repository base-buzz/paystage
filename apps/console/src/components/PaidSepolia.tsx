"use client";

import { useMemo, useState } from "react";
import {
  NETWORKS,
  PRESETS,
  createBrowserSigner,
  runPaidEvaluate,
  ensureWalletChain,
  getWalletChainId,
} from "@/lib/try-it/pay";
import { createDebugLog } from "@/lib/try-it/debug";
import { DebugPanel } from "./DebugPanel";

type Eth = {
  request: (args: {
    method: string;
    params?: unknown[];
  }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
};

function getEthereum(): Eth | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { ethereum?: Eth };
  return w.ethereum ?? null;
}

function friendlyError(err: unknown): string {
  const anyErr = err as { code?: number; message?: string; cause?: { code?: number } };
  const code = anyErr?.code ?? anyErr?.cause?.code;
  const msg = String(anyErr?.message || err || "Unknown error");
  if (code === 4001 || /user rejected|user denied/i.test(msg)) {
    return "Request rejected in wallet.";
  }
  if (/no (eip-1193 )?wallet|provider|ethereum/i.test(msg)) {
    return "No wallet detected. Install MetaMask or Coinbase Wallet.";
  }
  if (/still on chain|switch|network|add network/i.test(msg)) {
    return msg;
  }
  if (/insufficient|funds|balance/i.test(msg)) {
    return `Insufficient USDC. Get test USDC: ${NETWORKS.sepolia.faucet}`;
  }
  if (/bigint|serialize/i.test(msg)) {
    return `Wallet typed-data error: ${msg}`;
  }
  return msg;
}

const PRESET_KEYS = Object.keys(PRESETS);

export function PaidSepolia() {
  const [presetKey, setPresetKey] = useState(
    PRESETS.small_pay ? "small_pay" : PRESET_KEYS[0],
  );
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string>("idle");
  const [error, setError] = useState<string | null>(null);
  const [decision, setDecision] = useState<string | null>(null);
  const [httpStatus, setHttpStatus] = useState<number | null>(null);
  const [txUrl, setTxUrl] = useState<string | null>(null);
  const [raw, setRaw] = useState<unknown>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [debugText, setDebugText] = useState("");
  const [lineCount, setLineCount] = useState(0);
  const [walletChain, setWalletChain] = useState<number | null>(null);

  const preset = PRESETS[presetKey];
  const bodyPreview = useMemo(
    () => JSON.stringify(preset?.body ?? {}, null, 2),
    [preset],
  );

  async function refreshChain(eth: Eth) {
    try {
      const id = await getWalletChainId(eth);
      setWalletChain(id);
      return id;
    } catch {
      setWalletChain(null);
      return null;
    }
  }

  async function handlePay() {
    setBusy(true);
    setError(null);
    setDecision(null);
    setHttpStatus(null);
    setTxUrl(null);
    setRaw(null);
    setDebugText("");
    setLineCount(0);

    const debug = createDebugLog();
    setRequestId(debug.requestId);

    try {
      const eth = getEthereum();
      if (!eth) throw new Error("No EIP-1193 wallet available");

      setStatus("connecting");
      debug.log("wallet:requestAccounts");
      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const address = accounts?.[0];
      if (!address) throw new Error("No account returned from wallet");

      setStatus("switching_chain");
      debug.log("wallet:ensureChain", { target: NETWORKS.sepolia.chainId });
      await ensureWalletChain(eth, NETWORKS.sepolia.chainId);
      await refreshChain(eth);

      setStatus("paying");
      const signer = createBrowserSigner(eth, address);
      const result = await runPaidEvaluate({
        signer,
        baseUrl: NETWORKS.sepolia.api,
        networkCaip: NETWORKS.sepolia.id,
        body: preset.body,
        debug,
        requestId: debug.requestId,
        source: "test",
      });

      setHttpStatus(result.status);
      setDecision(result.decision);
      setTxUrl(result.txUrl);
      setRaw(result.raw);
      setStatus(result.status >= 200 && result.status < 300 ? "done" : `http_${result.status}`);
    } catch (err) {
      setError(friendlyError(err));
      setStatus("error");
      debug.log("ui:error", {
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setDebugText(debug.toText());
      setLineCount(debug.lines.length);
      setBusy(false);
    }
  }

  return (
    <div className="paid-sepolia" style={{ marginTop: 12 }}>
      <p className="panel-sub" style={{ marginBottom: 8 }}>
        Full x402 Sign &amp; pay · Base Sepolia only ·{" "}
        <code>x-paystage-source: test</code>. No mainnet from this control.
      </p>

      <div
        style={{
          display: "flex",
          gap: 8,
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <label className="muted" htmlFor="paid-preset">
          Preset
        </label>
        <select
          id="paid-preset"
          value={presetKey}
          disabled={busy}
          onChange={(e) => setPresetKey(e.target.value)}
          style={{
            minHeight: 44,
            background: "var(--panel-2)",
            color: "var(--text)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: "8px 10px",
            maxWidth: "100%",
          }}
        >
          {PRESET_KEYS.map((k) => (
            <option key={k} value={k}>
              {PRESETS[k].label} — expect {PRESETS[k].expect}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="scenario-btn"
          onClick={handlePay}
          disabled={busy}
          style={{ maxWidth: 320 }}
        >
          {busy ? "Working…" : "Connect wallet & pay (Sepolia)"}
        </button>
      </div>

      <p className="muted" style={{ marginTop: 8, fontSize: 12 }}>
        API {NETWORKS.sepolia.api} · chain {NETWORKS.sepolia.chainId}
        {walletChain != null ? ` · wallet ${walletChain}` : ""}
      </p>

      <details className="detail-block" style={{ marginTop: 8 }}>
        <summary className="muted">Request body</summary>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
          {bodyPreview}
        </pre>
      </details>

      <p className="muted" role="status" style={{ marginTop: 8 }}>
        Status: {status}
        {httpStatus != null ? ` · HTTP ${httpStatus}` : ""}
        {requestId ? ` · ${requestId}` : ""}
      </p>

      {error ? (
        <p className="decision decision-error" role="alert">
          {error}
        </p>
      ) : null}

      {decision ? (
        <p className="decision decision-allow">
          decision: <strong>{decision}</strong>
        </p>
      ) : null}

      {txUrl ? (
        <p style={{ fontSize: 13 }}>
          <a className="link" href={txUrl} target="_blank" rel="noopener noreferrer">
            View tx on Basescan
          </a>
        </p>
      ) : null}

      {raw != null ? (
        <div className="detail-block">
          <div className="muted">Response</div>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {JSON.stringify(
              raw,
              (_k, v) => (typeof v === "bigint" ? v.toString() : v),
              2,
            )}
          </pre>
        </div>
      ) : null}

      <DebugPanel text={debugText} requestId={requestId} lineCount={lineCount} />
    </div>
  );
}

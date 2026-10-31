"use client";

import { useState } from "react";

const SIWE_ENABLED = process.env.NEXT_PUBLIC_SIWE_ENABLED === "1";
const CHAIN_ID = 8453;

function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  issuedAt: string;
}): string {
  const { domain, address, uri, nonce, issuedAt } = params;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    "Read-only PayStage scan of outstanding USDC approvals on Base.",
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

type EvalItem = {
  item?: {
    token?: string;
    spender?: string;
    amount?: string;
  };
  flags?: string[];
  summary?: string;
};

export function SiweStub() {
  const [address, setAddress] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [items, setItems] = useState<EvalItem[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!SIWE_ENABLED) {
    return (
      <section
        aria-labelledby="siwe-heading"
        className="panel"
        style={{ padding: 16 }}
      >
        <h2 id="siwe-heading" className="panel-title">
          SIWE
        </h2>
        <p className="muted" style={{ margin: 0, fontSize: 13 }}>
          SIWE deeper mode — coming soon (read-only wallet scan).
        </p>
      </section>
    );
  }

  async function connectAndSign() {
    setError(null);
    setBusy(true);
    setItems(null);
    setNote(null);
    try {
      const eth = (window as unknown as { ethereum?: { request: (a: { method: string; params?: unknown[] }) => Promise<unknown> } }).ethereum;
      if (!eth) throw new Error("No wallet detected.");

      const accounts = (await eth.request({
        method: "eth_requestAccounts",
      })) as string[];
      const addr = accounts?.[0];
      if (!addr) throw new Error("No account returned.");

      // Prefer Base mainnet for approval scan (read-only).
      try {
        await eth.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x2105" }],
        });
      } catch {
        // user may already be on Base or reject — scan still uses public RPC
      }

      const msg = buildSiweMessage({
        domain: window.location.host,
        address: addr,
        uri: window.location.origin,
        nonce: randomNonce(),
        issuedAt: new Date().toISOString(),
      });
      const sig = (await eth.request({
        method: "personal_sign",
        params: [msg, addr],
      })) as string;

      setAddress(addr);
      setMessage(msg);
      setSignature(sig);

      const res = await fetch("/api/auth-scan", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ address: addr }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `scan HTTP ${res.status}`);
      setItems((data.items as EvalItem[]) ?? []);
      setNote(typeof data.note === "string" ? data.note : null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section
      aria-labelledby="siwe-heading"
      className="panel"
      style={{ padding: 16 }}
    >
      <h2 id="siwe-heading" className="panel-title">
        SIWE
      </h2>
      <p className="panel-sub">
        EIP-4361 sign-in, then a read-only Base USDC approval scan via auth-watch.
        Nothing is sent on-chain except the signature request.
      </p>
      <button
        type="button"
        className="scenario-btn"
        onClick={connectAndSign}
        disabled={busy}
        style={{ maxWidth: 320 }}
      >
        {busy ? "Working…" : "Connect & SIWE (read-only)"}
      </button>
      {error ? (
        <p className="decision decision-error" role="alert">
          {error}
        </p>
      ) : null}
      {address ? (
        <p className="muted" style={{ marginTop: 8, fontSize: 13 }}>
          Address <code>{address}</code>
        </p>
      ) : null}
      {message ? (
        <details className="detail-block" style={{ marginTop: 8 }}>
          <summary className="muted">Signed SIWE message</summary>
          <pre style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", margin: 0 }}>
            {message}
          </pre>
          {signature ? (
            <p className="muted" style={{ wordBreak: "break-all", fontSize: 11 }}>
              sig {signature.slice(0, 20)}…
            </p>
          ) : null}
        </details>
      ) : null}
      {items ? (
        <div style={{ marginTop: 12 }}>
          <h3 className="panel-title">Outstanding USDC approvals</h3>
          {items.length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>
              {note ?? "None found for sampled spenders."}
            </p>
          ) : (
            <ul className="reason-list">
              {items.map((it, i) => (
                <li key={i}>
                  {it.summary ?? "?"} · spender{" "}
                  {it.item?.spender?.slice(0, 10) ?? "?"}… · amount{" "}
                  {it.item?.amount ?? "?"}
                  {it.flags?.length ? ` · ${it.flags.join(",")}` : ""}
                </li>
              ))}
            </ul>
          )}
          {note && items.length > 0 ? (
            <p className="muted" style={{ fontSize: 12 }}>
              {note}
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

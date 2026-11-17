"use client";

import { useState } from "react";
import { signInWithWallet } from "@/lib/siwe/client";

const SIWE_ENABLED = process.env.NEXT_PUBLIC_SIWE_ENABLED === "1";

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
      // One sign-in implementation, shared with the preference sync (#174): connect, sign the
      // server's nonce, exchange it for a session. A message that differs by a word between two flows
      // is how one of them quietly stops verifying.
      const result = await signInWithWallet("Read-only PayStage scan of outstanding USDC approvals on Base.");
      setAddress(result.address);
      setMessage(result.message);
      setSignature(result.signature);

      const res = await fetch("/api/auth-scan", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
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
        EIP-4361 sign-in (server nonce + verified session), then a read-only
        Base USDC approval scan via auth-watch. Nothing is sent on-chain except
        the signature request.
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
          <pre
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
            }}
          >
            {message}
          </pre>
          {signature ? (
            <p
              className="muted"
              style={{ wordBreak: "break-all", fontSize: 11 }}
            >
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

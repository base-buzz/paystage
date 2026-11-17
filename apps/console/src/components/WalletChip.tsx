"use client";

import { useEffect, useRef, useState } from "react";

/**
 * The wallet chip (#178). A chip, not a profile picture — the wallet is the only identity this product has.
 *
 * Two defects it fixes. (1) `eth_requestAccounts` resolves without a prompt when the site is already
 * authorised, so the chip used to flip before a person perceived a decision; there is now a real
 * `Connecting…` state. (2) The old handler re-ran `eth_requestAccounts` on every click, which after the
 * first approval resolves instantly with the same address — a button that looks interactive and does
 * nothing. A connected chip now opens a menu.
 *
 * Everything here is optional: signed out, every page and every paid path still works.
 */

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
  on?(event: string, handler: (...args: unknown[]) => void): void;
  removeListener?(event: string, handler: (...args: unknown[]) => void): void;
}

type State = "idle" | "connecting" | "connected" | "no-wallet";

const BASE_CHAIN_ID = 8453;
const CHAIN_NAMES: Record<number, string> = { 8453: "Base", 84532: "Base Sepolia" };

function wallet(): Eip1193 | null {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  return typeof eth?.request === "function" ? eth : null;
}

function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function WalletChip() {
  const [state, setState] = useState<State>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [chainId, setChainId] = useState<number | null>(null);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Restore silently. `eth_accounts` never prompts, so a refresh shows the chip without asking again; a
  // previous approval is the wallet's to remember, not ours to re-request.
  useEffect(() => {
    const eth = wallet();
    if (!eth) return;
    let cancelled = false;
    (async () => {
      try {
        const accounts = (await eth.request({ method: "eth_accounts" })) as string[];
        const rawChain = (await eth.request({ method: "eth_chainId" })) as string;
        if (cancelled) return;
        if (accounts?.[0]) {
          setAddress(accounts[0]);
          setChainId(Number.parseInt(rawChain, 16));
          setState("connected");
        }
      } catch {
        /* a wallet that refuses to answer on load is simply not connected */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // The wallet owns the session: if the person changes account or chain elsewhere, the chip follows.
  useEffect(() => {
    const eth = wallet();
    if (!eth?.on) return;
    const onAccounts = (...args: unknown[]) => {
      const accounts = args[0] as string[] | undefined;
      setAddress(accounts?.[0] ?? null);
      setState(accounts?.[0] ? "connected" : "idle");
    };
    const onChain = (...args: unknown[]) => {
      const hex = args[0] as string | undefined;
      setChainId(hex ? Number.parseInt(hex, 16) : null);
    };
    eth.on("accountsChanged", onAccounts);
    eth.on("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onClick = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  async function connect() {
    if (state === "connecting") return; // one request at a time; the wallet's own error is swallowed quietly
    const eth = wallet();
    if (!eth) {
      setState("no-wallet");
      setNote("No browser wallet found. Everything here works without one.");
      return;
    }
    setState("connecting");
    setNote(null);
    try {
      const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
      const next = accounts?.[0] ?? null;
      setAddress(next);
      setState(next ? "connected" : "idle");
      const rawChain = (await eth.request({ method: "eth_chainId" })) as string;
      setChainId(Number.parseInt(rawChain, 16));
    } catch {
      // A rejection is a decision, not a failure: nothing changes, no banner.
      setState("idle");
    }
  }

  async function copyAddress() {
    if (!address) return;
    try {
      await navigator.clipboard.writeText(address);
      setNote("Address copied.");
    } catch {
      setNote(address);
    }
  }

  const chainLabel = chainId && chainId !== BASE_CHAIN_ID ? (CHAIN_NAMES[chainId] ?? `chain ${chainId}`) : null;

  if (state === "no-wallet") {
    return (
      <div className="site-wallet" ref={wrapRef}>
        <button type="button" className="site-connect" onClick={() => { setState("idle"); setNote(null); }}>
          Connect wallet
        </button>
        <p className="site-wallet-note" role="status">
          {note}{" "}
          <a href="https://ethereum.org/en/wallets/" target="_blank" rel="noreferrer">
            What is a wallet?
          </a>
        </p>
      </div>
    );
  }

  if (state === "connected" && address) {
    return (
      <div className="site-wallet" ref={wrapRef}>
        <button
          type="button"
          className="site-connect"
          aria-haspopup="menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {shortAddress(address)}
          {chainLabel ? ` · ${chainLabel}` : ""} <span aria-hidden="true">⌄</span>
        </button>
        {open ? (
          <div className="site-menu site-wallet-menu" role="menu">
            <button type="button" role="menuitem" onClick={copyAddress}>
              Copy address
            </button>
            <a role="menuitem" href={`https://basescan.org/address/${address}`} target="_blank" rel="noreferrer">
              View on BaseScan
            </a>
            {chainLabel ? (
              <button
                type="button"
                role="menuitem"
                onClick={async () => {
                  try {
                    await wallet()?.request({
                      method: "wallet_switchEthereumChain",
                      params: [{ chainId: `0x${BASE_CHAIN_ID.toString(16)}` }],
                    });
                  } catch {
                    setNote("Your wallet did not switch chains.");
                  }
                }}
              >
                Switch to Base
              </button>
            ) : null}
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                // There is no `eth_disconnect`. This forgets the chip in this tab; the wallet's own
                // approval stays until it is revoked there, and pretending otherwise would be a lie.
                setAddress(null);
                setChainId(null);
                setState("idle");
                setOpen(false);
                setNote("Disconnected here. Your wallet still remembers this site.");
              }}
            >
              Disconnect
            </button>
          </div>
        ) : null}
        {note ? <p className="site-wallet-note" role="status">{note}</p> : null}
      </div>
    );
  }

  return (
    <div className="site-wallet" ref={wrapRef}>
      <button type="button" className="site-connect" onClick={connect} disabled={state === "connecting"}>
        {state === "connecting" ? "Connecting…" : "Connect wallet"}
      </button>
    </div>
  );
}

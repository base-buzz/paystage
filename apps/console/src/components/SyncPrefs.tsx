"use client";

import { useEffect, useState } from "react";
import { signInWithWallet } from "@/lib/siwe/client";
import type { Prefs } from "@/lib/prefs";

/**
 * Optional preference sync (#173). Two settings, one wallet, no account.
 *
 * The default is local and this panel says so before it asks for anything: a person who never clicks
 * this button has the whole feature for one device and no record anywhere. Clicking it does three
 * things in order — sign a message, push what this device has, and offer to apply what another device
 * saved. Nothing here runs on load, and nothing here is on the path of a tool call, an API call or a
 * receipt.
 */

const THEME_KEY = "paystage.theme";

/**
 * Language is not stored anywhere on this site — it is the route (`/zh` or `/`). So "the language you
 * use" is read from the URL, and syncing it means remembering which route a person chose. Applying it on
 * another device is offered as a link, not a redirect: moving someone to another language the moment
 * they land is not a preference being honoured, it is the site being rude.
 */
function currentLanguage(): "en" | "zh" {
  try {
    return window.location.pathname.startsWith("/zh") ? "zh" : "en";
  } catch {
    return "en";
  }
}

function localTheme(): Prefs["theme"] | null {
  try {
    const theme = localStorage.getItem(THEME_KEY);
    return theme === "light" || theme === "dark" || theme === "system" ? theme : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Prefs["theme"]): void {
  try {
    if (theme === "system") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    /* a browser that blocks storage still renders; it just will not remember */
  }
}

type State = "idle" | "busy" | "connected" | "error";

export function SyncPrefs() {
  const [state, setState] = useState<State>("idle");
  const [address, setAddress] = useState<string | null>(null);
  const [remote, setRemote] = useState<Prefs | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // If a session already exists (this tab signed in for the scan), read the row without asking again.
  // An empty device adopts it; a device with its own settings keeps them and says so.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/prefs", { credentials: "include", cache: "no-store" });
        if (cancelled || !res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.prefs) return;
        const found = data.prefs as Prefs;
        setRemote(found);
        setState("connected");
        if (localTheme() === null) {
          applyTheme(found.theme);
          const lang = currentLanguage();
          setNote(
            found.language !== lang
              ? `Restored your ${found.theme} theme. Your wallet also saved ${found.language === "zh" ? "Chinese" : "English"} — use the link below to switch.`
              : `Restored your ${found.theme} theme from this wallet.`,
          );
        } else {
          setNote("This device has its own theme; it was kept.");
        }
      } catch {
        /* no session is the normal case, not an error */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function connect() {
    setState("busy");
    setError(null);
    try {
      const result = await signInWithWallet("Carry my PayStage theme and language between devices.");
      setAddress(result.address);
      const res = await fetch("/api/prefs", {
        method: "PUT",
        credentials: "include",
        headers: { "content-type": "application/json" },
        // What this device is actually showing: its theme, and the language of the page it is on.
        body: JSON.stringify({ theme: localTheme() ?? remote?.theme ?? "system", language: currentLanguage() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `sync HTTP ${res.status}`);
      setRemote(data.prefs as Prefs);
      setState("connected");
      setNote("Saved. Another browser with this wallet will pick these up.");
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const short = address ? `${address.slice(0, 6)}…${address.slice(-4)}` : null;

  return (
    <section className="panel" aria-labelledby="sync-heading">
      <h2 id="sync-heading" className="panel-title">
        Sync theme and language
      </h2>
      <p className="muted">
        Settings are saved in this browser only. Signing in with a wallet is optional and carries just a
        theme and a language to your other devices — never your payments, never an email, never an account.
      </p>
      <div className="row wrap">
        <button type="button" className="btn" onClick={connect} disabled={state === "busy"}>
          {state === "busy" ? "Waiting for your wallet…" : state === "connected" ? "Sync this device again" : "Sign in and sync"}
        </button>
        {state === "connected" && short ? <span className="muted mono">connected {short}</span> : null}
      </div>
      {note ? <p className="muted">{note}</p> : null}
      {state === "connected" && remote && remote.language !== currentLanguage() ? (
        <p className="muted">
          <a href={remote.language === "zh" ? "/zh" : "/"}>
            {remote.language === "zh" ? "Switch to 中文" : "Switch to English"}
          </a>
        </p>
      ) : null}
      {error ? (
        <p className="muted" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}

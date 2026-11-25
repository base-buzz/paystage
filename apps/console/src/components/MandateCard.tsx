import type { CSSProperties } from "react";
import {
  STATUS_COPY,
  formatInstant,
  formatWindowAmount,
  mandateJsonUrl,
  type MandateRead,
} from "@/lib/mandate";

/**
 * The card a counterparty sees after pointing a camera at someone else's pass (#436).
 *
 * Four lines and a state chip: who, how much, until when, and when the record was read. The page exists
 * to answer "should I trust this pass?" before the reader scrolls, so the status and its meaning are the
 * first thing after the serial.
 *
 * It renders **only** fields the endpoint returned. No payee list, no spend history, no agent address,
 * no refusals — the proposal's §7 is a privacy boundary, not a styling choice. The write half is
 * deliberately absent: a change needs a signature from the account that holds the authority, and the
 * endpoint does not accept one yet, so the page says that once rather than offering a control that
 * cannot work.
 */

export const HONESTY_LINE =
  "Revocation is instant server-side; this card is the record at the time above, and the QR is authoritative.";

export const WRITE_NOTE =
  "Changing the limit, the payees or ending this mandate requires a signature from the account that holds the authority. The endpoint and this page do not support that yet.";

export type MandateViewState = MandateRead | { kind: "malformed"; serial: string };

const PALETTE: Record<string, { ink: string; dot: string; border: string; wash: string }> = {
  active: { ink: "#065f46", dot: "#10b981", border: "#a7f3d0", wash: "#ecfdf5" },
  revoked: { ink: "#991b1b", dot: "#ef4444", border: "#fecaca", wash: "#fef2f2" },
  expired: { ink: "#92400e", dot: "#f59e0b", border: "#fde68a", wash: "#fffbeb" },
  unknown: { ink: "#374151", dot: "#6b7280", border: "#d1d5db", wash: "#f9fafb" },
  unreadable: { ink: "#991b1b", dot: "#ef4444", border: "#fecaca", wash: "#fef2f2" },
};

const SHELL: CSSProperties = {
  maxWidth: 520,
  margin: "0 auto",
  padding: "2rem 1.25rem 3rem",
  fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif",
  color: "#111827",
  lineHeight: 1.5,
};

const KICKER: CSSProperties = {
  margin: 0,
  fontSize: 12,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "#6b7280",
};

const SERIAL: CSSProperties = {
  margin: "0.25rem 0 1.5rem",
  fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
  fontSize: "1.5rem",
  fontWeight: 600,
  wordBreak: "break-all",
};

const NOTE: CSSProperties = { margin: "1.25rem 0 0", fontSize: 14, color: "#4b5563" };

const RULE: CSSProperties = { margin: "1.25rem 0 0", border: 0, borderTop: "1px solid #e5e7eb" };

function StatusChip({ status }: { status: string }) {
  const palette = PALETTE[status] ?? PALETTE.unknown;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "0.45rem",
        border: `1px solid ${palette.border}`,
        background: palette.wash,
        color: palette.ink,
        borderRadius: 999,
        padding: "0.2rem 0.7rem",
        fontSize: 14,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
      }}
    >
      <span aria-hidden="true" style={{ color: palette.dot }}>●</span>
      {status}
    </span>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", padding: "0.35rem 0" }}>
      <dt style={{ color: "#6b7280", fontSize: 14 }}>{label}</dt>
      <dd style={{ margin: 0, fontWeight: 600, textAlign: "right" }}>{value}</dd>
    </div>
  );
}

function WriteNote() {
  return (
    <p style={NOTE}>
      <strong>To change anything:</strong> {WRITE_NOTE}
    </p>
  );
}

export function MandateCard({ state }: { state: MandateViewState }) {
  if (state.kind === "malformed") {
    return (
      <main className="lp" style={SHELL}>
        <p style={KICKER}>Vouch mandate</p>
        <p style={SERIAL}>{state.serial}</p>
        <h1 style={{ margin: "0 0 0.5rem", fontSize: "1.35rem" }}>That is not a serial.</h1>
        <p style={{ margin: 0, color: "#4b5563" }}>
          A Vouch serial is <code>vch_</code> followed by at least 22 characters, or the short code{" "}
          <code>vch-ABC</code>. Nothing was looked up.
        </p>
      </main>
    );
  }

  if (state.kind === "unreadable") {
    return (
      <main className="lp" style={SHELL}>
        <p style={KICKER}>Vouch mandate</p>
        <p style={SERIAL}>{state.serial}</p>
        <StatusChip status="unreadable" />
        <p style={{ margin: "0.75rem 0 0", fontSize: "1.15rem", fontWeight: 600 }}>
          Could not read the record — do not trust this pass.
        </p>
        <p style={{ margin: "0.25rem 0 0", color: "#4b5563" }}>{state.reason}. Ask the holder to show it again.</p>
        <WriteNote />
      </main>
    );
  }

  const { payload, apiBase } = state;
  const copy = STATUS_COPY[payload.status];
  const known = payload.scope !== null;

  return (
    <main className="lp" style={SHELL}>
      <p style={KICKER}>Vouch mandate</p>
      <p style={SERIAL}>{payload.serial}</p>

      <StatusChip status={payload.status} />
      <p style={{ margin: "0.75rem 0 0", fontSize: "1.15rem", fontWeight: 600 }}>{copy.meaning}</p>

      {known && payload.principal && payload.scope ? (
        <>
          <p style={{ margin: "0.75rem 0 0" }}>
            {payload.principal.display} <span style={{ color: "#6b7280", fontSize: 14 }}>(self-asserted)</span>
          </p>
          <dl style={{ margin: "1.25rem 0 0" }}>
            <Row label="per payment" value={`${payload.scope.per_payment} USDC`} />
            <Row
              label="window ceiling"
              value={formatWindowAmount(payload.scope.window_amount, payload.scope.window_seconds)}
            />
            <Row label="expires" value={formatInstant(payload.scope.expires_at)} />
          </dl>
        </>
      ) : null}

      <p style={NOTE}>Record read {formatInstant(payload.as_of)}.</p>

      <hr style={RULE} />
      <p style={NOTE}>{HONESTY_LINE}</p>
      <WriteNote />

      {known ? (
        <p style={{ margin: "1.25rem 0 0", fontSize: 14 }}>
          <a href={mandateJsonUrl(payload.serial, apiBase)} rel="noreferrer">
            JSON record
          </a>
        </p>
      ) : null}
    </main>
  );
}

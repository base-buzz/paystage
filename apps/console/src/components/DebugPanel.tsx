"use client";

export function DebugPanel({
  text,
  requestId,
  lineCount,
}: {
  text: string;
  requestId: string | null;
  lineCount: number;
}) {
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // ignore
    }
  }

  return (
    <details className="detail-block" style={{ marginTop: 12 }}>
      <summary className="muted" style={{ cursor: "pointer" }}>
        Debug log{requestId ? ` · ${requestId}` : ""} ({lineCount})
      </summary>
      <div style={{ marginTop: 8 }}>
        <button
          type="button"
          className="scenario-btn"
          onClick={onCopy}
          disabled={!text}
          style={{ maxWidth: 200 }}
        >
          Copy log
        </button>
      </div>
      <pre
        style={{
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
          marginTop: 8,
          marginBottom: 0,
          maxHeight: 280,
          overflow: "auto",
        }}
      >
        {text || "(no log lines)"}
      </pre>
    </details>
  );
}

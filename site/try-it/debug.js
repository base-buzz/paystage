// Small ESM debug logger for the Try-it widget.

function truncateSig(value) {
  if (typeof value !== "string") return value;
  if (/^0x[0-9a-fA-F]{20,}$/.test(value)) {
    return value.slice(0, 10) + "…" + value.slice(-6);
  }
  return value;
}

function sanitize(data) {
  if (data == null) return data;
  if (typeof data === "string") return truncateSig(data);
  if (Array.isArray(data)) return data.map(sanitize);
  if (typeof data === "object") {
    const out = {};
    for (const [k, v] of Object.entries(data)) {
      const lk = k.toLowerCase();
      if (lk.includes("signature") || lk === "sig" || lk === "authorization") {
        out[k] = typeof v === "string" ? truncateSig(v) : "[redacted]";
      } else {
        out[k] = sanitize(v);
      }
    }
    return out;
  }
  return data;
}

export function createDebugLog() {
  const requestId =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : "rid-" + Math.random().toString(36).slice(2) + Date.now().toString(36);

  const lines = [];

  function log(step, data) {
    const entry = { t: new Date().toISOString(), step, ...(sanitize(data) || {}) };
    lines.push(entry);
    try {
      console.debug("[paystage]", requestId, step, entry);
    } catch {
      // ignore
    }
  }

  function toText() {
    return lines
      .map((l) => {
        const { t, step, ...rest } = l;
        const restStr = Object.keys(rest).length ? " " + JSON.stringify(rest) : "";
        return `${t} [${requestId}] ${step}${restStr}`;
      })
      .join("\n");
  }

  function clear() {
    lines.length = 0;
  }

  return { requestId, lines, log, toText, clear };
}

export function attachDebugPanel(root, debug) {
  if (!root) return null;

  const details = document.createElement("details");
  details.className = "try-it-debug";

  const summary = document.createElement("summary");
  summary.textContent = "Debug log";
  details.appendChild(summary);

  const pre = document.createElement("pre");
  pre.className = "try-it-debug-pre";
  pre.textContent = "";
  details.appendChild(pre);

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.textContent = "Copy log";
  copyBtn.className = "try-it-debug-copy";
  copyBtn.addEventListener("click", async () => {
    const text = debug.toText();
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = "Copied!";
      setTimeout(() => (copyBtn.textContent = "Copy log"), 1200);
    } catch {
      copyBtn.textContent = "Copy failed";
      setTimeout(() => (copyBtn.textContent = "Copy log"), 1200);
    }
  });
  details.appendChild(copyBtn);

  root.appendChild(details);

  const originalLog = debug.log;
  debug.log = (step, data) => {
    originalLog(step, data);
    pre.textContent = debug.toText();
  };

  return { details, pre, copyBtn };
}

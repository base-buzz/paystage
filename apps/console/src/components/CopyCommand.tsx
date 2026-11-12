"use client";

import { useState } from "react";

/**
 * The install command, with a copy button.
 *
 * The single most important action on the page was an inert `<code>` element: a reader had to
 * select it by hand, and on a phone that is fiddly enough that most do not. Copy is the whole
 * interaction — the command is not something anyone reads carefully.
 */
export function CopyCommand({ command }: { command: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setState("copied");
      setTimeout(() => setState("idle"), 1800);
    } catch {
      // Clipboard access can be denied (older Safari, insecure context). Selecting the text is
      // the honest fallback — say so rather than pretending it worked.
      setState("failed");
      setTimeout(() => setState("idle"), 2400);
    }
  }

  return (
    <span className="lp-copy">
      <code className="lp-btn lp-btn-ghost lp-copy-code">{command}</code>
      <button
        type="button"
        className="lp-copy-btn"
        onClick={copy}
        aria-label={state === "copied" ? "Copied" : "Copy install command"}
      >
        {state === "copied" ? "copied" : state === "failed" ? "select it" : "copy"}
      </button>
    </span>
  );
}

"use client";

import { useState } from "react";

/**
 * "or ask your AI agent" — the pattern chainstack uses in its hero, adapted to the thing we
 * actually are.
 *
 * Theirs pastes a request to their own MCP server. Ours has to be the *smaller* ask, because a
 * reader deciding whether to trust a payment gate will not paste a stranger's server into their
 * agent without thinking. So the prompt is a question, not a command: it asks their agent to
 * evaluate one payment with our tools and report the verdict. Nothing is signed, nothing moves.
 */
const PROMPT =
  "Use the PayStage MCP server (https://api.paystage.xyz/mcp) to evaluate this payment before signing it: " +
  "12.50 USDC to 0x6160...3757e on Base. Show the verdict and the rule that fired. Do not sign anything.";

export function AgentPrompt() {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(PROMPT);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="lp-agentcard lp-glass">
      <p className="lp-agentcard-label">or ask your AI agent</p>
      <div className="lp-agentcard-row">
        <code className="lp-agentcard-prompt">{PROMPT}</code>
        <button type="button" className="lp-agentcard-copy" onClick={copy} aria-label="Copy prompt">
          {copied ? "copied" : "copy"}
        </button>
      </div>
      <p className="lp-agentcard-note">
        The server is read-only and cannot sign. If your client asks for approval, that is the point.
      </p>
    </div>
  );
}

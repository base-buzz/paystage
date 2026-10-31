export type ScenarioTool = "preflight" | "auth-watch" | "velocity" | "paid-sepolia";

export interface Scenario {
  id: string;
  label: string;
  tool: ScenarioTool;
  description: string;
}

export const SCENARIOS: Scenario[] = [
  {
    id: "unlimited-approval",
    label: "Unlimited approval",
    tool: "auth-watch",
    description: "Auth amount 2^256−1. Expect revoke_recommended.",
  },
  {
    id: "known-drainer",
    label: "Known-drainer payee",
    tool: "preflight",
    description: "payTo 0x…dEaD. Expect do_not_pay / review.",
  },
  {
    id: "burst-velocity",
    label: "Burst under velocity cap",
    tool: "velocity",
    description: "5 payments / 60s, max_count 3. Expect deny.",
  },
  {
    id: "over-max-amount",
    label: "Over max_amount",
    tool: "preflight",
    description: "5.00 USDC vs 1.00 cap. Expect do_not_pay.",
  },
  {
    id: "unknown-payee",
    label: "Unknown payee → review",
    tool: "preflight",
    description: "Payee not on allowlist. Expect review.",
  },
  {
    id: "valid-small-pay",
    label: "Valid small payment → pay",
    tool: "preflight",
    description: "0.002 USDC to allowed payTo. Expect pay.",
  },
  {
    id: "outstanding-auths",
    label: "Outstanding auth list",
    tool: "auth-watch",
    description: "Mixed allowlisted + unknown spenders.",
  },
  {
    id: "paid-sepolia",
    label: "Hosted paid call (Sepolia)",
    tool: "paid-sepolia",
    description: "Live evaluate_mcp_payment on Base Sepolia. Wallet + chain check.",
  },
];

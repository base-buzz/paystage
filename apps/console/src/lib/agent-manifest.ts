/**
 * Single source of truth for the machine-readable surface: `/llms.txt`,
 * `/llms-full.txt` and `/.well-known/paystage.json` all render from this object,
 * so they cannot disagree with each other.
 *
 * Versions are imported from the workspace packages rather than typed here; a
 * vitest case in `tests/agent-manifest.test.ts` fails if they drift from
 * `package.json`.
 */
import mcpPkg from "../../../../packages/mcp/package.json";
import authWatchPkg from "../../../../packages/auth-watch/package.json";
import policyPkg from "../../../../packages/policy/package.json";
import preflightPkg from "../../../../packages/preflight/package.json";
import tradePreflightPkg from "../../../../packages/trade-preflight/package.json";
import velocityPkg from "../../../../packages/velocity/package.json";
// The four that were missing: the manifest is the surface built for agents, and it could not name the guard.
import x402GuardPkg from "../../../../packages/x402-guard/package.json";
import xEvmPkg from "../../../../packages/x-evm/package.json";
import skillPkg from "../../../../packages/skill/package.json";
import aiSdkPkg from "../../../../packages/ai-sdk/package.json";

export const PACKAGE_VERSIONS: Record<string, string> = {
  "@paystage/mcp": mcpPkg.version,
  "@paystage/policy": policyPkg.version,
  "@paystage/preflight": preflightPkg.version,
  "@paystage/auth-watch": authWatchPkg.version,
  "@paystage/trade-preflight": tradePreflightPkg.version,
  "@paystage/velocity": velocityPkg.version,
  "@paystage/x402-guard": x402GuardPkg.version,
  "@paystage/x-evm": xEvmPkg.version,
  "@paystage/skill": skillPkg.version,
  "@paystage/ai-sdk": aiSdkPkg.version,
};

/**
 * Places a human can follow the project. One array, because the footer, `/llms.txt`
 * and the manifest must not disagree about where we live. `verified` means a
 * maintainer loaded the URL and saw our own profile; nothing here is inferred
 * from a handle that merely looked right.
 */
export const SOCIALS: { label: string; handle: string; url: string }[] = [
  { label: "X", handle: "@paystage_xyz", url: "https://x.com/paystage_xyz" },
  { label: "GitHub", handle: "base-buzz/paystage", url: "https://github.com/base-buzz/paystage" },
];

export type ToolEntry = {
  name: string;
  package: string;
  summary: string;
  decisions: string[];
  input: string;
  output: string;
  network: string;
};

const VERDICTS_PAY = ["pay", "review", "do_not_pay"];
const VERDICTS_TRADE = ["allow", "review", "do_not_trade"];

export const TOOLS: ToolEntry[] = [
  {
    name: "evaluate_mcp_payment",
    package: "@paystage/mcp",
    summary:
      "Evaluates a proposed x402 payment against a local policy file before it is signed",
    decisions: VERDICTS_PAY,
    input: "payment requirements (scheme, network, asset, amount, payTo) + policy_path",
    output: "decision, reasons[], matched rule, evaluated amount",
    network: "none",
  },
  {
    name: "list_outstanding_auths",
    package: "@paystage/auth-watch",
    summary:
      "Lists outstanding ERC-20, Permit2 and EIP-3009 authorisations for an owner",
    decisions: [],
    input: "owner address, token/asset scope, optional rpc_url",
    output: "authorisations[] with allowance, nonce and expiry",
    network: "JSON-RPC eth_call (PAYSTAGE_RPC_URL or Base/Sepolia public RPC)",
  },
  {
    name: "evaluate_outstanding_auths",
    package: "@paystage/auth-watch",
    summary:
      "Flags outstanding authorisations that need attention before the next payment",
    decisions: ["ok", "attention", "revoke_recommended"],
    input: "owner address, optional rpc_url",
    output: "findings[] with severity and the allowance that caused it",
    network: "JSON-RPC eth_call (PAYSTAGE_RPC_URL or Base/Sepolia public RPC)",
  },
  {
    name: "evaluate_hip3_trade",
    package: "@paystage/trade-preflight",
    summary:
      "Evaluates a proposed HIP-3 / trade.xyz order against a local TradePolicy; places no orders",
    decisions: VERDICTS_TRADE,
    input: "order (market, side, size, leverage) + TradePolicy, optional market snapshot",
    output: "decision, reasons[]",
    network:
      "read-only POST to https://api.hyperliquid.xyz/info only when no snapshot is supplied",
  },
  {
    name: "evaluate_velocity",
    package: "@paystage/velocity",
    summary: "Rolling rate and spend checks: bursts, spikes and unusual cadence",
    decisions: VERDICTS_PAY,
    input: "proposed payment + spend history (window, count, total)",
    output: "decision, reasons[], window totals",
    network: "none",
  },
];

export const PAYSTAGE_MANIFEST = {
  name: "PayStage",
  description:
    "A read-only payment-safety layer for AI agents: local-policy preflight that returns pay, review or do_not_pay with the rule that fired.",
  // An agent answering a Chinese request for "x402 支付安全" needs a description it can match, in the language it
  // searched in. The English field is the canonical one; this one exists so the discovery surfaces do not answer
  // only in English.
  description_zh:
    "面向 AI 智能体的只读 x402 支付安全层：按本地策略在签名前预检，返回 pay、review 或 do_not_pay，并给出触发的那条规则。只读、不持私钥、不签名、不移动资金。",
  keywords_zh: [
    "x402",
    "支付安全",
    "支付前校验",
    "智能体支付",
    "agent 支付拦截",
    "盗币地址检查",
    "钱包授权检查",
    "消费限额",
    "MCP 工具",
    "USDC",
  ],
  version: PACKAGE_VERSIONS["@paystage/mcp"],
  license: "MIT",
  homepage: "https://paystage.xyz",
  repository: "https://github.com/base-buzz/paystage",
  socials: SOCIALS,
  holds_keys: false,
  signs_transactions: false,
  telemetry: false,
  shell: false,
  eval: false,
  runtime_dependencies: ["zod", "@modelcontextprotocol/server"],
  environment_variables: ["PAYSTAGE_POLICY_PATH", "PAYSTAGE_RPC_URL"],
  packages: Object.keys(PACKAGE_VERSIONS),
  package_versions: PACKAGE_VERSIONS,
  tools: TOOLS,
  networks: {
    mainnet: "eip155:8453",
    sepolia: "eip155:84532",
  },
  hosted_api: {
    mainnet: "https://api.paystage.xyz",
    sepolia: "https://sepolia.api.paystage.xyz",
    price_usdc_per_call: "0.002",
  },
  reliability: {
    slo_doc: "https://github.com/base-buzz/paystage/blob/main/apps/hosted/SLO.md",
    timing_header: "Server-Timing: app;dur=<ms> on every response",
    measure: "node apps/hosted/scripts/latency.mjs --n 50",
    fail_closed: true,
    idempotent: ["POST /v1/evaluate_mcp_payment", "POST /v1/evaluate_outstanding_auths"],
    measured_2026_11_09: {
      unpaid_402_server_ms: { p50: 0, p95: 0 },
      unpaid_402_wall_ms: { p50: 18, p95: 101 },
      paid_evaluation: "not measured — needs a funded wallet",
    },
  },
  receipts: {
    endpoint: "POST /v1/evaluate_mcp_payment returns a `receipt` field",
    key_endpoint: "https://api.paystage.xyz/v1/public/receipt-key.json",
    format_version: 1,
    alg: "ECDSA-P256-SHA256",
    binding: "request_sha256 + policy_sha256 over canonical JSON; verdict included",
    signing: "optional — check the key endpoint; receipts say signed:false when unsigned",
    docs: "https://github.com/base-buzz/paystage/blob/main/apps/hosted/RECEIPTS.md",
  },
  access: [
    { kind: "filesystem.read", detail: "one policy JSON file (policy_path / PAYSTAGE_POLICY_PATH)" },
    { kind: "network", detail: "JSON-RPC reads to Base or a configured RPC; read-only Hyperliquid info query" },
    { kind: "stdio", detail: "MCP JSON-RPC over stdin/stdout with the launching agent" },
    { kind: "filesystem.write", detail: "none" },
    { kind: "secrets", detail: "none read by PayStage; no key custody" },
  ],
  verify: [
    "npx -y -p @paystage/mcp paystage-mcp",
    "npm audit signatures",
    "node apps/hosted/scripts/conformance.mjs",
    "npx -y -p @paystage/mcp paystage-verify <receipt.json>",
    "https://github.com/base-buzz/paystage/blob/main/SECURITY.md",
  ],
  machine_surfaces: {
    llms: "/llms.txt",
    llms_full: "/llms-full.txt",
    manifest: "/.well-known/paystage.json",
    mcp_registry: "xyz.paystage/mcp",
    cadence: "/v1/public/cadence.json",
  },
  not_advice: true,
} as const;

export type PaystageManifest = typeof PAYSTAGE_MANIFEST;

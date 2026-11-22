/**
 * The corpus the differential test (#181) runs both parsers over.
 *
 * Two halves, both deterministic:
 *
 *  1. **Every policy fixture in the repository**, valid and invalid, read from disk rather than
 *     copied here. A fixture added later is picked up by its path, so the corpus grows with the
 *     repo instead of drifting from it.
 *  2. **Generated mutations** of every seed: drop a key, replace a value with a wrong type, add
 *     an unknown key at every level, push an extra array element, and boundary values for the
 *     fields where a boundary is the whole question (amount strings, decimals, hours, addresses,
 *     network ids, array minimums). The generator is plain code with no randomness, so the same
 *     commit always produces the same corpus and a failure is reproducible by name.
 *
 * The corpus is data, not assertions: `differential.test.ts` asserts that the hand-written
 * parser accepts exactly what zod accepted, with the same output and the same message.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface CorpusCase {
  /** Stable name, printed on divergence so the failing document can be rebuilt. */
  readonly name: string;
  /** The document handed to both parsers. */
  readonly document: unknown;
}

type Path = Array<string | number>;

const REPO = new URL("../../..", import.meta.url);

function readFixture(relative: string): unknown {
  return JSON.parse(readFileSync(fileURLToPath(new URL(relative, REPO)), "utf8"));
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every node path in a document, root included. */
function locations(value: unknown, path: Path = [], out: Path[] = []): Path[] {
  out.push(path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => locations(entry, [...path, index], out));
  } else if (isObject(value)) {
    for (const key of Object.keys(value)) locations(value[key], [...path, key], out);
  }
  return out;
}

function clone(document: unknown): unknown {
  return structuredClone(document);
}

function at(document: unknown, path: Path): unknown {
  let node: unknown = document;
  for (const step of path) node = (node as Record<string | number, unknown>)[step];
  return node;
}

function withReplacement(document: unknown, path: Path, replacement: unknown): unknown {
  if (path.length === 0) return clone(replacement);
  const copy = clone(document);
  const parent = at(copy, path.slice(0, -1)) as Record<string | number, unknown>;
  parent[path[path.length - 1]!] = clone(replacement);
  return copy;
}

function without(document: unknown, path: Path): unknown {
  if (path.length === 0) return undefined;
  const copy = clone(document);
  const parent = at(copy, path.slice(0, -1));
  const last = path[path.length - 1]!;
  if (Array.isArray(parent)) parent.splice(Number(last), 1);
  else delete (parent as Record<string | number, unknown>)[last];
  return copy;
}

function withUnknownKey(document: unknown, path: Path): unknown {
  const copy = clone(document);
  const node = at(copy, path);
  (node as Record<string, unknown>).__paystage_unknown__ = 1;
  return copy;
}

/** Values a mutate-every-location pass swaps in. Types, boundaries and one valid lookalike. */
const REPLACEMENTS: ReadonlyArray<{ readonly label: string; readonly value: unknown }> = [
  { label: "null", value: null },
  { label: "undefined", value: undefined },
  { label: "false", value: false },
  { label: "zero", value: 0 },
  { label: "negative", value: -1 },
  { label: "float", value: 1.5 },
  { label: "unsafe-int", value: 2 ** 53 },
  { label: "nan", value: NaN },
  { label: "empty-string", value: "" },
  { label: "string", value: "x" },
  { label: "amount-string", value: "0.05" },
  { label: "empty-array", value: [] },
  { label: "empty-object", value: {} },
  { label: "amount-spec", value: { value: "1.00", asset: "USDC", decimals: 6 } },
];

const USDC_BASE = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const USDC_SEPOLIA = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const DAI = "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb";
const PAY_TO = "0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE";
const SOLANA_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const SOLANA_PAYEE = "5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";

function minimal(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    version: 1,
    max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
    allowed_pay_to: [PAY_TO],
    allowed_assets: [{ symbol: "USDC", decimals: 6, address: USDC_BASE, network: "eip155:8453" }],
    allowed_networks: ["eip155:8453"],
    max_timeout_seconds: 300,
    unknown_payee: "deny",
    ...overrides,
  };
}

/** Seeds written here because no fixture covers the optional branches (velocity, agents, Solana). */
const EMBEDDED_SEEDS: ReadonlyArray<{ readonly name: string; readonly document: unknown }> = [
  {
    name: "embedded/full-surface",
    document: minimal({
      daily_cap: { value: "10.00", asset: "USDC", decimals: 6 },
      allowed_assets: [
        { symbol: "USDC", decimals: 6, address: USDC_BASE, network: "eip155:8453" },
        { symbol: "USDC", decimals: 6, address: USDC_SEPOLIA, network: "eip155:84532" },
        { symbol: "WETH", decimals: 18, address: "0x4200000000000000000000000000000000000006" },
      ],
      allow_uncapped_assets: true,
      allowed_networks: ["eip155:8453", "eip155:84532"],
      time_window: { allowed_hours_utc: [9, 17] },
      require_human_above: { value: "0.50", asset: "USDC", decimals: 6 },
      unknown_payee: "review",
      max_auth_validity_seconds: 600,
      allowed_spenders: [USDC_BASE, PAY_TO],
      disallow_unlimited_approvals: true,
      velocity: {
        windows: [
          { window_seconds: 300, max_count: 20 },
          {
            window_seconds: 86400,
            max_amount: { value: "1.00", asset: "USDC", decimals: 6 },
            per_payee_max_amount: { value: "0.25", decimals: 6, asset: "USDC" },
          },
        ],
      },
      agents: {
        reader: {
          max_amount: { value: "0.01", asset: "USDC", decimals: 6 },
          allowed_pay_to: [PAY_TO],
          unknown_payee: "deny",
        },
        trader: {
          velocity: { windows: [{ window_seconds: 60, max_count: 5 }] },
        },
      },
    }),
  },
  {
    name: "embedded/solana",
    document: {
      version: 1,
      max_amount: { value: "0.05", asset: "USDC", decimals: 6 },
      allowed_pay_to: [SOLANA_PAYEE],
      allowed_assets: [{ symbol: "USDC", decimals: 6, address: SOLANA_MINT, network: `solana:${SOLANA_PAYEE}` }],
      allowed_networks: ["solana:*", `solana:${SOLANA_PAYEE}`],
      max_timeout_seconds: 60,
      unknown_payee: "review",
    },
  },
  {
    name: "embedded/time-window-blocked",
    document: minimal({ time_window: { blocked_hours_utc: [0, 6] } }),
  },
  {
    name: "embedded/two-capped-assets",
    document: minimal({
      allowed_assets: [
        { symbol: "USDC", decimals: 6, address: USDC_BASE, network: "eip155:8453" },
        { symbol: "DAI", decimals: 18, address: DAI, network: "eip155:8453" },
      ],
    }),
  },
];

/** Boundary values, targeted at the fields where the boundary is the question. */
const BOUNDARY_CASES: ReadonlyArray<{ readonly name: string; readonly document: unknown }> = [
  ...[
    "",
    "0",
    "0.0",
    "00",
    "01",
    "1.",
    "1.0",
    ".5",
    "0.0000001",
    "-1",
    "1e3",
    " 1",
    "1,0",
    "0.5.0",
    "1\n",
    "999999999999999999999999999999",
  ].map((value) => ({
    name: `boundary/max_amount.value/${JSON.stringify(value)}`,
    document: minimal({ max_amount: { value, asset: "USDC", decimals: 6 } }),
  })),
  ...[
    -1, 0, 1, 2, 6, 18, 255, 1.5, 2 ** 53, NaN,
  ].map((decimals) => ({
    name: `boundary/max_amount.decimals/${String(decimals)}`,
    document: minimal({ max_amount: { value: "0.05", asset: "USDC", decimals } }),
  })),
  ...[
    [0, 23],
    [23, 0],
    [9, 9],
    [-1, 9],
    [24, 9],
    [9, 24],
    [9],
    [9, 17, 18],
    ["9", 17],
    [9.5, 17],
    [],
    [null, 17],
  ].map((hours) => ({
    name: `boundary/time_window.allowed_hours_utc/${JSON.stringify(hours)}`,
    document: minimal({ time_window: { allowed_hours_utc: hours } }),
  })),
  ...[
    { time_window: {} },
    { time_window: { allowed_hours_utc: [9, 17], blocked_hours_utc: [12, 13] } },
    { time_window: { allowed_hours_utc: undefined } },
    { time_window: { blocked_hours_utc: [0, 0] } },
    { time_window: null },
    { time_window: [] },
  ].map((override, index) => ({
    name: `boundary/time_window/shape-${index}`,
    document: minimal(override as Record<string, unknown>),
  })),
  ...[
    "0x209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "0x209693bc6afc0c5328ba36faf03c514ef312287c",
    "0X209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "0x209693Bc6afc0C5328bA36FaF03C514EF31228",
    "0x209693Bc6afc0C5328bA36FaF03C514EF312287C0",
    "209693Bc6afc0C5328bA36FaF03C514EF312287C",
    "0xZZ9693Bc6afc0C5328bA36FaF03C514EF312287C",
    SOLANA_PAYEE,
    "1".repeat(31),
    "1".repeat(32),
    "1".repeat(44),
    "1".repeat(45),
    "0OIl",
    "",
  ].map((address) => ({
    name: `boundary/allowed_pay_to/${address.length}:${address.slice(0, 12)}`,
    document: minimal({ allowed_pay_to: [address] }),
  })),
  ...[
    "",
    "eip155:",
    "eip155:abc",
    "eip155:8453",
    "eip155:0",
    "solana:*",
    `solana:${SOLANA_PAYEE}`,
    "solana:short",
    "eip155:8453\n",
    "EIP155:8453",
  ].map((network) => ({
    name: `boundary/allowed_networks/${JSON.stringify(network)}`,
    document: minimal({ allowed_networks: [network] }),
  })),
  ...[0, -1, 1, 1.5, 2 ** 53, NaN].map((seconds) => ({
    name: `boundary/max_timeout_seconds/${String(seconds)}`,
    document: minimal({ max_timeout_seconds: seconds }),
  })),
  ...[0, -1, 1, 1.5, 2 ** 53].map((seconds) => ({
    name: `boundary/velocity.window_seconds/${String(seconds)}`,
    document: minimal({ velocity: { windows: [{ window_seconds: seconds }] } }),
  })),
  ...[0, -1, 1, 1.5].map((count) => ({
    name: `boundary/velocity.max_count/${String(count)}`,
    document: minimal({ velocity: { windows: [{ window_seconds: 60, max_count: count }] } }),
  })),
  ...[
    { velocity: { windows: [] } },
    { velocity: { windows: [{}] } },
    { velocity: { windows: {} } },
    { velocity: [] },
    { velocity: { windows: [null] } },
  ].map((override, index) => ({
    name: `boundary/velocity/shape-${index}`,
    document: minimal(override as Record<string, unknown>),
  })),
  ...[
    {},
    { "": {} },
    { reader: null },
    { reader: [] },
    { reader: { max_amount: { value: "1", asset: "USDC" } } },
    { reader: { allowed_pay_to: ["not-an-address"] } },
    { reader: { unknown_payee: "hold" } },
    { reader: { velocity: { windows: [] } } },
  ].map((agents, index) => ({
    name: `boundary/agents/shape-${index}`,
    document: minimal({ agents }),
  })),
  ...[
    { symbol: "" },
    { symbol: "USDC", decimals: 6, address: USDC_BASE, network: null },
    { symbol: "USDC", decimals: 6, address: USDC_BASE, network: 5 },
    { symbol: "USDC", decimals: -1, address: USDC_BASE },
    { symbol: "USDC", decimals: 1.5, address: USDC_BASE },
    { symbol: "USDC", decimals: 6, address: "" },
    { symbol: "USDC", decimals: 6, address: "0x1" },
  ].map((asset, index) => ({
    name: `boundary/allowed_assets/${index}`,
    document: minimal({ allowed_assets: [asset] }),
  })),
  ...["", " ", "USDC ", "usdc"].map((symbol) => ({
    name: `boundary/asset.symbol/${JSON.stringify(symbol)}`,
    document: minimal({
      allowed_assets: [{ symbol, decimals: 6, address: USDC_BASE, network: "eip155:8453" }],
    }),
  })),
];

/** Every policy fixture in the repo. Paths are relative to the repository root. */
const FIXTURE_PATHS: readonly string[] = [
  "examples/policy.example.json",
  "examples/policies/strict.json",
  "registry/examples/reader-bot.policy.json",
  "registry/examples/research-agent.policy.json",
  "registry/examples/trading-bot.policy.json",
  "packages/payment-policy/fixtures/policies/minimal-policy.json",
  "packages/payment-policy/fixtures/policies/full-policy.json",
  "packages/payment-policy/fixtures/spec/spec-example.pre-fix.json",
  "packages/payment-policy/fixtures/documents/minimal-policy.json",
  "packages/payment-policy/fixtures/documents/full-policy.json",
  "packages/payment-policy/fixtures/documents/spec-example.json",
];

function fixtureCases(): CorpusCase[] {
  const cases: CorpusCase[] = FIXTURE_PATHS.map((path) => ({
    name: `fixture/${path}`,
    document: readFixture(path),
  }));
  // The EVM verdict baseline stores its policy beside the expected verdicts; it is a real
  // policy document, so it belongs in the corpus as one.
  const baseline = readFixture("packages/preflight/tests/fixtures/evm-verdict-baseline.json") as {
    policy?: unknown;
  };
  if (baseline.policy !== undefined) {
    cases.push({ name: "fixture/preflight/evm-verdict-baseline.json#policy", document: baseline.policy });
  }
  return cases;
}

/** Seeds the generated mutations are derived from: fixtures plus the embedded ones. */
function seeds(): CorpusCase[] {
  return [...fixtureCases(), ...EMBEDDED_SEEDS.map((seed) => ({ name: seed.name, document: seed.document }))];
}

function mutations(seed: CorpusCase): CorpusCase[] {
  const cases: CorpusCase[] = [];
  for (const path of locations(seed.document)) {
    const label = path.length === 0 ? "<root>" : path.join(".");
    for (const replacement of REPLACEMENTS) {
      cases.push({
        name: `mutate/${seed.name}/${label}=${replacement.label}`,
        document: withReplacement(seed.document, path, replacement.value),
      });
    }
    if (path.length > 0) {
      cases.push({ name: `mutate/${seed.name}/${label}:dropped`, document: without(seed.document, path) });
    }
    const node = at(seed.document, path);
    if (isObject(node)) {
      cases.push({ name: `mutate/${seed.name}/${label}:unknown-key`, document: withUnknownKey(seed.document, path) });
    }
    if (Array.isArray(node)) {
      for (const extra of [null, 1, "x", {}] as const) {
        cases.push({
          name: `mutate/${seed.name}/${label}:extra-element=${JSON.stringify(extra)}`,
          document: withReplacement(seed.document, path, [...node, extra]),
        });
      }
    }
  }
  return cases;
}

let cached: CorpusCase[] | undefined;

/** The full corpus, built once per process. */
export function policyCorpus(): CorpusCase[] {
  if (cached !== undefined) return cached;
  const all: CorpusCase[] = [];
  for (const seed of seeds()) {
    all.push(seed, ...mutations(seed));
  }
  for (const boundary of BOUNDARY_CASES) {
    // A boundary case is already a targeted mutation: expanding it again would multiply the
    // corpus without adding a new shape.
    all.push(boundary);
  }
  // Two same-name documents would make a failure ambiguous; the labels above are unique, and the
  // count is asserted by the test rather than left to drift.
  cached = all;
  return all;
}

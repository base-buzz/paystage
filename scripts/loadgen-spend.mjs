#!/usr/bin/env node
/**
 * What our own testing has cost, published from the chain rather than estimated in prose (#500).
 *
 *   node scripts/loadgen-spend.mjs            # write the snapshot
 *   node scripts/loadgen-spend.mjs --check     # exit 10 when the snapshot disagrees with its inputs
 *
 * Inputs, both already committed:
 *   - `apps/console/src/lib/payments-incoming.generated.json` — every USDC transfer to our payee, classified ours/external;
 *   - `docs/state/gas-distribution.json` — the measured gas price distribution.
 *
 * The number a sceptical reader asks for is not "how much have you moved" — money moved to ourselves is a round trip. It is **what the
 * round trip cost**, in gas, against a stated cap. So this publishes gas burned and headroom, and says plainly that the USDC came back.
 *
 * Assumptions are named, not hidden: gas per settlement is 85,720 — the figure the one live self-facilitated settlement actually used — and
 * the gas price is the p90 of the measured distribution, so the estimate is on the expensive side of normal.
 */
import { readFileSync, writeFileSync } from "node:fs";

const PAYMENTS = "apps/console/src/lib/payments-incoming.generated.json";
const GAS = "docs/state/gas-distribution.json";
const OUT = "apps/console/src/lib/loadgen-spend.generated.json";

/** The cap the loadgen runs under: $50 per 30 days, set by the operator. */
const CAP_USD_30D = 50;
/** Gas units one EIP-3009 settlement used on mainnet, measured by the self-facilitator settlement on 2026-11-28. */
const GAS_UNITS_PER_SETTLEMENT = 85_720;

const payments = JSON.parse(readFileSync(PAYMENTS, "utf8"));
const gas = JSON.parse(readFileSync(GAS, "utf8"));

const oursSettlements = Number(payments.counts?.ours ?? 0);
const movedAtomic = BigInt(payments.totals?.amountAtomic ?? "0");
/** USDC has 6 decimals; integer maths, because a float that adds 0.002 two hundred times drifts. */
const movedUsdc = Number(movedAtomic) / 1e6;

const gasGwei = Number(gas.gwei?.p90 ?? gas.gwei?.p50 ?? 0);
const ethUsd = Number(gas.ethUsd ?? 0);
if (!(gasGwei > 0) || !(ethUsd > 0)) {
  console.error("loadgen-spend: the gas snapshot has no usable price — refusing to publish a cost computed from nothing");
  process.exit(2);
}

const gasPerSettlementUsd = GAS_UNITS_PER_SETTLEMENT * gasGwei * 1e-9 * ethUsd;
const gasBurnedUsd = gasPerSettlementUsd * oursSettlements;

const snapshot = {
  schema: "paystage/loadgen-spend@1",
  generatedAt: new Date().toISOString(),
  inputs: { payments: PAYMENTS, gas: GAS },
  cappedAt: { usd: CAP_USD_30D, windowDays: 30 },
  settlements: oursSettlements,
  usdcMoved: movedUsdc.toFixed(6),
  /** Stated so nobody reads "moved" as revenue: every transfer was to our own payee. */
  usdcReturnedToOurselves: movedUsdc.toFixed(6),
  gas: {
    unitsPerSettlement: GAS_UNITS_PER_SETTLEMENT,
    gasPriceGweiP90: gasGwei,
    ethUsd,
    perSettlementUsd: Number(gasPerSettlementUsd.toFixed(6)),
    burnedUsd: Number(gasBurnedUsd.toFixed(4)),
    percentOfCap: Number(((gasBurnedUsd / CAP_USD_30D) * 100).toFixed(2)),
    headroomUsd: Number((CAP_USD_30D - gasBurnedUsd).toFixed(2)),
  },
  provenance: "every payer is ours — the loadgen keys and the paid-e2e probe, listed in data/payments/known-payers.json",
  measuredOn: gas.sampledAt ?? null,
};

if (process.argv.includes("--check")) {
  let previous;
  try {
    previous = JSON.parse(readFileSync(OUT, "utf8"));
  } catch {
    console.error(`loadgen-spend: ${OUT} is missing — run without --check to write it`);
    process.exit(10);
  }
  const same =
    previous.settlements === snapshot.settlements &&
    previous.gas?.burnedUsd === snapshot.gas.burnedUsd &&
    previous.usdcMoved === snapshot.usdcMoved;
  if (!same) {
    console.error(`loadgen-spend: ${OUT} is stale — re-run node scripts/loadgen-spend.mjs`);
    process.exit(10);
  }
  console.log(`loadgen-spend: current — ${snapshot.settlements} settlements, $${snapshot.gas.burnedUsd} gas (${snapshot.gas.percentOfCap}% of cap)`);
  process.exit(0);
}

writeFileSync(OUT, JSON.stringify(snapshot, null, 1) + "\n");
console.log(
  `loadgen-spend: ${snapshot.settlements} settlements · ${snapshot.usdcMoved} USDC moved (returned to ourselves) · ` +
    `gas $${snapshot.gas.burnedUsd} at ${gasGwei} gwei / ETH $${ethUsd} = ${snapshot.gas.percentOfCap}% of the $${CAP_USD_30D}/30d cap`,
);

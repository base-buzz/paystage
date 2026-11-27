#!/usr/bin/env node
/**
 * The price is 32% gas, and that ratio has an expiry date nobody wrote on it (#491).
 *
 * Recomputes the unit economics from the constants in `docs/economics.md` and fails when gas passes **50%** of the sale price at
 * the gas price the document names. It also fails when the prose and the constants disagree, because the failure mode this guards
 * is not "gas got expensive" — it is "the sentence stayed the same while the arithmetic moved".
 *
 * Exit 0 ok · 10 gas above the ceiling · 11 the document no longer states what it computed from.
 */
import { readFileSync } from "node:fs";

const DOC = "docs/economics.md";
const CEILING = 0.5;

const doc = readFileSync(DOC, "utf8");
const num = (label, pattern) => {
  const found = doc.match(pattern)?.[1]?.replace(/,/g, "");
  if (found === undefined) {
    console.error(`unit-economics: ${DOC} no longer states ${label} — the check refuses to guess`);
    process.exit(11);
  }
  return Number(found);
};

const priceAtomic = num("the price in atomic units", /`PRICE_ATOMIC` \| `(\d+)`/);
const gasUnits = num("the gas units", /`GAS_UNITS` \| `([\d,]+)`/);
const gasPriceGwei = num("the gas price", /`GAS_PRICE_GWEI` \| `([\d.]+)`/);
const ethUsd = num("the ETH price", /`ETH_USD` \| `([\d,.]+)`/);
const documentedCost = Number(`0.${doc.match(/\$0\.(\d{6})`? = 65,000/)?.[1] ?? "NaN"}`);

const priceUsd = priceAtomic / 1e6;
const gasUsd = (gasUnits * gasPriceGwei * 1e-9 * ethUsd);
const share = gasUsd / priceUsd;
const ceilingGwei = (gasPriceGwei * (CEILING * priceUsd)) / gasUsd;

const fmt = (v, digits = 6) => `$${v.toFixed(digits)}`;
console.log(
  `unit-economics: price ${fmt(priceUsd)} · gas ${fmt(gasUsd)} at ${gasPriceGwei} gwei / ETH ${ethUsd} = ` +
    `${(share * 100).toFixed(1)}% of revenue · 50% ceiling at ${ceilingGwei.toFixed(4)} gwei`,
);

if (share > CEILING) {
  console.error(
    `unit-economics: gas is ${(share * 100).toFixed(1)}% of the price at the documented ${gasPriceGwei} gwei — above the ${CEILING * 100}% ceiling. ` +
      "Raise the price, batch settlement, or publish the loss.",
  );
  process.exit(10);
}

if (Number.isFinite(documentedCost)) {
  const proseUsd = documentedCost;
  if (Math.abs(proseUsd - gasUsd) > 0.000005) {
    console.error(`unit-economics: the prose says ${fmt(proseUsd)} but the constants give ${fmt(gasUsd)} — one of them moved`);
    process.exit(10);
  }
}

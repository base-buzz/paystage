#!/usr/bin/env node
// Verify CORS preflight allows the exact header set used by the paid retry.

const ORIGIN = "https://paystage.xyz";
const REQUEST_HEADERS =
  "content-type,payment-signature,x-payment,access-control-expose-headers,x-paystage-request-id,accept";

const REQUIRED = [
  "content-type",
  "payment-signature",
  "x-payment",
  "access-control-expose-headers",
  "x-paystage-request-id",
  "accept",
];

const targets = [
  { name: "sepolia", url: "https://sepolia.api.paystage.xyz/v1/evaluate_mcp_payment" },
  { name: "mainnet", url: "https://api.paystage.xyz/v1/evaluate_mcp_payment" },
];

let failed = false;

for (const target of targets) {
  try {
    const res = await fetch(target.url, {
      method: "OPTIONS",
      headers: {
        Origin: ORIGIN,
        "Access-Control-Request-Method": "POST",
        "Access-Control-Request-Headers": REQUEST_HEADERS,
      },
    });
    const allowOrigin = res.headers.get("access-control-allow-origin");
    const allowHeaders = (res.headers.get("access-control-allow-headers") || "").toLowerCase();
    const expose = (res.headers.get("access-control-expose-headers") || "").toLowerCase();
    console.log(
      `${target.name}: status=${res.status} allow-origin=${allowOrigin}`,
    );
    if (![200, 204].includes(res.status)) {
      throw new Error(`bad status ${res.status}`);
    }
    if (allowOrigin !== ORIGIN) {
      throw new Error(`allow-origin=${allowOrigin}`);
    }
    for (const h of REQUIRED) {
      if (!allowHeaders.includes(h)) {
        throw new Error(`missing allow-header ${h} in ${allowHeaders}`);
      }
    }
    if (!expose.includes("payment-required")) {
      throw new Error(`expose missing payment-required: ${expose}`);
    }
    if (!expose.includes("x-paystage-request-id")) {
      throw new Error(`expose missing x-paystage-request-id: ${expose}`);
    }
    console.log(`${target.name}: OK`);
  } catch (err) {
    failed = true;
    console.error(`FAIL ${target.name}: ${err && err.message}`);
  }
}

if (failed) process.exit(1);
console.log("OK");

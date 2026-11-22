/**
 * The seller example is a file, so its guarantees have to be tests — especially the one that matters:
 * removing the gate call must turn the suite red.
 *
 *   node --test examples/seller/seller.test.mjs
 *
 * No network is used: the client is `node:http` against 127.0.0.1, and the offline case replaces
 * `globalThis.fetch` with a thrower. Nothing is signed on chain and no funds move.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { verifyReceipt } from "@paystage/receipt-verify";
import { createSeller, PAID_PATH, USDC_BASE, MEASURED_MEDIAN_ATOMIC } from "./seller.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const PAY_TO = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

function request(baseUrl, path, { method = "POST", headers = {}, body } = {}) {
  const url = new URL(path, baseUrl);
  return new Promise((resolvePromise, reject) => {
    const req = httpRequest(
      {
        hostname: url.hostname,
        port: url.port,
        path: `${url.pathname}${url.search}`,
        method,
        headers: { connection: "close", ...headers },
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            // Some responses (404) are still JSON in this server; keep null for a readable assertion.
          }
          resolvePromise({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("error", reject);
    if (body !== undefined) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

async function withSeller(options, fn) {
  const seller = await createSeller({
    payTo: PAY_TO,
    // Tests never read the host's /work/ops snapshot; the default is the stated built-in median.
    snapshotPath: null,
    silent: true,
    ...options,
  });
  const url = await seller.listen();
  try {
    return await fn(seller, url);
  } finally {
    await seller.close();
  }
}

function paymentHeader(accept, identifier) {
  const payload = {
    x402Version: 2,
    accepted: accept,
    payload: {
      scheme: "exact",
      note: "synthetic test payload — this example does not verify an EIP-3009 signature",
    },
    ...(identifier === undefined
      ? {}
      : { extensions: { "payment-identifier": { info: { required: false, id: identifier } } } }),
  };
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

const TEST_ID = "pay_seller_test_00000001";

test("unpaid request returns a real 402 with accepts, bazaar schema and payment-identifier", async () => {
  await withSeller({}, async (seller, url) => {
    const res = await request(url, PAID_PATH, { body: { text: "hello" } });
    assert.equal(res.status, 402);
    assert.equal(res.json.x402Version, 2);
    assert.equal(res.json.accepts.length, 1);

    const accept = res.json.accepts[0];
    assert.equal(accept.scheme, "exact");
    assert.equal(accept.network, "eip155:8453");
    assert.equal(accept.asset, USDC_BASE);
    assert.equal(accept.amount, "9000");
    assert.equal(accept.amount, MEASURED_MEDIAN_ATOMIC.toString());
    assert.equal(accept.payTo, PAY_TO);
    assert.equal(accept.maxTimeoutSeconds, 300);

    const bazaar = res.json.extensions.bazaar;
    assert.equal(bazaar.routeTemplate, PAID_PATH);
    assert.equal(bazaar.info.input.type, "http");
    assert.equal(bazaar.info.input.method, "POST");
    assert.equal(bazaar.info.input.bodyType, "json");
    assert.deepEqual(bazaar.info.input.body.required, ["text"]);
    assert.equal(bazaar.info.input.body.properties.text.type, "string");
    assert.equal(bazaar.schema.$schema, "https://json-schema.org/draft/2020-12/schema");
    assert.ok(bazaar.schema.properties.input.required.includes("body"));

    assert.equal(res.json.extensions["payment-identifier"].info.required, false);
    assert.equal(
      res.json.extensions["payment-identifier"].schema.properties.id.maxLength,
      128,
    );

    const headerChallenge = JSON.parse(Buffer.from(res.headers["payment-required"], "base64").toString("utf8"));
    assert.deepEqual(headerChallenge, res.json);
    assert.equal(res.headers["x-paystage-verdict"], "pay");
    assert.equal(seller.state.gateCalls, 1);
  });
});

test("the gate refuses an over-cap price before advertising it — the test that fails if the call is removed", async () => {
  // $0.02 per call against the default $0.01 max_amount. Without the gate call this request returns
  // 402 (and a paid retry would return 200); with it, the refusal names `accept.max_amount`.
  await withSeller({ priceAtomic: "20000" }, async (seller, url) => {
    const unpaid = await request(url, PAID_PATH, { body: { text: "hello" } });
    assert.equal(unpaid.status, 403);
    assert.equal(unpaid.json.error, "blocked_by_gate");
    assert.equal(unpaid.json.message, "blocked-by-rule: accept.max_amount");
    assert.equal(unpaid.json.rule, "accept.max_amount");
    assert.equal(unpaid.json.verdict, "do_not_pay");
    assert.equal(unpaid.headers["x-paystage-verdict"], "do_not_pay");
    assert.equal(unpaid.headers["x-paystage-rule"], "accept.max_amount");
    assert.equal(unpaid.json.accepts, undefined);
    assert.equal(seller.state.gateCalls, 1);
    assert.equal(seller.state.lastGate.rule, "accept.max_amount");

    const overCapAccept = {
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC_BASE,
      amount: "20000",
      payTo: PAY_TO,
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    };
    const paid = await request(url, PAID_PATH, {
      headers: {
        "payment-signature": paymentHeader(overCapAccept, TEST_ID),
        "payment-identifier": TEST_ID,
      },
      body: { text: "hello" },
    });
    assert.equal(paid.status, 403);
    assert.equal(paid.json.error, "blocked_by_gate");
    assert.equal(paid.json.rule, "accept.max_amount");
    assert.equal(seller.state.simulatedSettlements, 0);
  });
});

test("a paid call returns a receipt that @paystage/receipt-verify accepts", async () => {
  await withSeller({ snapshotPath: join(HERE, "fixtures", "supply-snapshot.json") }, async (seller, url) => {
    const challenge = await request(url, PAID_PATH, { body: { text: "hello" } });
    assert.equal(challenge.status, 402);
    assert.match(seller.config.median.source, /^snapshot:/);
    assert.equal(seller.config.median.rows, 3);
    assert.equal(seller.config.priceAtomic, 9000n);

    const accept = challenge.json.accepts[0];
    const paid = await request(url, PAID_PATH, {
      headers: {
        "payment-signature": paymentHeader(accept, TEST_ID),
        "payment-identifier": TEST_ID,
        "content-type": "application/json",
      },
      body: { text: "one two three four five", max_words: 3 },
    });

    assert.equal(paid.status, 200);
    assert.equal(paid.headers["x-paystage-verdict"], "pay");
    assert.equal(paid.json.summary, "one two three …");
    assert.equal(paid.json.words, 3);
    assert.equal(paid.json.settlement.mode, "simulated");
    assert.equal(paid.json.settlement.on_chain, false);

    const receipt = paid.json.receipt;
    assert.equal(receipt.v, 1);
    assert.equal(receipt.issuer, "paystage-seller-example");
    assert.equal(receipt.signed, true);
    assert.equal(receipt.alg, "ECDSA-P256-SHA256");
    assert.equal(receipt.key_id, "seller-example-test-key-v1");
    assert.equal(receipt.verdict.decision, "pay");
    assert.equal(receipt.payment.scheme, "exact");
    assert.equal(receipt.payment.network, "eip155:8453");
    assert.equal(receipt.payment.asset, USDC_BASE);
    assert.equal(receipt.payment.amount, "9000");
    assert.equal(receipt.payment.payee, PAY_TO);
    assert.match(receipt.request_sha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.policy_sha256, /^[0-9a-f]{64}$/);
    assert.match(receipt.signature, /^[A-Za-z0-9_-]+$/);

    const payment = {
      scheme: "exact",
      network: "eip155:8453",
      asset: USDC_BASE,
      amount: "9000",
      payee: PAY_TO,
    };

    const viaJwk = await verifyReceipt(receipt, {
      jwk: seller.publicJwk,
      expectedRequest: challenge.json,
      expectedPolicy: seller.policy,
      payment,
    });
    assert.equal(viaJwk.ok, true);
    assert.equal(viaJwk.status, "signed-and-valid");
    assert.equal(viaJwk.verdict, "pay");

    // The receipt is served too, and the key document is served, so a third party can fetch both.
    const served = await request(url, paid.json.receipt_url, { method: "GET" });
    assert.equal(served.status, 200);
    assert.deepEqual(served.json, receipt);

    const viaServedKey = await verifyReceipt(receipt, {
      keyUrl: `${url}/.well-known/paystage-receipt-key.json`,
      expectedRequest: challenge.json,
      expectedPolicy: seller.policy,
      payment,
    });
    assert.equal(viaServedKey.ok, true);
    assert.equal(viaServedKey.status, "signed-and-valid");
  });
});

test("a repeated payment-identifier is idempotent: same bytes, one simulated settlement", async () => {
  await withSeller({}, async (seller, url) => {
    const challenge = await request(url, PAID_PATH, { body: { text: "hello" } });
    const accept = challenge.json.accepts[0];
    const headers = {
      "payment-signature": paymentHeader(accept, TEST_ID),
      "payment-identifier": TEST_ID,
      "content-type": "application/json",
    };

    const first = await request(url, PAID_PATH, { headers, body: { text: "same input" } });
    const second = await request(url, PAID_PATH, { headers, body: { text: "same input" } });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(first.text, second.text);
    assert.deepEqual(first.json.receipt, second.json.receipt);
    assert.equal(second.headers["x-paystage-idempotent-replay"], "true");
    assert.equal(seller.state.simulatedSettlements, 1);
    assert.equal(seller.state.idempotentReplays, 1);
    assert.equal(seller.state.idempotency.size, 1);
  });
});

test("the whole flow works with the network unavailable (fetch mocked to throw)", async () => {
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => {
    throw new Error("network disabled by test");
  };
  try {
    await withSeller({}, async (seller, url) => {
      const challenge = await request(url, PAID_PATH, { body: { text: "offline" } });
      assert.equal(challenge.status, 402);
      const paid = await request(url, PAID_PATH, {
        headers: {
          "payment-signature": paymentHeader(challenge.json.accepts[0], TEST_ID),
          "payment-identifier": TEST_ID,
        },
        body: { text: "offline" },
      });
      assert.equal(paid.status, 200);

      const verified = await verifyReceipt(paid.json.receipt, {
        jwk: seller.publicJwk,
        expectedRequest: challenge.json,
        expectedPolicy: seller.policy,
        payment: {
          scheme: "exact",
          network: "eip155:8453",
          asset: USDC_BASE,
          amount: "9000",
          payee: PAY_TO,
        },
      });
      assert.equal(verified.ok, true);
      assert.equal(verified.status, "signed-and-valid");
    });
  } finally {
    globalThis.fetch = realFetch;
  }
});

test("the built-in median is the measured $0.009, and an explicit median wins", async () => {
  await withSeller({}, async (seller) => {
    assert.equal(seller.config.priceAtomic, MEASURED_MEDIAN_ATOMIC);
    assert.match(seller.config.median.source, /^builtin:/);
  });

  await withSeller({ medianAtomic: "12345" }, async (seller) => {
    assert.equal(seller.config.priceAtomic, 12345n);
    assert.equal(seller.config.median.source, "env:MEDIAN_ATOMIC");
  });
});

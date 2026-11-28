import assert from "node:assert/strict";
import { test } from "node:test";

import {
  ASK_ANSWERS,
  ASK_OPTIONS,
  NOT_CONNECTED,
  QUESTION,
  afterAskReply,
  initialAskView,
} from "../src/lib/ask-survey.ts";
import { handleAsk, hashIp, readAskSnapshot } from "../src/lib/ask-server.ts";

/**
 * The route contract, tested against a fake PostgREST rather than a live project.
 *
 * The fake enforces the same uniqueness rule the migration does — (ip_hash, day) — so the
 * one-answer-per-address test exercises the hash the route computed, not a clock. Every failure test
 * also asserts the absence of `count`: that is the "never fabricate a count" rule in executable form.
 */

const ENV = {
  SURVEY_SUPABASE_URL: "https://project.supabase.test",
  SURVEY_SUPABASE_ANON_KEY: "anon-key-for-test",
  SURVEY_IP_SALT: "test-salt",
};

const OPENED_ON = "2026-11-28";

function requestFor(answer, { ip = "203.0.113.7", referrer = "https://paystage.xyz/directory" } = {}) {
  return new Request("https://vouchguard.app/api/ask", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "cf-connecting-ip": ip,
      ...(referrer ? { referer: referrer } : {}),
    },
    body: JSON.stringify({ answer, page: "/ask" }),
  });
}

/** A PostgREST stand-in that stores rows keyed by ip_hash only — one fixed day, no clock. */
function fakeDatabase(options = {}) {
  const rows = new Map();
  const calls = [];
  const mode = options.mode ?? "ok";
  let answerCount = options.startCount ?? 0;

  const fetchImpl = async (input, init = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: init.headers });

    if (mode === "missing") {
      return new Response(
        JSON.stringify({ code: "PGRST202", message: "Could not find the function public.ask_answer" }),
        { status: 404, headers: { "content-type": "application/json" } },
      );
    }
    if (mode === "down") {
      return new Response(JSON.stringify({ message: "upstream failed" }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }

    if (url.endsWith("/rpc/ask_answer")) {
      const stored = !rows.has(body.p_ip_hash);
      if (stored) {
        rows.set(body.p_ip_hash, body.p_answer);
        answerCount += 1;
      }
      return new Response(
        JSON.stringify([{ stored, response_count: answerCount, opened_on: OPENED_ON }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    if (url.endsWith("/rpc/ask_count")) {
      return new Response(
        JSON.stringify([{ response_count: answerCount, opened_on: answerCount > 0 ? OPENED_ON : null }]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ message: "no such route" }), { status: 404 });
  };

  return { fetchImpl, calls, rows, get count() { return answerCount; } };
}

test("a valid answer inserts through ask_answer and returns the count read back", async () => {
  const db = fakeDatabase({ startCount: 4 });
  const response = await handleAsk(requestFor("yes"), { env: ENV, fetchImpl: db.fetchImpl });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.deepEqual(body, { stored: true, count: 5, openedOn: OPENED_ON });
  assert.equal(db.rows.size, 1);

  const call = db.calls.find((entry) => entry.url.endsWith("/rpc/ask_answer"));
  assert.ok(call, "the route called ask_answer");
  assert.equal(call.body.p_answer, "yes");
  assert.equal(call.body.p_page, "/ask");
  assert.equal(call.body.p_referrer, "https://paystage.xyz/directory");
  assert.match(call.body.p_ip_hash, /^[0-9a-f]{64}$/);
  assert.equal(call.headers.apikey, ENV.SURVEY_SUPABASE_ANON_KEY);
  assert.equal(call.headers.authorization, `Bearer ${ENV.SURVEY_SUPABASE_ANON_KEY}`);
  assert.ok(!JSON.stringify(call).includes("203.0.113.7"), "the address itself never leaves the route");
});

test("an invalid answer is rejected 400 before any database call", async () => {
  const db = fakeDatabase();
  for (const answer of ["maybe", "", null, "YES"]) {
    const response = await handleAsk(requestFor(answer), { env: ENV, fetchImpl: db.fetchImpl });
    const body = await response.json();
    assert.equal(response.status, 400, `answer ${JSON.stringify(answer)} should be rejected`);
    assert.equal(body.stored, false);
    assert.ok(!("count" in body), "a rejected answer has no count");
  }
  assert.equal(db.calls.length, 0);
});

test("a missing table or function answers stored:false and does not throw", async () => {
  const db = fakeDatabase({ mode: "missing" });
  const response = await handleAsk(requestFor("no"), { env: ENV, fetchImpl: db.fetchImpl });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stored, false);
  assert.match(body.reason, /not connected/i);
  assert.ok(!("count" in body), "a missing counter has no count");
});

test("the same address twice in one day gets one row and no second count", async () => {
  const db = fakeDatabase();
  const first = await handleAsk(requestFor("yes", { ip: "198.51.100.9" }), { env: ENV, fetchImpl: db.fetchImpl });
  const second = await handleAsk(requestFor("no", { ip: "198.51.100.9" }), { env: ENV, fetchImpl: db.fetchImpl });

  const firstBody = await first.json();
  const secondBody = await second.json();

  assert.deepEqual(firstBody, { stored: true, count: 1, openedOn: OPENED_ON });
  assert.equal(secondBody.stored, false);
  assert.match(secondBody.reason, /one answer per address per day/i);
  assert.ok(!("count" in secondBody), "a repeat is not shown as a fresh count");
  assert.equal(db.count, 1, "the fake database holds exactly one row");
});

test("a different address on the same day is stored", async () => {
  const db = fakeDatabase();
  await handleAsk(requestFor("yes", { ip: "198.51.100.1" }), { env: ENV, fetchImpl: db.fetchImpl });
  const second = await handleAsk(requestFor("already", { ip: "198.51.100.2" }), {
    env: ENV,
    fetchImpl: db.fetchImpl,
  });
  const body = await second.json();

  assert.equal(body.stored, true);
  assert.equal(body.count, 2);
  assert.equal(db.rows.size, 2);
});

test("the IP hash is salted, stable, and not the address", async () => {
  const one = await hashIp("203.0.113.7", "salt-one");
  const two = await hashIp("203.0.113.7", "salt-one");
  const differentSalt = await hashIp("203.0.113.7", "salt-two");

  assert.match(one, /^[0-9a-f]{64}$/);
  assert.equal(one, two);
  assert.notEqual(one, differentSalt);
  assert.ok(!one.includes("203.0.113.7"));
});

test("a service-role key is refused instead of being used on the public path", async () => {
  const payload = Buffer.from(JSON.stringify({ role: "service_role" })).toString("base64url");
  const key = `header.${payload}.signature`;
  const db = fakeDatabase();
  const env = { ...ENV, SURVEY_SUPABASE_ANON_KEY: key };

  const response = await handleAsk(requestFor("yes"), { env, fetchImpl: db.fetchImpl });
  const body = await response.json();
  assert.equal(body.stored, false);
  assert.match(body.reason, /service-role key; refusing/);
  assert.ok(!("count" in body));
  assert.equal(db.calls.length, 0, "the route did not call Supabase with a service-role key");

  const snapshot = await readAskSnapshot({ env, fetchImpl: db.fetchImpl });
  assert.equal(snapshot.connected, false);
  assert.equal(snapshot.count, null);
});

test("no salt means no storage, because an unsalted hash is reversible", async () => {
  const db = fakeDatabase();
  const response = await handleAsk(requestFor("yes"), {
    env: { ...ENV, SURVEY_IP_SALT: "" },
    fetchImpl: db.fetchImpl,
  });
  const body = await response.json();

  assert.equal(body.stored, false);
  assert.match(body.reason, /hashing secret is not configured/i);
  assert.ok(!("count" in body));
  assert.equal(db.calls.length, 0);
});

test("an unreachable counter answers stored:false with no count and no throw", async () => {
  const db = fakeDatabase({ mode: "down" });
  const response = await handleAsk(requestFor("yes"), { env: ENV, fetchImpl: db.fetchImpl });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.stored, false);
  assert.ok(!("count" in body));
});

test("a reply without a read count is never turned into a count", async () => {
  const cases = [
    [{ stored: true }],
    [{ stored: true, response_count: "many" }],
    [{ stored: true, response_count: -1 }],
    [{ stored: true, response_count: 1.5 }],
    [],
    { stored: true, response_count: null },
  ];

  for (const payload of cases) {
    const response = await handleAsk(requestFor("yes"), {
      env: ENV,
      fetchImpl: async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    });
    const body = await response.json();
    assert.equal(body.stored, false, `payload ${JSON.stringify(payload)} is not a stored count`);
    assert.ok(!("count" in body), `payload ${JSON.stringify(payload)} must not produce a count`);
  }
});

test("readAskSnapshot reads the count, and reports not connected when the function is missing", async () => {
  const db = fakeDatabase({ startCount: 7 });
  const snapshot = await readAskSnapshot({ env: ENV, fetchImpl: db.fetchImpl });
  assert.deepEqual(snapshot, { connected: true, count: 7, openedOn: OPENED_ON, reason: null });

  const missing = await readAskSnapshot({
    env: ENV,
    fetchImpl: fakeDatabase({ mode: "missing" }).fetchImpl,
  });
  assert.equal(missing.connected, false);
  assert.equal(missing.count, null);
  assert.match(missing.reason, /not connected/i);
});

test("the page view shows a count only when the snapshot or reply stored one", () => {
  const notConnected = initialAskView({ connected: false, count: null, openedOn: "2026-11-28", reason: "x" });
  assert.equal(notConnected.showCount, false);
  assert.equal(notConnected.notice, NOT_CONNECTED);

  const emptyButConnected = initialAskView({
    connected: true,
    count: 0,
    openedOn: "2026-11-28",
    reason: null,
  });
  assert.equal(emptyButConnected.showCount, true, "0 is a real count once the counter answered");
  assert.equal(emptyButConnected.count, 0);

  const failed = afterAskReply(emptyButConnected, { stored: false, reason: NOT_CONNECTED });
  assert.equal(failed.showCount, false);
  assert.equal(failed.count, null);

  const fabricated = afterAskReply(emptyButConnected, { stored: true, count: "3" });
  assert.equal(fabricated.showCount, true);
  assert.equal(fabricated.count, 0, "a malformed reply does not overwrite a read count");

  const stored = afterAskReply(emptyButConnected, { stored: true, count: 3, openedOn: OPENED_ON });
  assert.equal(stored.showCount, true);
  assert.equal(stored.count, 3);
});

test("the three answer values are exactly the ones the migration accepts", () => {
  assert.deepEqual([...ASK_ANSWERS], ["yes", "no", "already"]);
  assert.deepEqual(
    ASK_OPTIONS.map((option) => option.label),
    ["Yes", "No", "Already do it"],
  );
  assert.match(QUESTION, /Would you put a team's agent spend behind a limit you can see\?/);
});

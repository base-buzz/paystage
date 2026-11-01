import {
  dailyTarget,
  projectedSpend,
  shouldStop,
  BUDGET_USD_TOTAL,
  DAILY_MAX_CALLS,
  MAX_DAYS,
  PRICE_PER_CALL_USD,
  FACILITATOR_PER_TX_USD,
  FACILITATOR_FREE_MONTHLY,
} from "./caps";
import { dayIndexFromStart, callsRemainingToday } from "./schedule";
import { loadWallets, publicWalletList } from "./wallets";
import { pickScenario } from "./scenarios";
import { pickFundedWallet } from "./balance";
import { runPaidSyntheticCall } from "./pay";

export interface Env {
  LOADGEN_STATE: KVNamespace;
  LOADGEN_ENABLED?: string;
  LOADGEN_PAY?: string;
  LOADGEN_KILL?: string;
  LOADGEN_START_DATE?: string;
  API_BASE?: string;
  LOADGEN_KEY_1?: string;
  LOADGEN_KEY_2?: string;
  LOADGEN_KEY_3?: string;
  BASE_RPC_URL?: string;
  ALCHEMY_API_KEY?: string;
  ALCHEMY_BASE_URL?: string;
}

export interface LoadgenState {
  dayKey: string;
  callsToday: number;
  totalCalls: number;
  totalSpendUsd: number;
  startedAt: string | null;
  stoppedReason: string | null;
  kill?: boolean;
}

const STATE_KEY = "state";
const START_KEY = "startDate";

function todayKey(now: Date): string {
  return now.toISOString().slice(0, 10);
}

async function readState(env: Env): Promise<LoadgenState> {
  const raw = await env.LOADGEN_STATE.get(STATE_KEY);
  if (raw) {
    try {
      return JSON.parse(raw) as LoadgenState;
    } catch {
      /* fallthrough */
    }
  }
  return {
    dayKey: todayKey(new Date()),
    callsToday: 0,
    totalCalls: 0,
    totalSpendUsd: 0,
    startedAt: null,
    stoppedReason: null,
  };
}

async function writeState(env: Env, s: LoadgenState): Promise<void> {
  await env.LOADGEN_STATE.put(STATE_KEY, JSON.stringify(s));
}

async function resolveStartDate(env: Env, now: Date): Promise<string> {
  const envDate = (env.LOADGEN_START_DATE || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(envDate)) return envDate;
  const stored = await env.LOADGEN_STATE.get(START_KEY);
  if (stored) return stored;
  const d = todayKey(now);
  await env.LOADGEN_STATE.put(START_KEY, d);
  return d;
}

function enabled(env: Env): boolean {
  return env.LOADGEN_ENABLED === "1" && env.LOADGEN_KILL !== "1";
}

async function isKilled(env: Env, s: LoadgenState): Promise<boolean> {
  return env.LOADGEN_KILL === "1" || !!s.kill;
}

interface CallResult {
  scenario: "allow" | "policy_block" | "velocity_deny";
  ok: boolean;
  paid: boolean;
  status: number;
  note?: string;
}

async function callApi(
  env: Env,
  path: string,
  init: RequestInit,
): Promise<Response> {
  const base = env.API_BASE || "https://api.paystage.xyz";
  const headers = new Headers(init.headers || {});
  headers.set("X-PayStage-Source", "synthetic");
  if (!headers.has("content-type") && init.body) {
    headers.set("content-type", "application/json");
  }
  return fetch(`${base}${path}`, { ...init, headers });
}

async function dryRunAllow(env: Env): Promise<CallResult> {
  try {
    const res = await callApi(env, "/v1/public/status", { method: "GET" });
    return {
      scenario: "allow",
      ok: res.ok,
      paid: false,
      status: res.status,
      note: "dry_run",
    };
  } catch {
    return {
      scenario: "allow",
      ok: false,
      paid: false,
      status: 0,
      note: "fetch_error",
    };
  }
}

function resolveRpcUrl(env: Env): string {
  const direct = env.ALCHEMY_BASE_URL?.trim() || env.BASE_RPC_URL?.trim();
  if (direct) return direct;
  const key = env.ALCHEMY_API_KEY?.trim();
  if (key) return `https://base-mainnet.g.alchemy.com/v2/${key}`;
  return "https://mainnet.base.org";
}

async function paidAllow(env: Env): Promise<CallResult> {
  if (env.LOADGEN_PAY !== "1" || env.LOADGEN_ENABLED !== "1") {
    return dryRunAllow(env);
  }
  const wallets = loadWallets(env);
  const rpcUrl = resolveRpcUrl(env);
  const picked = await pickFundedWallet(wallets, rpcUrl);
  if (!picked) {
    return {
      scenario: "allow",
      ok: false,
      paid: false,
      status: 0,
      note: "insufficient_funds",
    };
  }
  try {
    const result = await runPaidSyntheticCall({
      account: picked.wallet.account,
      apiBase: env.API_BASE || "https://api.paystage.xyz",
    });
    return {
      scenario: "allow",
      ok: result.ok,
      paid: !!result.txHash,
      status: result.status,
      note: result.txHash
        ? `tx:${result.txHash}`
        : result.decision
          ? `decision:${result.decision}`
          : undefined,
    };
  } catch (e) {
    return {
      scenario: "allow",
      ok: false,
      paid: false,
      status: 0,
      note: e instanceof Error ? e.message.slice(0, 120) : "pay_error",
    };
  }
}

async function policyBlock(env: Env): Promise<CallResult> {
  try {
    const res = await callApi(env, "/v1/evaluate_mcp_payment", {
      method: "POST",
      body: JSON.stringify({
        maxAmountRequired: "999999",
        network: "eip155:8453",
        source: "synthetic",
      }),
    });
    return {
      scenario: "policy_block",
      ok: res.status >= 400,
      paid: false,
      status: res.status,
    };
  } catch {
    return {
      scenario: "policy_block",
      ok: false,
      paid: false,
      status: 0,
      note: "fetch_error",
    };
  }
}

async function velocityDeny(env: Env): Promise<CallResult> {
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        callApi(env, "/v1/evaluate_mcp_payment", {
          method: "POST",
          body: JSON.stringify({
            maxAmountRequired: "0.002",
            network: "eip155:8453",
            source: "synthetic",
          }),
        }).catch(() => null),
      ),
    );
    const denied = results.some(
      (r) => r && (r.status === 429 || r.status === 403 || r.status >= 400),
    );
    return {
      scenario: "velocity_deny",
      ok: denied,
      paid: false,
      status: results.find((r) => r)?.status ?? 0,
    };
  } catch {
    return {
      scenario: "velocity_deny",
      ok: false,
      paid: false,
      status: 0,
      note: "fetch_error",
    };
  }
}

async function runTick(
  env: Env,
): Promise<{ ran: boolean; reason?: string; calls: number; spend: number }> {
  const now = new Date();
  const state = await readState(env);

  if (!enabled(env)) return { ran: false, reason: "disabled", calls: 0, spend: 0 };
  if (await isKilled(env, state)) {
    return { ran: false, reason: "killed", calls: 0, spend: 0 };
  }

  const startDate = await resolveStartDate(env, now);
  const dayIndex = dayIndexFromStart(startDate, now);
  if (dayIndex < 0 || dayIndex >= MAX_DAYS) {
    state.stoppedReason = "max_days";
    await writeState(env, state);
    return { ran: false, reason: "max_days", calls: 0, spend: 0 };
  }

  const target = dailyTarget(dayIndex);
  const today = todayKey(now);
  if (state.dayKey !== today) {
    state.dayKey = today;
    state.callsToday = 0;
  }

  const remaining = callsRemainingToday(state, target);
  if (remaining <= 0) {
    return { ran: false, reason: "daily_quota_met", calls: 0, spend: 0 };
  }

  const stop = shouldStop(state);
  if (stop.stop) {
    state.stoppedReason = stop.reason || "stopped";
    await writeState(env, state);
    return { ran: false, reason: state.stoppedReason, calls: 0, spend: 0 };
  }

  const batch = Math.min(remaining, 4, DAILY_MAX_CALLS - state.callsToday);
  let calls = 0;
  let spend = 0;

  for (let i = 0; i < batch; i++) {
    const scenario = pickScenario(Math.random);
    let result: CallResult;
    try {
      if (scenario === "allow") result = await paidAllow(env);
      else if (scenario === "policy_block") result = await policyBlock(env);
      else result = await velocityDeny(env);
    } catch (e) {
      result = {
        scenario,
        ok: false,
        paid: false,
        status: 0,
        note: e instanceof Error ? e.message : "error",
      };
    }

    calls += 1;
    if (result.paid) {
      const onchain = state.totalCalls + calls;
      const facilitator =
        Math.max(0, onchain - FACILITATOR_FREE_MONTHLY) * FACILITATOR_PER_TX_USD;
      spend += PRICE_PER_CALL_USD + facilitator;
    }

    if (projectedSpend(state.totalCalls + calls) >= BUDGET_USD_TOTAL) {
      state.stoppedReason = "budget";
      break;
    }
  }

  state.callsToday += calls;
  state.totalCalls += calls;
  state.totalSpendUsd += spend;
  if (!state.startedAt) state.startedAt = now.toISOString();

  const post = shouldStop(state);
  if (post.stop) state.stoppedReason = post.reason || "stopped";

  await writeState(env, state);
  return { ran: true, calls, spend };
}

export default {
  async scheduled(
    _event: ScheduledEvent,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runTick(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const now = new Date();

    if (request.method === "GET" && url.pathname === "/") {
      const state = await readState(env);
      let startDate: string | null = (env.LOADGEN_START_DATE || "").trim() || null;
      if (!startDate) startDate = await env.LOADGEN_STATE.get(START_KEY);
      const dayIndex = startDate ? dayIndexFromStart(startDate, now) : -1;
      const target =
        dayIndex >= 0 && dayIndex < MAX_DAYS ? dailyTarget(dayIndex) : 0;
      return Response.json({
        enabled: enabled(env),
        pay: env.LOADGEN_PAY === "1",
        killed: await isKilled(env, state),
        startDate,
        dayIndex,
        dailyTarget: target,
        callsToday: state.callsToday,
        totalCalls: state.totalCalls,
        totalSpendUsd: state.totalSpendUsd,
        projectedSpend: projectedSpend(state.totalCalls),
        budgetUsd: BUDGET_USD_TOTAL,
        stoppedReason: state.stoppedReason,
        label: "PayStage synthetic load",
        caps: {
          DAILY_MAX_CALLS,
          MAX_DAYS,
          PRICE_PER_CALL_USD,
          FACILITATOR_PER_TX_USD,
          FACILITATOR_FREE_MONTHLY,
          BUDGET_USD_TOTAL,
        },
      });
    }

    if (request.method === "GET" && url.pathname === "/wallets") {
      const wallets = loadWallets(env);
      return Response.json({
        label: "PayStage synthetic load",
        wallets: publicWalletList(wallets),
      });
    }

    if (request.method === "POST" && url.pathname === "/admin/stop") {
      const state = await readState(env);
      state.kill = true;
      state.stoppedReason = "admin_stop";
      await writeState(env, state);
      return Response.json({ ok: true, killed: true });
    }

    return new Response("not found", { status: 404 });
  },
};

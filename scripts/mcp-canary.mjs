#!/usr/bin/env node
/**
 * Hourly MCP canary — the test the OpenAI session performed, scripted.
 *
 * It speaks the real protocol over Streamable HTTP against the live endpoint: initialize, list
 * tools, then CALL a tool and assert the verdict. That last step is the point. Every breakage we
 * have hit this week would have been invisible to a health check: the endpoint answered 200 while
 * the payer column did not exist, and it answered 200 while /mcp recorded nothing at all.
 *
 *   node bin/mcp-canary.mjs           # exit 0 pass, 1 fail, 2 cannot reach
 *   node bin/mcp-canary.mjs --json
 *
 * No credentials, no money, no writes. One evaluation per run against a known drainer address.
 */

const ENDPOINT = process.env.MCP_CANARY_URL || 'https://api.paystage.xyz/mcp';
const DRAINER = '0x6160000000000000000000000000000000003757';
const TREASURY = '0x1b2272A2Ca1792e8497A8d45Fd3eb8665AE88fAE';
const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';

const policy = {
  version: 1,
  max_amount: { value: '5', asset: 'USDC', decimals: 6 },
  allowed_pay_to: [TREASURY],
  allowed_assets: [{ symbol: 'USDC', decimals: 6, address: USDC, network: 'eip155:8453' }],
  allowed_networks: ['eip155:8453'],
  max_timeout_seconds: 300,
  unknown_payee: 'deny',
};

/** Two challenges, because one rule fires first and hides the other. */
const overCap = {
  x402Version: 2,
  accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '12500000', asset: USDC, payTo: TREASURY, maxTimeoutSeconds: 300 }],
};
// Within the cap, so the amount rule passes and the payee rule is the one that must fire. The first
// version of this canary sent one over-cap payment to a drainer and the amount rule masked the
// address check entirely — the assertion failed for the right reason and taught the wrong lesson.
const drainer = {
  x402Version: 2,
  accepts: [{ scheme: 'exact', network: 'eip155:8453', amount: '2000', asset: USDC, payTo: DRAINER, maxTimeoutSeconds: 300 }],
};

const headers = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
  'x-paystage-source': 'test',
};

let sessionId = null;

/** Streamable HTTP may answer with plain JSON or an SSE stream; parse both. */
async function rpc(method, params, id) {
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { ...headers, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  const sid = res.headers.get('mcp-session-id');
  if (sid) sessionId = sid;
  const text = await res.text();
  const payload = text.startsWith('event:')
    ? text.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6)).join('')
    : text;
  let json;
  try {
    json = JSON.parse(payload);
  } catch {
    throw new Error(`unparseable ${method} response (HTTP ${res.status}): ${text.slice(0, 120)}`);
  }
  if (json.error) throw new Error(`${method} error: ${JSON.stringify(json.error).slice(0, 120)}`);
  return json.result;
}

const checks = [];
const record = (name, ok, detail) => checks.push({ name, ok, detail });

try {
  const init = await rpc('initialize', {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'paystage-canary', version: '1' },
  }, 1);
  record('initialize', Boolean(init?.serverInfo?.name), `server=${init?.serverInfo?.name} v${init?.serverInfo?.version}`);

  await fetch(ENDPOINT, {
    method: 'POST',
    headers: { ...headers, ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  }).catch(() => {});

  const tools = await rpc('tools/list', {}, 2);
  const names = (tools?.tools ?? []).map((t) => t.name);
  record('tools/list', names.includes('evaluate_mcp_payment'), names.join(', '));

  async function evaluate(chal, id) {
    const call = await rpc('tools/call', { name: 'evaluate_mcp_payment', arguments: { payment_required: chal, policy } }, id);
    const text = call?.content?.[0]?.text ?? '';
    try { return JSON.parse(text); } catch { return null; }
  }

  const capVerdict = await evaluate(overCap, 3);
  record('tools/call returns a verdict', capVerdict !== null, capVerdict ? `decision=${capVerdict.decision}` : 'unparseable');
  record('refuses over the cap', capVerdict?.decision === 'do_not_pay', `decision=${capVerdict?.decision}`);
  record('cap denial cites the amount', /max_amount|exceeds/.test(JSON.stringify(capVerdict?.reasons ?? '')), String(capVerdict?.reasons?.[0] ?? '').slice(0, 70));

  // The functional assertion that matters: an in-cap payment to a known drainer must be refused,
  // and the reason must name the address. A gate that answers "pay" here is worse than one that is down.
  const drainerVerdict = await evaluate(drainer, 4);
  record('refuses a known drainer', drainerVerdict?.decision === 'do_not_pay', `decision=${drainerVerdict?.decision}`);
  record('drainer denial names the address', JSON.stringify(drainerVerdict?.reasons ?? '').toLowerCase().includes(DRAINER.slice(2, 10).toLowerCase()), String(drainerVerdict?.reasons?.[0] ?? '').slice(0, 80));
} catch (err) {
  record('reachable', false, String(err.message ?? err).slice(0, 160));
}

const failed = checks.filter((c) => !c.ok);
if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ endpoint: ENDPOINT, at: new Date().toISOString(), ok: failed.length === 0, checks }, null, 2));
} else {
  for (const c of checks) console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name.padEnd(32)} ${c.detail}`);
  console.log(failed.length === 0 ? '\ncanary: ok' : `\ncanary: ${failed.length} failed`);
}
process.exit(failed.length === 0 ? 0 : checks[0]?.name === 'reachable' ? 2 : 1);

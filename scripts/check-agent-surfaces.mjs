#!/usr/bin/env node
/**
 * Can each agent product on the operator's roster ever call our MCP server?
 *
 * This is a reachability probe, not a ranking. No product on the roster publishes usage
 * numbers, so the output is a table of observed states, never an ordered list:
 *
 *   reachable              its own docs document an external/custom MCP server AND our
 *                          canonical endpoint answers one initialize POST
 *   documented-not-listed  it supports MCP servers but we are not in the list/directory
 *                          the product reads
 *   no-mcp                 it does not accept an external MCP server at all (not our
 *                          failure, but stated)
 *   unverified             no primary source was found that says either way
 *
 * Sources are the vendor's own documentation, fetched at run time and matched against a
 * quoted span. Blog posts are not sources for a state; where a vendor page cannot be
 * found, the row is unverified rather than borrowing a blog's claim.
 *
 * Bounds: at most 40 requests, 10-second timeouts, no credentials, no sign-ins, and no
 * clicks that change state. The canonical endpoint is checked exactly once.
 *
 *   node scripts/check-agent-surfaces.mjs            # print the table
 *   node scripts/check-agent-surfaces.mjs --write    # also write docs/state/agent-surfaces.json
 *
 * Exit 0 every row has a state · 10 any row is unverified (the gap stays visible).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WRITE = process.argv.includes("--write");
const ENDPOINT = "https://api.paystage.xyz/mcp";
const TODAY = new Date().toISOString().slice(0, 10);
const REQUEST_LIMIT = 40;
const TIMEOUT_MS = 10_000;
const USER_AGENT = "paystage-reachability-probe/1 (+https://paystage.xyz)";

let requests = 0;

/** One fetch path for every request, so the 40-request bound is enforced rather than documented. */
async function boundedFetch(url, init = {}) {
  if (requests >= REQUEST_LIMIT) throw new Error(`request budget (${REQUEST_LIMIT}) exhausted`);
  requests += 1;
  return fetch(url, {
    ...init,
    redirect: "follow",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "user-agent": USER_AGENT, accept: "text/html, text/markdown, text/plain, */*", ...(init.headers ?? {}) },
  });
}

/** Make fetched HTML/markdown comparable: strip tags, decode the common entities, collapse space. */
function readable(text) {
  return text
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The roster is exactly the operator's eight products. The category is the closest single
 * label; `traits` keeps the overlaps visible because several products are more than one of
 * these things. `what` is a description, not an endorsement.
 */
const ROSTER = [
  {
    id: "grok-bot",
    product: "Grok Bot",
    vendor: "xAI",
    category: "computer-use",
    traits: ["computer-use", "persistent", "teammate"],
    what: "An agent with a persistent cloud computer — browser, filesystem and terminal — that keeps working after the laptop closes and can run routines.",
    stateHint: "reachable",
    reason: "Its docs document adding an MCP server that is not in the catalog, by URL or by a command.",
    sources: [
      {
        url: "https://docs.x.ai/grok-bot/computer-and-apps.md",
        title: "Use the computer and apps — Grok Bot docs (xAI)",
        marker: "A Bot can also add an MCP server that isn't in the catalog, by URL or by a command",
        updated: null,
      },
    ],
  },
  {
    id: "openai-dots",
    product: "OpenAI Dots",
    vendor: "OpenAI",
    category: "persistent",
    traits: ["persistent", "computer-use"],
    what: "An always-on agent in ChatGPT with its own cloud computer, scheduled runs, memories and the apps connected through Plugins.",
    stateHint: "reachable",
    reason: "Dots share ChatGPT's plugin permissions, and OpenAI documents adding a custom MCP server from the Plugins tab, subject to account and workspace policy.",
    sources: [
      {
        url: "https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs",
        title: "Dots privacy, security, and safety FAQs — OpenAI Help Center",
        marker: "Plugin permissions are shared across dots, ChatGPT, ChatGPT Work, and Codex.",
        updated: null,
      },
      {
        url: "https://help.openai.com/en/articles/12584461-connecting-custom-mcp-servers-in-chatgpt",
        title: "Connecting custom MCP servers in ChatGPT — OpenAI Help Center",
        marker: "Select the plus button, then select Add custom MCP server",
        updated: null,
      },
    ],
  },
  {
    id: "meta-muse",
    product: "Meta Muse",
    vendor: "Meta",
    category: "persistent",
    traits: ["persistent"],
    what: "Meta's personal AI agent. Its help centre documents Connectors and custom connectors created from API information.",
    stateHint: "unverified",
    reason: "Meta's own Connectors page describes custom connectors but does not mention MCP; no primary source says it accepts an external MCP server.",
    sources: [
      {
        url: "https://www.meta.com/help/superintelligence/1687253048996149/",
        title: "How Muse works with Connectors — Meta Help Centre",
        marker: "you can ask Muse to create a Custom Connector",
        updated: "2026-11-17",
      },
    ],
  },
  {
    id: "claude-duet",
    product: "Anthropic Claude Duet",
    vendor: "Anthropic",
    category: "computer-use",
    traits: ["computer-use", "persistent"],
    what: "Anthropic's research-preview Claude that runs on its own cloud computer and uses the memory, skills and connectors already set up in Claude.",
    stateHint: "reachable",
    reason: "Duet's docs say it uses the connectors set up in Claude, and Anthropic documents custom connectors over remote MCP.",
    sources: [
      {
        url: "https://support.claude.com/en/articles/17631495-get-started-with-claude-duet",
        title: "Get started with Claude Duet — Claude Help Center",
        marker: "It works with the connectors you've connected in Claude",
        updated: null,
      },
      {
        url: "https://support.claude.com/en/articles/11176164-use-connectors-to-extend-claude-s-capabilities",
        title: "Use connectors to extend Claude's capabilities — Claude Help Center",
        marker: "Custom connectors using remote MCP are available on Claude",
        updated: null,
      },
    ],
  },
  {
    id: "manus-cue",
    product: "Manus / Cue",
    vendor: "Manus",
    category: "persistent",
    traits: ["persistent"],
    what: "Manus's agent and connector platform. Its docs cover a connector catalog and a custom-MCP path for services that are not in it.",
    stateHint: "reachable",
    reason: "Its docs document Settings → Integrations → Custom MCP Servers, adding a server by URL or command.",
    sources: [
      {
        url: "https://manus.im/docs/integrations/custom-mcp.md",
        title: "Custom MCP Servers — Manus Documentation",
        marker: "Custom MCP servers allow you to extend Manus's integration capabilities",
        updated: "2026-11-02",
      },
    ],
  },
  {
    id: "openmausbot",
    product: "OpenMausBot",
    vendor: "OpenMausBot",
    category: "teammate",
    traits: ["teammate", "persistent", "computer-use"],
    what: "An open-source bot harness: named bots on several engines, each with tools, tasks and a computer, and a Bring-your-own-MCP-servers screen.",
    stateHint: "reachable",
    reason: "Its docs document adding an MCP server by URL or command and turning it on after a handshake test.",
    sources: [
      {
        url: "https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/docs/custom-mcp-servers.md",
        title: "Bring your own MCP servers — OpenMausBot docs",
        marker: "give your bots tools from an MCP server you trust",
        updated: null,
      },
    ],
  },
  {
    id: "openclaw-hermes",
    product: "OpenClaw / Hermes Agent",
    vendor: "OpenClaw; Nous Research",
    category: "persistent",
    traits: ["persistent", "teammate"],
    what: "Two open-source agent runtimes. OpenClaw's Gateway and Hermes Agent both keep an agent running and both configure external MCP servers.",
    stateHint: "reachable",
    reason: "Both sets of docs document external MCP servers: OpenClaw's registry and Hermes' mcp_servers config.",
    sources: [
      {
        url: "https://docs.openclaw.ai/cli/mcp.md",
        title: "MCP — OpenClaw docs",
        marker: "manage OpenClaw-managed outbound MCP server definitions",
        updated: null,
      },
      {
        url: "https://raw.githubusercontent.com/NousResearch/hermes-agent/main/website/docs/user-guide/features/mcp.md",
        title: "MCP (Model Context Protocol) — Hermes Agent docs",
        marker: "MCP lets Hermes Agent connect to external tool servers",
        updated: null,
      },
    ],
  },
  {
    id: "openbot-rakazo",
    product: "OpenBot / Rakazo",
    vendor: "OpenBot; Rakazo",
    category: "teammate",
    traits: ["teammate", "persistent", "computer-use"],
    what: "OpenBot is a local-first desktop workspace for persistent agents; Rakazo is a self-hosted agent platform with a documented remote-MCP path.",
    stateHint: "reachable",
    reason: "Rakazo's docs document adding any remote MCP server at an HTTPS address.",
    sources: [
      {
        url: "https://rakazo.com/docs/integrations/",
        title: "Connect apps — Rakazo docs",
        marker: "any remote MCP server at an HTTPS address",
        updated: null,
      },
    ],
    note: "Rakazo documents the custom-server path. OpenBot's own docs route MCP through its Marketplace apps rather than a documented add-a-server form.",
  },
];

const STATES = ["reachable", "documented-not-listed", "no-mcp", "unverified"];

function sourceResult(source, ok, detail) {
  return { url: source.url, title: source.title, updated: source.updated ?? null, ok, detail };
}

async function readSource(source) {
  try {
    const response = await boundedFetch(source.url);
    if (!response.ok) {
      return sourceResult(source, false, `HTTP ${response.status}`);
    }
    const body = readable(await response.text());
    const marker = readable(source.marker);
    if (!body.includes(marker)) {
      return sourceResult(source, false, "the quoted span was not on the page");
    }
    return sourceResult(source, true, "quoted span present");
  } catch (error) {
    return sourceResult(source, false, String(error?.name === "TimeoutError" ? "timed out" : error).slice(0, 120));
  }
}

async function checkEndpoint() {
  try {
    const response = await boundedFetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json, text/event-stream" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "paystage-reachability-probe", version: "1.0.0" },
        },
      }),
    });
    const body = await response.text();
    let message = null;
    for (const line of body.split(/\r?\n/)) {
      if (!line.startsWith("data:")) continue;
      try {
        const parsed = JSON.parse(line.slice(5).trim());
        if (parsed?.result) message = parsed.result;
      } catch {
        // A non-JSON event is not an initialize answer.
      }
    }
    const ok = response.ok && message?.serverInfo?.name === "paystage";
    return {
      ok,
      status: response.status,
      checkedAt: TODAY,
      serverName: message?.serverInfo?.name ?? null,
      protocolVersion: message?.protocolVersion ?? null,
      detail: ok ? "initialize answered by paystage" : "no paystage initialize result",
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      checkedAt: TODAY,
      serverName: null,
      protocolVersion: null,
      detail: String(error?.name === "TimeoutError" ? "timed out" : error).slice(0, 120),
    };
  }
}

const endpoint = await checkEndpoint();
const products = [];

for (const item of ROSTER) {
  const sources = [];
  for (const source of item.sources) sources.push(await readSource(source));

  let state = item.stateHint;
  let reason = item.reason;
  const unreadable = sources.filter((source) => !source.ok);

  if (!STATES.includes(state)) throw new Error(`unknown state hint for ${item.product}: ${state}`);
  if (unreadable.length > 0) {
    state = "unverified";
    reason = `Could not verify the primary source: ${unreadable.map((source) => `${source.url} (${source.detail})`).join("; ")}.`;
  } else if (state === "reachable" && !endpoint.ok) {
    state = "unverified";
    reason = `The docs describe an MCP path, but ${ENDPOINT} did not answer initialize (${endpoint.detail}), so reachability is not established.`;
  }

  products.push({
    id: item.id,
    product: item.product,
    vendor: item.vendor,
    category: item.category,
    traits: item.traits,
    what: item.what,
    state,
    reason,
    checkedAt: TODAY,
    sources,
    note: item.note ?? null,
  });
}

const counts = Object.fromEntries(STATES.map((state) => [state, products.filter((p) => p.state === state).length]));
const unverified = counts.unverified;

const output = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  checkedOn: TODAY,
  method:
    "Read each product's own documentation at the URL shown, require a quoted span on the page, and POST one initialize to the canonical endpoint. No ranking: no product publishes usage numbers.",
  endpoint: { url: ENDPOINT, ...endpoint },
  requestBudget: { limit: REQUEST_LIMIT, used: requests },
  states: {
    reachable: "its own docs document an external/custom MCP server and the endpoint answers initialize",
    "documented-not-listed": "it supports MCP servers but we are not in the list/directory it reads",
    "no-mcp": "it does not accept an external MCP server at all",
    unverified: "no primary source was found that says either way",
  },
  counts,
  products,
};

if (WRITE) {
  const file = join(ROOT, "docs/state/agent-surfaces.json");
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, `${JSON.stringify(output, null, 2)}\n`);
  console.log(`wrote ${file}`);
}

const widths = {
  state: Math.max(5, ...products.map((product) => product.state.length)),
  product: Math.max(7, ...products.map((product) => product.product.length)),
  url: Math.max(3, ...products.map((product) => product.sources[0]?.url.length ?? 0)),
};
const row = (state, product, url, date) =>
  `${state.padEnd(widths.state)}  ${product.padEnd(widths.product)}  ${url.padEnd(widths.url)}  ${date}`;

console.log(row("state", "product", "url read", "date"));
console.log(row("-".repeat(widths.state), "-".repeat(widths.product), "-".repeat(widths.url), "----"));
for (const product of products) {
  const source = product.sources[0];
  console.log(row(product.state, product.product, source?.url ?? "(none)", product.checkedAt));
  if (product.state === "unverified") console.log(`  ↳ ${product.reason}`);
  else if (product.note) console.log(`  ↳ ${product.note}`);
}
console.log(
  `\n${products.length} products · ${counts.reachable} reachable · ${counts["documented-not-listed"]} documented-not-listed · ${counts["no-mcp"]} no-mcp · ${counts.unverified} unverified`,
);
console.log(
  `endpoint ${ENDPOINT} — ${endpoint.ok ? "initialize answered" : "initialize NOT answered"}; ${requests}/${REQUEST_LIMIT} requests; checked ${TODAY}`,
);
console.log("No ranking is published: reachability is recorded, popularity is not measured.");

process.exit(unverified > 0 ? 10 : 0);

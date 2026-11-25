/**
 * PayStage as a remote MCP server — the same tools the npm package serves.
 *
 * It used to mount ONE tool while the site said nine, so every URL-based channel (Arcade, the MCP
 * registry's remote entry, the Docker catalogue, ChatGPT) reached a narrower surface than the page
 * promised. Two transports, one registration module: the only way they cannot drift is if there is
 * only one list.
 *
 * `/mcp` keeps all ten tools. `/mcp/chatgpt` is the same handlers filtered to the read-only payment
 * tools, because a directory listing cannot say "read-only" about a server whose full surface also
 * writes a testnet transaction. The curated path is also the one placed behind the free tier.
 */
import { McpServer, createMcpHandler } from "@modelcontextprotocol/server";
import { registerAllTools, SERVER_CAPABILITIES, type ToolSurface } from "@paystage/mcp/tools";
import { createMemoryChallengeVerdictStore } from "@paystage/preflight";
import { parsePolicyCached } from "./policy-cache.js";
import { publicKeyJwk } from "./receipt.js";
import {
  provenanceFromHeaders,
  provenanceKeyFrom,
  recordEvent,
  sourceFromHeaders,
  type CallerProvenance,
  type TelemetrySource,
} from "./telemetry.js";
import { channelFromCookieHeader, channelFromUrl, firstTouch } from "./channel.js";
import { supabaseBundleStore, type BundleStore } from "./bundle-store.js";

export const MCP_PATH = "/mcp";
export const CURATED_MCP_PATH = "/mcp/chatgpt";
const SERVICE_VERSION = "2026.11.14";

/**
 * The #444 repeat store for the MCP surface, per Worker isolate.
 *
 * The MCP tool handler is the evaluator and nothing else (unlike the HTTP evaluate route, which
 * adds network checks after it), so storing its verdict is storing the final decision. Per isolate
 * is the same boundary the payment-identifier cache documents: a cold isolate forgets, and a retry
 * after the TTL is a new decision. The salt is generated per isolate and never committed; a durable
 * store would need a deployment salt instead.
 */
/**
 * Lazily, not at module scope: `crypto.getRandomValues` in a Worker's global scope is a deploy-time
 * error (10021, "Disallowed operation called within global scope") — it failed the hosted deploy on
 * 2026-11-25 while every local check passed, because only the deploy validates global scope.
 */
let challengeSaltValue: string | null = null;
function challengeSalt(): string {
  if (challengeSaltValue === null) {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    challengeSaltValue = [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  return challengeSaltValue;
}
const challengeStore = createMemoryChallengeVerdictStore();

/**
 * The answer a ChatGPT user gets once the curated surface's free allowance is spent.
 *
 * A bare 402/429 reads as an outage to a client that cannot pay in chat. So the body names the cap,
 * says the service is working, and gives the paid path — the caller must be able to tell "I used
 * today's free calls" from "this is broken". Status: 429.
 */
export function curatedOverCapBody(
  limit: number,
  retryAfterSeconds: number,
  reason: "exhausted" | "disabled" = "exhausted",
): Record<string, unknown> {
  const formatted = new Intl.NumberFormat("en-US").format(limit);
  const allowance = `${formatted} free call${limit === 1 ? "" : "s"} per day per Worker instance`;
  const message =
    reason === "disabled"
      ? `The curated ChatGPT surface is available but its free tier is disabled on this deployment. The full paid endpoint is https://api.paystage.xyz/mcp ($0.002 USDC per call over x402).`
      : `Free tier exhausted: this ChatGPT MCP surface allows ${allowance}, and this caller has used them all. The service is working — this is the daily limit, not an outage. Continue against the full paid endpoint https://api.paystage.xyz/mcp ($0.002 USDC per call over x402), or retry after the daily reset in ${retryAfterSeconds} seconds (00:00 UTC).`;
  return {
    jsonrpc: "2.0",
    id: null,
    error: {
      code: -32001,
      message,
      data: {
        paystage_error: reason === "disabled" ? "free_tier_disabled" : "free_tier_exhausted",
        daily_limit: limit,
        enforcement: "per-worker-instance",
        paid_path: "https://api.paystage.xyz/mcp",
        price_usdc_per_call: "0.002",
        retry_after_seconds: retryAfterSeconds,
      },
    },
  };
}

type Env = { SUPABASE_URL?: string; SUPABASE_SERVICE_ROLE_KEY?: string };

/**
 * First touch per MCP session (#326).
 *
 * `/mcp` bypasses the Hono context, so the cookie middleware's value cannot be read here directly. A Streamable HTTP
 * client carries `mcp-session-id`; remembering the first valid channel against it gives the same "first touch wins"
 * rule without reading an IP or a user agent. Per-isolate, like the free-tier counters: a cold isolate forgets the
 * map, and a request that arrives without the header falls back to the cookie or the URL.
 */
const mcpSessionChannels = new Map<string, string>();
const MCP_SESSION_CAP = 2_000;

function channelForRequest(req: Request): string | null {
  const sessionId = req.headers.get("mcp-session-id");
  const prior = sessionId ? mcpSessionChannels.get(sessionId) ?? null : null;
  const channel = firstTouch(prior ?? channelFromCookieHeader(req.headers.get("cookie")), channelFromUrl(req.url));
  if (sessionId !== null && channel !== null && !mcpSessionChannels.has(sessionId)) {
    if (mcpSessionChannels.size >= MCP_SESSION_CAP) {
      const oldest = mcpSessionChannels.keys().next().value;
      if (oldest !== undefined) mcpSessionChannels.delete(oldest);
    }
    mcpSessionChannels.set(sessionId, channel);
  }
  return channel;
}

function buildServer(
  env: Env,
  source: TelemetrySource,
  channel: string | null,
  callerProvenance: CallerProvenance,
  surface: ToolSurface,
  injectedStore?: BundleStore,
): McpServer {
  const server = new McpServer(
    { name: "paystage", version: SERVICE_VERSION },
    { capabilities: SERVER_CAPABILITIES },
  );
  const bundleStore = injectedStore ?? supabaseBundleStore(env);

  registerAllTools(server, {
    // No filesystem in a Worker: a caller must send the policy inline. Refusing `policy_path` with a
    // sentence beats a stack trace from a missing module.
    resolvePolicy: async (input) => {
      if (input.policy === undefined) {
        throw new Error(
          "policy is required on the hosted endpoint — send the policy object; `policy_path` only works in the stdio package",
        );
      }
      return parsePolicyCached(input.policy);
    },
    version: SERVICE_VERSION,
    // The Worker cannot fetch its own origin to read the published key — that subrequest returned
    // 522/523, so `verify_receipt` reported a genuine signed receipt as unverifiable in production.
    // The key material is already here; hand it over directly and keep the network out of the check.
    resolveReceiptKey: async () => {
      const pkcs8 = (env as { RECEIPT_SIGNING_KEY_PKCS8?: string } | undefined)?.RECEIPT_SIGNING_KEY_PKCS8;
      if (!pkcs8) return null;
      const jwk = await publicKeyJwk(pkcs8);
      return jwk ? (jwk as unknown as Record<string, unknown>) : null;
    },
    ...(bundleStore === undefined
      ? {}
      : {
          persistBundle: async (bundle: {
            id: string;
            decision: string;
            events: string;
            proof: string;
            receipt: string | null;
            summary: string;
          }) => bundleStore.put(bundle),
        }),
    // #444: the evaluator's verdict is the final decision on this surface, so the repeat store is
    // attached here. Per isolate, bounded by TTL and entry cap (see the constants above).
    challengeStore,
    challengeSalt: challengeSalt(),
  }, { surface });

  // Telemetry: the MCP path recorded nothing until 2026-11-14, so a real agent call and a quiet day
  // were the same number. The tool results are not parsed here; the decision is read from the text
  // the tool produced, which keeps this wrapper independent of the registration module.
  const original = server.registerTool.bind(server);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, config: unknown, handler: any) =>
    original(name as never, config as never, (async (...args: unknown[]) => {
      const started = Date.now();
      const result = await handler(...args);
      try {
        const text = result?.content?.[0]?.text ?? "";
        let decision = "unknown";
        try {
          const parsed = JSON.parse(text);
          decision = String(parsed?.decision ?? parsed?.valid ?? parsed?.ok ?? "unknown");
        } catch {}
        await recordEvent(
          { SUPABASE_URL: env.SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: env.SUPABASE_SERVICE_ROLE_KEY },
          {
            source,
            tool: name,
            decision,
            reason_codes: [],
            network: "eip155:8453",
            latency_ms: Date.now() - started,
            channel,
            // Provenance from a signed header; `unknown` is not "external" (#430).
            caller_provenance: callerProvenance,
          },
        );
      } catch {
        // A telemetry failure must never turn a successful tool call into an error for the agent.
      }
      return result;
    }) as never);

  return server;
}

export function mcpHandler(
  env: Env,
  options: { bundleStore?: BundleStore; surface?: ToolSurface } = {},
): { fetch: (request: Request) => Promise<Response> } {
  return createMcpHandler(async (ctx) => {
    const req = ctx?.requestInfo;
    const source = req
      ? sourceFromHeaders({ header: (name: string) => req.headers.get(name) ?? undefined })
      : "real";
    const callerProvenance = req
      ? await provenanceFromHeaders({ header: (name: string) => req.headers.get(name) ?? undefined }, provenanceKeyFrom(env))
      : "unknown";
    return buildServer(
      env,
      source,
      req ? channelForRequest(req) : null,
      callerProvenance,
      options.surface ?? "all",
      options.bundleStore,
    );
  });
}

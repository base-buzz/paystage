import { Hono } from "hono";

/**
 * `GET /openapi.json` — x402scan's first-choice discovery path.
 *
 * Their spec reads OpenAPI before `/.well-known/x402`, and marks the well-known file a compatibility
 * fallback. Ours returned a valid document there and their register form still said "No discovery
 * document found", so this is the format they actually check: `x-payment-info` per paid operation,
 * a declared 402 response, and pricing in USD.
 *
 * It is also better for humans and agents than a bespoke file — an OpenAPI document can be loaded into
 * any client, and the request schema is the same one the route accepts.
 *
 * ## The document covers both surfaces
 *
 * **The paid surface** is three operations, all `POST`, and each carries `x-payment-info` plus a declared
 * 402: `/v1/evaluate_mcp_payment`, `/v1/paid/evaluate_mcp_payment` (the always-challenging alias) and
 * `/v1/evaluate_outstanding_auths`. Those are the operations x402scan indexes, and their detail is kept
 * deliberately richer than the rest.
 *
 * **Everything else is a free, public route**: facilitator discovery and verification (`/supported`,
 * `/verify`, `/settle`), read-only records (`/runs/:id`, `/wallets/:address`, `/v1/mandate/:serial`,
 * `/v1/public/rollup`, `/v1/public/status`, `/v1/public/chain.json`, the example receipt/key), the
 * bearer-token-gated mandate writes (`POST /v1/mandate`, `POST /v1/mandate/:serial/revoke`), the
 * telemetry collector (`/v1/guard-verdict`), the testnet faucet, the two MCP transports, `/health`, and
 * this document. None of them is payable and none declares `x-payment-info`; a caller that needs a
 * verdict either uses the free tier or one of the three paid operations above.
 *
 * The path list is checked against the routes `apps/hosted/src/app.ts` actually serves by
 * `scripts/check-openapi-parity.mjs`, which reuses the same derivation as `check-route-docs.mjs`.
 */

export const openapiRoutes = new Hono();

const PRICE = "0.002";
const NETWORK = "eip155:8453";

const PAYMENT_BODY = {
  type: "object",
  required: ["payment_required", "policy"],
  properties: {
    payment_required: { type: "object", description: "The decoded x402 challenge being considered" },
    policy: { type: "object", description: "The spend policy to evaluate it against" },
    agent_id: { type: "string", description: "Optional agent identifier for per-agent budgets" },
    mandate: {
      type: "object",
      description:
        "Optional scoped, revocable authority (#473). Supply the signed envelope and any verified revocation statements; a revoked serial refuses the payment with `accept.mandate.revoked`.",
      properties: {
        mandate: { type: "object", description: "The signed mandate envelope" },
        history: { type: "array", description: "Settled payments inside the window, for the rolling total" },
        revocations: { type: "array", description: "Verified revocation statements naming the serial" },
      },
      required: ["mandate"],
    },
  },
} as const;

/**
 * The error shape, as a schema — RFC 9457 plus the fields an agent needs to recover (#problem-details).
 *
 * Documented here rather than only implemented, because an agent reads this document before its first call: a 400 with
 * no declared schema is a 400 the client library will surface as an opaque string.
 */
const PROBLEM_SCHEMA = {
  type: "object",
  required: ["type", "title", "status", "detail", "error", "is_retriable"],
  properties: {
    type: { type: "string", format: "uri", description: "A URL naming this error class, e.g. https://paystage.xyz/errors/invalid_json" },
    title: { type: "string", description: "Short summary, safe to show a human" },
    status: { type: "integer", description: "The HTTP status, repeated in the body" },
    detail: { type: "string", description: "What went wrong, specific to this request" },
    error: { type: "string", description: "Stable machine name for the error class; safe to switch on" },
    is_retriable: {
      type: "boolean",
      description:
        "Whether retrying the SAME request could ever succeed. False for wrong input — fix the field named below instead of retrying.",
    },
    retry_after_seconds: {
      type: "integer",
      description: "Present only when is_retriable is true. Wait this long, then retry.",
    },
    field: { type: "string", description: "The request parameter that caused the failure, when there is one" },
    fix: { type: "string", description: "The change to make in the next call, in the imperative" },
    instance: { type: "string", description: "The request id, so a report can be matched to a log line" },
  },
  examples: [
    {
      type: "https://paystage.xyz/errors/missing_payment_required",
      title: "payment_required is required",
      status: 400,
      detail: "The body has no payment_required object, so there is no payment to judge.",
      error: "missing_payment_required",
      is_retriable: false,
      field: "payment_required",
      fix: "Pass the decoded x402 challenge: the object a server returned under `accepts` in its 402 response.",
    },
  ],
} as const;

const VERDICT_SCHEMA = {
  type: "object",
  properties: {
    decision: { type: "string", enum: ["pay", "review", "do_not_pay"] },
    reasons: { type: "array", items: { type: "string" } },
    acceptResults: { type: "array", items: { type: "object" } },
    summary: { type: "string" },
  },
} as const;

/** A response carrying `application/problem+json` and a description specific to the route. */
function problem(description: string) {
  return { description, content: { "application/problem+json": { schema: PROBLEM_SCHEMA } } };
}

/** A JSON response with a schema. */
function json(description: string, schema: unknown) {
  return { description, content: { "application/json": { schema } } };
}

/**
 * The facilitator's plain `{ error, detail }` refusal. This is not the Problem Details shape: `/verify`
 * and `/settle` speak x402 v2, whose facilitator errors are the protocol's own two fields.
 */
const FACILITATOR_ERROR_SCHEMA = {
  type: "object",
  required: ["error", "detail"],
  properties: {
    error: { type: "string", description: "Machine name, e.g. `invalid_json`, `invalid_request`, `facilitator_not_configured`." },
    detail: { type: "string", description: "One sentence naming what to change." },
  },
} as const;

/**
 * `SupportedResponse` from `@x402/core`: `{ kinds, extensions, signers }`. This shape is fixed by the
 * package and copied here rather than invented; a sibling field would stop it being the protocol's document.
 */
const SUPPORTED_SCHEMA = {
  type: "object",
  required: ["kinds", "extensions", "signers"],
  properties: {
    kinds: {
      type: "array",
      description: "The scheme/network pairs this deployment accepts when it settles.",
      items: {
        type: "object",
        required: ["x402Version", "scheme", "network"],
        properties: {
          x402Version: { type: "integer", enum: [2] },
          scheme: { type: "string", description: "e.g. `exact`" },
          network: { type: "string", description: "CAIP-2 network, e.g. `eip155:8453`" },
          extra: {
            type: "object",
            description:
              "The protocol's open extension slot. PayStage puts `asset` (USDC address) and `verifier` (who verifies, with which key) here; no sibling top-level field is added.",
          },
        },
      },
    },
    extensions: { type: "array", items: { type: "string" }, description: "Extension names this facilitator advertises." },
    signers: {
      type: "object",
      description: "Signer addresses keyed by network. `{}` until a settling key is loaded.",
      additionalProperties: { type: "array", items: { type: "string" } },
    },
  },
} as const;

/** The request body both facilitator writes accept: x402 v2's `VerifyRequest` / `SettleRequest`. */
const FACILITATOR_REQUEST_SCHEMA = {
  type: "object",
  required: ["paymentPayload", "paymentRequirements"],
  properties: {
    x402Version: { type: "integer", enum: [2], description: "Optional here, but must be 2 when present. v1 is refused." },
    paymentPayload: {
      type: "object",
      description: "The signed x402 payload, including `x402Version: 2`, `accepted` and `payload`.",
    },
    paymentRequirements: {
      type: "object",
      description: "The requirements the payment is being judged against.",
    },
  },
} as const;

const VERIFY_RESPONSE_SCHEMA = {
  type: "object",
  required: ["isValid"],
  properties: {
    isValid: { type: "boolean", description: "Whether the payment is valid. `false` is still HTTP 200 — a refused payment is not a malformed request." },
    invalidReason: { type: "string" },
    invalidMessage: { type: "string" },
    payer: { type: "string" },
    extensions: { type: "object" },
    extensionResponses: { type: "object" },
    extra: { type: "object" },
  },
} as const;

const SETTLE_RESPONSE_SCHEMA = {
  type: "object",
  required: ["success", "transaction", "network"],
  properties: {
    success: { type: "boolean", description: "Whether settlement succeeded. `false` is still HTTP 200." },
    errorReason: { type: "string" },
    errorMessage: { type: "string" },
    payer: { type: "string" },
    transaction: { type: "string", description: "The on-chain transaction hash." },
    network: { type: "string", description: "CAIP-2 network that settled, e.g. `eip155:8453`." },
    amount: { type: "string", description: "Settled amount in atomic token units, when it differs from the authorised maximum." },
    extensions: { type: "object" },
    extensionResponses: { type: "object" },
    extra: { type: "object" },
  },
} as const;

const HEALTH_SCHEMA = {
  type: "object",
  required: ["ok", "telemetry"],
  properties: {
    ok: { type: "boolean", enum: [true] },
    telemetry: {
      type: "object",
      required: ["drops", "url", "key", "configured"],
      description:
        "Whether the write side is wired up, and whether events are being dropped on the way through. Booleans only: a secret's presence is publishable, its value is not.",
      properties: {
        drops: {
          type: "object",
          required: ["count", "fields", "last"],
          description: "The fields dropped on the way through the telemetry pipe since this isolate started. `count` 0 and a non-empty `fields` would contradict; both come from the same buffer.",
          properties: {
            count: { type: "integer", description: "Number of dropped field writes." },
            fields: { type: "array", items: { type: "string" }, description: "Distinct column names that were dropped." },
            last: { type: ["string", "null"], description: "When the last drop happened, or null when none has." },
          },
        },
        url: { type: "boolean", description: "`SUPABASE_URL` is set." },
        key: { type: "boolean", description: "`SUPABASE_SERVICE_ROLE_KEY` is set." },
        configured: { type: "boolean", description: "Both are set, so a write can happen at all." },
      },
    },
  },
} as const;

const STATUS_SCHEMA = {
  type: "object",
  required: ["status", "flags", "incidents", "generated_at"],
  properties: {
    status: { type: "string", enum: ["ok", "degraded", "outage"] },
    flags: {
      type: "array",
      items: {
        type: "object",
        properties: {
          flag: { type: "string" },
          triggered: { type: "boolean" },
          count: { type: "integer" },
          last_seen: { type: "string", nullable: true },
        },
      },
    },
    incidents: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          opened_at: { type: "string", format: "date-time" },
          closed_at: { type: "string", format: "date-time", nullable: true },
          severity: { type: "string", enum: ["info", "warning", "critical"] },
          title: { type: "string" },
          summary: { type: "string" },
          status: { type: "string", enum: ["open", "monitoring", "resolved"] },
        },
      },
    },
    generated_at: { type: "string", format: "date-time" },
    note: { type: "string", description: "Present when telemetry is unconfigured, so an empty feed is not read as a healthy one." },
    paid_quota: {
      type: "object",
      description: "Present when telemetry is configured. The paid-path daily cap, published rather than discovered as a 429.",
      properties: { daily_limit: { type: "integer" }, per: { type: "string", enum: ["payer"] } },
    },
    free_tier: {
      type: "object",
      description: "Present when telemetry is configured. States the per-instance limitation rather than implying a global daily number.",
      properties: {
        daily_limit: { type: "integer" },
        enforcement: { type: "string", enum: ["per-instance"] },
        note: { type: "string" },
      },
    },
  },
} as const;

const CHAIN_SCHEMA = {
  type: "object",
  required: ["block", "gasGwei", "ok", "observedAt"],
  properties: {
    block: { type: "integer", nullable: true, description: "Latest Base mainnet block height, or null when no RPC answered." },
    gasGwei: { type: "number", nullable: true, description: "Gas price in gwei, or null when no RPC answered." },
    ok: { type: "boolean", description: "Whether the block number was observed. False is a reported RPC failure, never a chain stall." },
    observedAt: { type: "string", format: "date-time" },
    via: { type: ["string", "null"], description: "Host of the RPC that answered, when one did." },
    note: { type: "string", description: "Present only when `ok` is false: says the public RPC did not answer." },
  },
} as const;

const RUN_JSON_SCHEMA = {
  type: "object",
  required: ["schema", "bundle_id", "decision", "artefacts"],
  properties: {
    schema: { type: "string", enum: ["paystage.evidence-bundle.v1"] },
    bundle_id: { type: "string", pattern: "^[0-9a-f]{64}$" },
    decision: { type: "string", enum: ["pay", "review", "do_not_pay"] },
    created_at: { type: "string", format: "date-time" },
    artefacts: {
      type: "object",
      required: ["events.jsonl", "proof", "receipt", "summary.md"],
      properties: {
        "events.jsonl": { type: "string", description: "The NDJSON event rows, verbatim." },
        proof: { type: "object", description: "The proof object, as stored (JSON)." },
        receipt: { type: ["object", "null"], description: "The signed receipt, or null when this evaluation did not issue one." },
        "summary.md": { type: "string", description: "The human summary, as markdown." },
      },
    },
  },
} as const;

const WALLET_SCHEMA = {
  type: "object",
  required: ["schema", "address", "labels", "observations", "disagreements"],
  properties: {
    schema: { type: "string", enum: ["paystage.payee-categories.v1"] },
    address: { type: "string", pattern: "^0x[0-9a-f]{40}$", description: "Lower-cased address the observations are keyed by." },
    labels: { type: "array", items: { type: "object" }, description: "Categorised labels, each carrying its source and read date." },
    observations: { type: "array", items: { type: "object" }, description: "The stored observations behind the labels." },
    disagreements: { type: "array", items: { type: "object" }, description: "Fields two sources disagree about, with both values — never collapsed into one." },
  },
} as const;

const MANDATE_SERIAL_SCHEMA = {
  type: "string",
  pattern: "^(?:vch-[A-Za-z0-9]{3}|vch_[A-Za-z0-9_-]{22,64})$",
  description:
    "The short code a pass face renders (`vch-` plus exactly three alphanumerics), or the full serial (`vch_` plus 22–64 URL-safe characters). Anything else is a 400.",
};

const MANDATE_SCHEMA = {
  type: "object",
  required: ["serial", "status", "scope", "principal", "verdict_for_seller", "as_of"],
  properties: {
    serial: { type: "string" },
    status: { type: "string", enum: ["active", "revoked", "expired", "unknown"], description: "Expiry is recomputed at read time; a revoked record stays revoked after expiry." },
    scope: {
      type: ["object", "null"],
      description: "The scope the principal signed, or null for an unknown serial.",
      properties: {
        per_payment: { type: "string", description: "Per-transaction cap in whole USDC, e.g. `2.00`." },
        window_amount: { type: "string", description: "Rolling-window ceiling in whole USDC, e.g. `20.00`." },
        window_seconds: { type: "integer", description: "Rolling-window length in seconds." },
        expires_at: { type: "string", format: "date-time" },
      },
    },
    principal: {
      type: ["object", "null"],
      description: "Self-asserted display name and the fact that it is self-asserted; null for an unknown serial.",
      properties: {
        display: { type: "string" },
        assertion: { type: "string", enum: ["self"] },
      },
    },
    verdict_for_seller: { type: "string", enum: ["trust", "do_not_trust", "unknown"] },
    as_of: { type: "string", format: "date-time", description: "When this answer was computed, so a verifier can tell live from stale without headers." },
  },
} as const;

const ROLLUP_SCHEMA = {
  type: "object",
  required: ["unit", "spend_minor", "spend_currency", "refusals", "mandates", "descendants", "as_of"],
  properties: {
    unit: { type: "string", description: "The validated org unit, e.g. `paystage/eng`." },
    spend_minor: { type: "integer", description: "Settled spend in micro-USDC. Read `spend_unavailable_reason` before treating 0 as measured." },
    spend_currency: { type: "string", enum: ["USDC"] },
    refusals: { type: "integer", description: "Stored `do_not_pay` rows. Read `refusals_unavailable_reason` before treating 0 as measured." },
    mandates: { type: "integer", description: "Mandates in this unit and its descendants." },
    descendants: {
      type: "array",
      description: "Per-unit totals, each mandate counted exactly once.",
      items: {
        type: "object",
        required: ["unit", "mandates", "spend_minor"],
        properties: {
          unit: { type: "string" },
          mandates: { type: "integer" },
          spend_minor: { type: "integer" },
        },
      },
    },
    as_of: { type: "string", format: "date-time" },
    spend_unavailable_reason: { type: "string", description: "Present when spend cannot be attributed; its presence is what stops the 0 being read as real." },
    refusals_unavailable_reason: { type: "string", description: "Present when refusals cannot be attributed." },
    spend_unpriced_settled: { type: "integer", description: "Settled rows in the subtree with no amount. Counted, never priced as zero." },
  },
} as const;

const GUARD_VERDICT_BODY = {
  type: "object",
  required: ["verdict"],
  properties: {
    verdict: { type: "string", enum: ["pay", "review", "do_not_pay"] },
    reasonCodes: { type: "array", maxItems: 20, items: { type: "string" }, description: "Reason codes from the local verdict. The first ten are stored." },
    payTo: { type: "string", maxLength: 128, description: "The payee the decision was about — a public address, not the caller." },
    at: { type: "string", maxLength: 40, description: "When the decision was made, as the caller recorded it." },
  },
} as const;

const FAUCET_BODY = {
  type: "object",
  required: ["address"],
  properties: { address: { type: "string", description: "0x-prefixed 20-byte Base Sepolia address." } },
} as const;

function paidOperation(summary: string, description: string, bodySchema: unknown) {
  return {
    post: {
      summary,
      description,
      operationId: summary.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
      requestBody: {
        required: true,
        content: { "application/json": { schema: bodySchema } },
      },
      responses: {
        "400": {
          description:
            "The body or the policy was rejected. The cause is named in `field`; `is_retriable` is false because the same body will fail the same way.",
          content: { "application/problem+json": { schema: PROBLEM_SCHEMA } },
        },
        "429": {
          description: "Daily quota for this caller is spent. `retry_after_seconds` says when it resets.",
          content: { "application/problem+json": { schema: PROBLEM_SCHEMA } },
        },
        "503": {
          description: "The payment facilitator did not answer in time. Retriable after `retry_after_seconds`.",
          content: { "application/problem+json": { schema: PROBLEM_SCHEMA } },
        },
        "200": {
          description: "A verdict. Free-tier calls answer this without payment.",
          content: { "application/json": { schema: VERDICT_SCHEMA } },
        },
        "402": {
          description:
            "Payment required. The challenge travels in the Payment-Required header; the free tier " +
            "answers 200 first for callers without a payment signature.",
          headers: {
            "Payment-Required": {
              description: "base64-encoded x402 v2 PaymentRequired object",
              schema: { type: "string" },
            },
          },
        },
      },
      // The field x402scan reads to decide this operation is payable and at what price.
      "x-payment-info": {
        protocols: ["x402"],
        network: NETWORK,
        price: { mode: "fixed", currency: "USD", amount: PRICE },
      },
    },
  };
}

export const OPENAPI_DOCUMENT = {
  openapi: "3.1.0",
  info: {
    title: "PayStage",
    version: "2026.11.14",
    description:
      "Read-only preflight for x402 payments. Returns pay / review / do_not_pay before anything is " +
      "signed, with the rule that fired. Never signs and never holds a key.",
    contact: { url: "https://paystage.xyz", email: "basebuzz69@gmail.com" },
  },
  servers: [{ url: "https://api.paystage.xyz" }],
  paths: {
    /**
     * The paid-only alias (#150). It is documented as its own operation because its purpose is different — an indexer or
     * crawler probing it must see a challenge, and a caller that needs the free tier should use the canonical path.
     */
    "/v1/paid/evaluate_mcp_payment": paidOperation(
      "Paid-only alias of evaluate_mcp_payment",
      "Identical evaluation to /v1/evaluate_mcp_payment, at a path that always answers 402 to an unpaid caller. " +
        "Use it if you are a directory or crawler that discovers x402 endpoints by requiring a challenge: the canonical " +
        "path may answer 200 from the free tier, and an indexer that only indexes challenging endpoints would skip it. " +
        "Do NOT use it to avoid the free tier — the free tier exists so an agent can get a verdict without paying, and " +
        "the canonical path is the one documented for agents. " +
        "The request body is the same as the canonical operation: payment_required is the decoded x402 v2 challenge with " +
        "amount in ATOMIC units as a decimal string (12500000 = 12.5 USDC at 6 decimals), and policy is your policy document. " +
        "Responses are JSON: decision is pay | review | do_not_pay, reasons[] carries one sentence per rule, and a receipt " +
        "field is present when the deployment signs receipts.",
      PAYMENT_BODY,
    ),
    "/v1/evaluate_mcp_payment": paidOperation(
      "Evaluate one x402 payment against a spend policy",
      "Use this immediately before signing any x402 payment: it returns pay, review or do_not_pay with the rule that " +
        "fired. Do NOT use it to inspect outstanding allowances (use /v1/evaluate_outstanding_auths) or to verify a " +
        "receipt (use verify_receipt in the MCP package). It never signs, never moves funds and has no side effects, so " +
        "a refusal costs nothing. " +
        "payment_required is the decoded x402 v2 challenge — the object the seller returned under `accepts`, with " +
        "amount in ATOMIC units as a decimal string (12500000 = 12.5 USDC at 6 decimals). " +
        "policy is a version 1 policy document; validate it first with validate_policy, because an invalid policy makes " +
        "every evaluation refuse with a 400 and that looks like an outage. " +
        "Order matters when the policy has per-agent budgets: pass agent_id, or the per-agent rules are unreachable.",
      PAYMENT_BODY,
    ),
    "/v1/evaluate_outstanding_auths": paidOperation(
      "Judge outstanding ERC-20 / Permit2 / EIP-3009 authorisations",
      "Use this when an agent already holds approvals and you need to know which are dangerous before the next payment " +
        "— unlimited allowances, expired authorisations, spenders that are not on the allow-list. Do NOT use it to " +
        "revoke anything: it reports, and revocation is a transaction the caller sends. " +
        "auths is the array returned by list_outstanding_auths; passing a hand-built array works but must match that " +
        "shape (spender, amount as an atomic decimal string, expiry as a unix timestamp in seconds). " +
        "Call list_outstanding_auths first when the caller does not already hold that array.",
      {
        type: "object",
        required: ["auths", "policy"],
        properties: {
          auths: { type: "array", items: { type: "object" }, description: "Authorisations to evaluate" },
          policy: { type: "object" },
        },
      },
    ),

    /* ------------------------------------------------------------------------------------------------------------
     * Free public reads, facilitator surface, writes and transports. None is payable.
     * --------------------------------------------------------------------------------------------------------- */

    "/health": {
      get: {
        summary: "Liveness and telemetry-pipe health",
        description:
          "Use this to check that the Worker answers and whether the event pipe is configured and dropping writes. " +
          "Do NOT use it as a readiness check for the paid path: `/health` answers 200 even when the facilitator is " +
          "unreachable, and the operational flags for that are on `/v1/public/status`. The body is booleans and a drop " +
          "counter — no secret values are ever included.",
        operationId: "get_health",
        responses: {
          "200": json("The service is up. `telemetry.configured` false means events cannot be written at all.", HEALTH_SCHEMA),
        },
      },
    },
    "/v1/public/status": {
      get: {
        summary: "Operational status: flags, incidents and published limits",
        description:
          "Use this to find out whether the service is degraded before blaming your own request. Do NOT use it to " +
          "evaluate a payment; it has no verdict. `status` is derived from the issue flags: a failed-settlement, " +
          "facilitator-error or block-rate flag is an outage, any other triggered flag is degraded. With telemetry " +
          "unconfigured it still answers 200 with an empty feed and `note: telemetry_unconfigured`, so an empty list " +
          "must not be read as a healthy one.",
        operationId: "get_public_status",
        responses: {
          "200": json("The current status document. Always 200; absence of telemetry is a `note`, not an error.", STATUS_SCHEMA),
        },
      },
    },
    "/v1/public/chain.json": {
      get: {
        summary: "Latest Base mainnet block and gas price",
        description:
          "Use this to display live chain facts from PayStage's origin instead of calling a public RPC from the browser. " +
          "Do NOT use it as a settlement proof: it is an observation of Base, not of any payment. The route tries several " +
          "no-key RPCs and answers 200 in every case; when none answers, `ok` is false, `block`/`gasGwei` are null and " +
          "`note` says the RPC did not answer rather than implying a chain stall. Cached for three seconds.",
        operationId: "get_public_chain",
        responses: {
          "200": json("The chain snapshot, fresh or explicitly marked unavailable.", CHAIN_SCHEMA),
        },
      },
    },
    "/v1/public/example-receipt.json": {
      get: {
        summary: "One real signed receipt, as an example",
        description:
          "Use this to check a receipt verifier offline before trusting a live bundle. Do NOT use it as a record of any " +
          "particular payment: it is a fixed committed example, served with the public key at " +
          "`/v1/public/example-key.json`. The body is a signed PayStage receipt; its exact shape is the receipt format " +
          "the evaluation operations return in their `receipt` field, not a separate schema.",
        operationId: "get_example_receipt",
        responses: {
          "200": {
            description: "The example signed receipt, served inline as `application/json` with an inline content-disposition.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/v1/public/example-key.json": {
      get: {
        summary: "The public key that signed the example receipt",
        description:
          "Use this with `/v1/public/example-receipt.json` to verify the example offline. Do NOT use it as the live key " +
          "set: the deployed receipt keys are listed by the receipt-key document, and this is the committed example's " +
          "key. The body is a JWK-shaped public key; there is no private material here.",
        operationId: "get_example_key",
        responses: {
          "200": {
            description: "The example public key, served inline as `application/json`.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },
    "/supported": {
      get: {
        summary: "x402 facilitator discovery document",
        description:
          "Use this to discover which scheme/network pairs this host settles for and which signer address it uses. " +
          "Do NOT use it to verify a payment; that is `POST /verify`. The body is exactly `SupportedResponse` from " +
          "`@x402/core` — `{ kinds, extensions, signers }` — and nothing is added at the top level. It answers 200 in " +
          "every deployment mode; the `x-paystage-facilitator` header says which one (`self`, `self-unconfigured`, " +
          "`cdp`). Only in `self` mode do `/verify` and `/settle` actually settle.",
        operationId: "get_supported",
        responses: {
          "200": {
            description: "The protocol's SupportedResponse. `signers` is `{}` until a settling key is loaded; that is not an error.",
            headers: {
              "x-paystage-facilitator": {
                description: "Which mode produced this document.",
                schema: { type: "string", enum: ["self", "self-unconfigured", "cdp"] },
              },
            },
            content: { "application/json": { schema: SUPPORTED_SCHEMA } },
          },
        },
      },
    },
    "/verify": {
      post: {
        summary: "Verify an x402 v2 payment without settling it",
        description:
          "Use this to ask the facilitator whether a signed payment would be accepted. Do NOT use it to move funds; " +
          "`POST /settle` is the write. The body is x402 v2's `VerifyRequest` (`{ x402Version?, paymentPayload, " +
          "paymentRequirements }`) and the response is its `VerifyResponse`. A payment that is well-formed but invalid " +
          "answers **200** with `isValid: false` — a 4xx means the request itself was malformed, not that the payment " +
          "was refused. Answers 503 when this deployment has no local facilitator loaded.",
        operationId: "post_verify",
        requestBody: { required: true, content: { "application/json": { schema: FACILITATOR_REQUEST_SCHEMA } } },
        responses: {
          "200": json("The verification result. `isValid: false` is a refused payment, not a failed request.", VERIFY_RESPONSE_SCHEMA),
          "400": json("The JSON or the x402 v2 fields were malformed. Fix the body; retrying it unchanged will fail the same way.", FACILITATOR_ERROR_SCHEMA),
          "503": json("No local facilitator is configured on this deployment (`FACILITATOR_MODE` is not `self`, or no gas key is loaded).", FACILITATOR_ERROR_SCHEMA),
        },
      },
    },
    "/settle": {
      post: {
        summary: "Settle an x402 v2 payment on chain",
        description:
          "Use this to submit a payment the seller has accepted. Do NOT use it to test a payment: settlement moves funds, " +
          "and `/verify` answers the same validity question without a transaction. The body is x402 v2's `SettleRequest` " +
          "and the response is its `SettleResponse`; a rejected settlement answers **200** with `success: false`. Answers " +
          "503 when no local facilitator is loaded, before any funds can move.",
        operationId: "post_settle",
        requestBody: { required: true, content: { "application/json": { schema: FACILITATOR_REQUEST_SCHEMA } } },
        responses: {
          "200": json("The settlement result. `success: false` is a refused settlement, not a failed request.", SETTLE_RESPONSE_SCHEMA),
          "400": json("The JSON or the x402 v2 fields were malformed. Nothing was submitted.", FACILITATOR_ERROR_SCHEMA),
          "503": json("No local facilitator is configured on this deployment, so nothing was submitted.", FACILITATOR_ERROR_SCHEMA),
        },
      },
    },
    "/openapi.json": {
      get: {
        summary: "This document",
        description:
          "Use this to load the API contract into a client or discovery indexer. Do NOT use it to discover x402 pricing " +
          "only: the three paid operations carry `x-payment-info`, and the rest of this document is free public surface. " +
          "The response is the OpenAPI 3.1 object itself, cached for an hour.",
        operationId: "get_openapi",
        responses: {
          "200": {
            description: "The OpenAPI 3.1 document, served as `application/json` with CORS open to any origin.",
            content: { "application/json": { schema: { type: "object" } } },
          },
        },
      },
    },

    "/runs/:id": {
      get: {
        summary: "Read one stored evidence bundle",
        description:
          "Use this to audit a past decision from its content-addressed id (the `bundle_id` an evaluation returned). " +
          "Do NOT use it to make a new decision: it is a read of storage and never evaluates. The id is the SHA-256 of " +
          "the canonical inputs — 64 lowercase hex characters — and an unknown id answers 404, not an empty 200. With no " +
          "`format`, the response is one markdown document containing events.jsonl, proof, receipt and summary.md; " +
          "`?format=json` returns all four as structured JSON, and the other formats return the single artefact with its " +
          "own content type. Storage that is missing or throwing answers 503, never an empty bundle.",
        operationId: "get_run",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            description: "The bundle id: 64 lowercase hex characters (SHA-256 of the canonical inputs).",
            schema: { type: "string", pattern: "^[0-9a-f]{64}$" },
          },
          {
            name: "format",
            in: "query",
            required: false,
            description:
              "Omit for the combined markdown document. `json` returns the structured bundle, `events` NDJSON, `proof` and `receipt` JSON, `summary` markdown.",
            schema: {
              type: "string",
              enum: ["markdown", "json", "events", "proof", "summary", "receipt"],
              default: "markdown",
            },
          },
        ],
        responses: {
          "200": {
            description:
              "The requested artefact. `format` selects the media type: no format is one markdown document containing all " +
              "four artefacts, `json` is the structured bundle below, `events` is NDJSON, `proof` and `receipt` are the " +
              "single stored JSON object, and `summary` is markdown.",
            content: {
              "text/markdown": { schema: { type: "string", description: "The combined bundle, or the summary when `format=summary`." } },
              "application/json": {
                schema: {
                  anyOf: [
                    RUN_JSON_SCHEMA,
                    { type: "object", description: "The single stored `proof` or `receipt` object when that format is requested." },
                  ],
                },
              },
              "application/x-ndjson": { schema: { type: "string", description: "The stored events, one JSON object per line." } },
            },
          },
          "400": problem("`format` is not one of the supported values. The value is repeated in the problem's `field`/`detail`."),
          "404": problem("The id is not a bundle id, no bundle exists with it, or `format=receipt` was asked for a bundle whose evaluation issued no receipt."),
          "503": problem("Storage is not configured, did not answer, or returned a corrupt artefact. This is an outage, not an absent bundle."),
        },
      },
    },
    "/wallets/:address": {
      get: {
        summary: "What sources observed about one payee",
        description:
          "Use this to read the stored observations about a payment address: labels, the source and read date behind " +
          "each one, and fields two sources disagree about. Do NOT use it as a trust score: there is no score, no trust " +
          "level and no aggregated verdict, because the observations cannot support one. An address with no rows answers " +
          "200 with empty arrays — that is a real answer; missing or failed storage answers 503, never an empty 200.",
        operationId: "get_wallet",
        parameters: [
          {
            name: "address",
            in: "path",
            required: true,
            description: "A 0x-prefixed 20-byte hex address. Case is normalised to lower case.",
            schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
          },
        ],
        responses: {
          "200": json("The observations and their categories. Empty arrays mean nothing was observed, not that the address is clean.", WALLET_SCHEMA),
          "400": problem("`address` is not a 0x-prefixed 20-byte hex address."),
          "503": problem("Payee storage is not configured, did not answer, or returned a corrupt row. The 503 distinguishes 'could not look' from 'looked and found nothing'."),
        },
      },
    },
    "/v1/mandate/:serial": {
      get: {
        summary: "Read the live record behind a Vouch pass",
        description:
          "Use this when scanning a pass or checking whether an authority still exists: it returns the status, the scope " +
          "the principal signed, the self-asserted principal and the verdict a seller should take. Do NOT use it to mint " +
          "or revoke a mandate; those are the bearer-gated POST operations. An unknown serial answers **200** with " +
          "`status: \"unknown\"` — not 404, because 'unknown' is an answer a scanner can act on. Expiry is recomputed at " +
          "read time and revocation outranks it. Never cached.",
        operationId: "get_mandate",
        parameters: [
          {
            name: "serial",
            in: "path",
            required: true,
            description: "The pass serial.",
            schema: MANDATE_SERIAL_SCHEMA,
          },
        ],
        responses: {
          "200": json("The mandate record, or an all-unknown record for a serial this deployment does not know.", MANDATE_SCHEMA),
          "400": problem("`serial` does not match either accepted serial form. Strict on purpose: a loose segment turns this into a directory probe."),
          "503": problem("The mandate store was configured but the read failed. Failed closed rather than reported as `unknown`, because 'could not check' is not 'no such mandate'."),
        },
      },
    },
    "/v1/public/rollup": {
      get: {
        summary: "A unit's mandate totals including every descendant",
        description:
          "Use this to read one tenant-scoped org unit and its subtree in a single answer. Do NOT use it to audit an " +
          "individual payment: `spend_minor` is only attributable when the event rows carry a mandate serial, and " +
          "without that join the route returns 0 **with** `spend_unavailable_reason` naming the gap. Mandate counts and " +
          "the descendant list are always real; a zero without its reason is the failure this contract exists to prevent. " +
          "Matching is by whole path segment, so `paystage/eng` never includes `paystage/engineering`.",
        operationId: "get_public_rollup",
        parameters: [
          {
            name: "unit",
            in: "query",
            required: true,
            description: "The org unit path to roll up, e.g. `paystage/eng`. Its first segment is the tenant.",
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": json("The unit's totals and descendants. Check for the `*_unavailable_reason` fields before reading a zero as measured.", ROLLUP_SCHEMA),
          "400": problem("`unit` is missing or is not a valid org unit path."),
          "503": problem("No roll-up store is configured, or the read failed. Never answered with zeros, because that would look like a total."),
        },
      },
    },
    "/v1/guard-verdict": {
      post: {
        summary: "Record an opt-in x402-guard verdict",
        description:
          "Use this when `guardFetch({ telemetryUrl })` opted in and you want refusals recorded even after the response " +
          "is gone. Do NOT use it to make a decision: it records a verdict your client already made and returns no " +
          "verdict. The body is deliberately narrow — `verdict`, up to 20 `reasonCodes`, the payee and a timestamp; no " +
          "wallet address, signature or request body is accepted. Answers 202 because the write is fire-and-forget.",
        operationId: "post_guard_verdict",
        requestBody: { required: true, content: { "application/json": { schema: GUARD_VERDICT_BODY } } },
        responses: {
          "202": json("Accepted for recording. The write may outlive the response; a storage failure is not reported here.", {
            type: "object",
            required: ["ok"],
            properties: { ok: { type: "boolean", enum: [true] } },
          }),
          "400": json("The JSON could not be parsed, or the body failed validation (`error` is `invalid_json` or `invalid_verdict`, with `detail` on the field).", {
            type: "object",
            properties: { error: { type: "string" }, detail: { type: "string" } },
          }),
        },
      },
    },
    "/v1/mandate": {
      post: {
        summary: "Mint a mandate record from a signed envelope",
        description:
          "Use this as the write half of a Vouch authority, with a service token. Do NOT use it as a paid evaluation: " +
          "it is gated by a bearer token, not x402, and never evaluates a payment. The body is " +
          "`{ envelope, revocations?, org_unit? }`; the signed envelope is verified before anything is written, the serial " +
          "comes from the envelope (never a body-level `serial`), and an existing row is never overwritten — a revoked " +
          "serial stays revoked. Success is 201 with the serial and where to verify it, not a second copy of the authority.",
        operationId: "post_mandate",
        security: [{ bearerAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["envelope"],
                properties: {
                  envelope: { type: "object", description: "The signed mandate envelope. Its `serial` is the record's identity." },
                  revocations: { type: "array", items: { type: "object" }, description: "Signed revocation statements the caller has seen." },
                  org_unit: { type: "string", description: "Optional allocation label in the tenant's own tree, e.g. `paystage/eng`." },
                },
              },
            },
          },
        },
        responses: {
          "201": json("Minted. The serial and its verification URL; the envelope is not echoed.", {
            type: "object",
            required: ["serial", "verification_url"],
            properties: {
              serial: { type: "string" },
              verification_url: { type: "string", format: "uri" },
            },
          }),
          "400": problem("The JSON, envelope, revocations, org unit or signature was rejected. The problem's `error` names which."),
          "401": problem("The bearer token is missing or wrong. The check happens before the body is parsed, so an unauthenticated caller learns nothing about envelope validation."),
          "409": problem("The serial already exists (an already-minted or revoked mandate). A serial is never overwritten; a revoked one keeps its revocation."),
          "503": problem("This deployment cannot mint (no store, token, tenant or verification keys), or the store read/write failed. Nothing was written."),
        },
      },
    },
    "/v1/mandate/:serial/revoke": {
      post: {
        summary: "Revoke a mandate with a signed statement",
        description:
          "Use this to end an authority, with the same bearer token and the same signed statement a seller would verify. " +
          "Do NOT use it to mint or read a mandate. The body is the revocation statement itself, not a wrapper; the path " +
          "must name the same serial as the statement, and a mismatch is a 400 rather than a silent no-op. The call is " +
          "idempotent: a second revoke answers 409 with the first `revoked_at` and writes nothing.",
        operationId: "post_mandate_revoke",
        security: [{ bearerAuth: [] }],
        parameters: [
          {
            name: "serial",
            in: "path",
            required: true,
            description: "The mandate serial being revoked. Must match the statement's `serial`.",
            schema: MANDATE_SERIAL_SCHEMA,
          },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["v", "serial", "revoked_at", "kid", "signature"],
                description: "A signed revocation statement. `reason` is optional.",
                properties: {
                  v: { type: "integer", enum: [1], description: "Statement version. Only version 1 is understood." },
                  serial: { type: "string", description: "Must equal the path serial." },
                  kid: { type: "string", description: "The key id that signed the statement." },
                  signature: { type: "string", description: "The statement's ES256 signature." },
                  revoked_at: { type: "string", format: "date-time", description: "When the principal revoked; must parse as ISO 8601, and the first value stands on repeat calls." },
                  reason: { type: "string", description: "Optional human reason." },
                },
              },
            },
          },
        },
        responses: {
          "200": json("Revoked. The stored record's status is now `revoked` and every check answers `do_not_trust`.", {
            type: "object",
            required: ["serial", "revoked_at", "status"],
            properties: {
              serial: { type: "string" },
              revoked_at: { type: "string" },
              status: { type: "string", enum: ["revoked"] },
            },
          }),
          "400": problem("The JSON, statement, serial or signature was rejected, or the statement names a different serial than the path."),
          "403": problem("The bearer token is missing or wrong. Checked before the body, so nothing about the statement leaks."),
          "404": problem("No mandate exists with this serial. A revocation cannot create one."),
          "409": problem("Already revoked. The body repeats the first `revoked_at`; treat it as success and do not retry the write."),
          "503": problem("This deployment cannot revoke (no store, token or verification keys), or the store read/write failed."),
        },
      },
    },
    "/faucet": {
      get: {
        summary: "Describe the testnet faucet",
        description:
          "Use this to learn the drip amount, the per-address window and the request body without spending a call. Do NOT " +
          "use it to request funds; `POST /faucet` does that. This route takes no payment and is mounted before the payment " +
          "middleware so a caller with no testnet funds can still discover it.",
        operationId: "get_faucet",
        responses: {
          "200": json("The faucet's drip size, window, method and request body.", {
            type: "object",
            properties: {
              drip: {
                type: "object",
                properties: { amountUsdc: { type: "string" }, perAddressPerHours: { type: "integer" } },
              },
              method: { type: "string", enum: ["POST"] },
              body: { type: "object", properties: { address: { type: "string" } } },
              network: { type: "string" },
              note: { type: "string" },
            },
          }),
        },
      },
      post: {
        summary: "Request testnet USDC for a Base Sepolia address",
        description:
          "Use this once per address to fund a testnet-only trial; it is free and unauthenticated. Do NOT use it with a " +
          "mainnet address or expect more than one drip per 24 hours. The body is `{ address }`; success returns the " +
          "transaction hash and an explorer link. A failed send answers 502 and records nothing, so the address can retry " +
          "the same day. The response note distinguishes 'confirmed' from 'submitted, confirmation pending'.",
        operationId: "post_faucet",
        requestBody: { required: true, content: { "application/json": { schema: FAUCET_BODY } } },
        responses: {
          "200": json("The drip was submitted, with its transaction hash, explorer link and confirmation note.", {
            type: "object",
            properties: {
              address: { type: "string" },
              amountUsdc: { type: "string" },
              txHash: { type: "string" },
              explorer: { type: "string", format: "uri" },
              cap: { type: "object" },
              note: { type: "string" },
            },
          }),
          "400": json("The body is not JSON, or `address` is not a 0x-prefixed 20-byte hex address.", {
            type: "object",
            properties: {
              error: { type: "string" },
              expects: { type: "object", properties: { address: { type: "string" } } },
            },
          }),
          "429": problem("This address was already funded inside the 24-hour window. The body names the reset time and hours remaining; a retry before then cannot succeed."),
          "502": json("The faucet could not send right now. Nothing was recorded, so this address can try again.", {
            type: "object",
            properties: { error: { type: "string" }, detail: { type: "string" } },
          }),
          "503": json("The faucet has no funded key on this deployment.", {
            type: "object",
            properties: { error: { type: "string" } },
          }),
        },
      },
    },
    "/mcp": {
      get: {
        summary: "Open the MCP streamable-HTTP event stream",
        description:
          "Use this transport to connect an MCP client that reads server notifications over SSE. Do NOT use it to send " +
          "a tool call: POST a JSON-RPC message to the same path. The MCP session is identified by the transport's own " +
          "headers; this surface exposes all ten tools, including the testnet faucet writer and trade preflight.",
        operationId: "mcp_stream",
        responses: {
          "200": { description: "The text/event-stream connection carrying MCP messages. The transport's response codes apply; this route delegates to the MCP handler." },
          "400": { description: "The request was not a valid MCP stream request." },
        },
      },
      post: {
        summary: "Send a JSON-RPC message to the MCP server (all ten tools)",
        description:
          "Use this as the remote MCP endpoint for tool discovery and calls. Do NOT use `/mcp` when you need the curated, " +
          "read-only payment surface — that is `/mcp/chatgpt`. The body is an MCP JSON-RPC message; a protocol error is a " +
          "JSON-RPC error inside a 200 response, not an HTTP error. Tools include payment evaluation, decoding, receipt " +
          "verification, the outstanding-auth tools and a testnet faucet writer.",
        operationId: "mcp_post",
        responses: {
          "200": { description: "A JSON-RPC response (success or protocol-level error) or an SSE stream. This route hands the request to the MCP transport; its status semantics apply." },
          "202": { description: "A notification was accepted; notifications have no response body." },
          "400": { description: "The request was not valid JSON-RPC or a valid MCP message." },
        },
      },
      delete: {
        summary: "End an MCP session",
        description:
          "Use this to terminate a streamable-HTTP MCP session cleanly, per the MCP transport. Do NOT use it to delete " +
          "any stored payment record: MCP sessions are transport state, and this route deletes nothing else.",
        operationId: "mcp_delete",
        responses: {
          "200": { description: "The session was terminated, or there was nothing to terminate." },
          "400": { description: "The request did not name a valid MCP session." },
        },
      },
    },
    "/mcp/chatgpt": {
      get: {
        summary: "Open the curated MCP event stream (read-only payment tools)",
        description:
          "Use this with a ChatGPT-facing MCP client that reads SSE. Do NOT use it to reach the writer tools: this surface " +
          "is filtered to the read-only payment tools (gate, decode, verify). It shares the per-instance free allowance, " +
          "and past the cap the transport answers 429 with a body that names the cap instead of a bare 402/429.",
        operationId: "mcp_chatgpt_stream",
        responses: {
          "200": { description: "The text/event-stream connection carrying curated MCP messages." },
          "400": { description: "The request was not a valid MCP stream request." },
          "429": { description: "The free allowance for this Worker instance is spent. The body names the cap, the reset and the paid path." },
        },
      },
      post: {
        summary: "Send a JSON-RPC message to the curated MCP server (read-only tools)",
        description:
          "Use this as the ChatGPT-facing MCP endpoint: the same handlers as `/mcp`, filtered to the read-only payment " +
          "tools. Do NOT use it for the faucet writer or trade preflight; those stay on `/mcp`. The free allowance is " +
          "per Worker instance, and past it the response is a JSON-RPC error in a 429 whose message names the cap, the " +
          "reset and the paid path — because a ChatGPT client cannot pay in-chat and a bare 402 reads as an outage.",
        operationId: "mcp_chatgpt_post",
        responses: {
          "200": { description: "A JSON-RPC response (success or protocol-level error) or an SSE stream." },
          "202": { description: "A notification was accepted; notifications have no response body." },
          "400": { description: "The request was not valid JSON-RPC or a valid MCP message." },
          "429": { description: "The free allowance for this Worker instance is spent. The body names the cap, the reset and the paid path." },
        },
      },
      delete: {
        summary: "End a curated MCP session",
        description: "Use this to terminate a streamable-HTTP MCP session on the curated surface. It deletes transport state only.",
        operationId: "mcp_chatgpt_delete",
        responses: {
          "200": { description: "The session was terminated, or there was nothing to terminate." },
          "400": { description: "The request did not name a valid MCP session." },
          "429": { description: "The free allowance for this Worker instance is spent. The body names the cap, the reset and the paid path." },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        description: "The deployment's mandate service token. Not an x402 payment and not a user account.",
      },
    },
  },
  // No auth on the evaluation surface: an agent cannot fill in a signup form, which is why the free tier exists.
  // The two mandate writes declare `bearerAuth` on their own operations.
  security: [],
};

openapiRoutes.get("/openapi.json", (c) =>
  c.json(OPENAPI_DOCUMENT, 200, {
    "cache-control": "public, max-age=3600",
    "access-control-allow-origin": "*",
  }),
);

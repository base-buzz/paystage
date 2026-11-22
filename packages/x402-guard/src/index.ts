/**
 * @paystage/x402-guard — the ten lines between "the agent decided to pay" and "the money
 * moved".
 *
 * `x402-fetch` handles the payment loop well: request, read 402, sign, retry. What it does
 * not do is ask whether the payment should happen. This wraps it so the policy is evaluated
 * against the actual challenge — before the wallet signs — and a denial never reaches the
 * signing step at all.
 *
 *   const guarded = guardFetch(fetch, {
 *     walletClient,
 *     policy: { version: 1, max_amount: { value: "0.05", asset: "USDC", decimals: 6 }, … },
 *   });
 *   const res = await guarded("https://api.example.com/paid");
 *
 * `res.headers.get("x-paystage-verdict")` is `pay`, `review` or `do_not_pay`, always present,
 * including on a refusal. Nothing here signs anything: staging the signature belongs to
 * x402-fetch, and this only decides whether it is allowed to.
 */

import { createRequire } from "node:module";
import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import { BuilderCodeClientExtension } from "@x402/extensions";
import { parsePolicy } from "@paystage/policy";

export type Verdict = "pay" | "review" | "do_not_pay";

export interface GuardOptions {
  /**
   * The signer **`x402-fetch` (v1, unscoped)** takes — a viem `Signer`, passed through untouched.
   *
   * v2 lives in a different package with a different shape: `@x402/fetch@2` takes an `x402Client`, not a
   * wallet, and `guardFetch` cannot drive it. Use `paystageClientHook` for that path rather than this option;
   * passing a v2 client here now raises a named error instead of failing inside the peer with
   * `createPaymentPayload is not a function`.
   */
  walletClient?: unknown;
  /** Policy document (same schema as @paystage/policy) or a pre-parsed policy. */
  policy: unknown;
  /** `pay` (default) proceeds on an ambiguous payee; any other value refuses. */
  onReview?: "pay" | "refuse";
  /**
   * Maximum value in base units, passed as `x402-fetch`'s third argument. **v1 only** — `@x402/fetch@2`
   * removed the parameter, so on v2 this is dropped silently and the ceiling is the policy's job.
   */
  maxValue?: bigint;
  /**
   * Base Builder Code (ERC-8021) for the payments this wrapper causes.
   *
   * 1-32 characters, lowercase alphanumeric and underscores. Opt-in: it goes on payments our code
   * drives, never on ones we merely observe.
   */
  builderCode?: string;
  /**
   * Called with every decision, before the request proceeds or is refused.
   *
   * The guard cannot persist anything itself: it runs inside the caller's process and has no business
   * writing to a database or calling a network it was not given. This is the seam — wire it to your
   * logger, your telemetry table, or the hosted endpoint via `telemetryUrl`.
   */
  onVerdict?: (verdict: GuardVerdict) => void;
  /**
   * POST each verdict to a collector, e.g. `https://api.paystage.xyz/v1/guard-verdict`.
   *
   * **Opt-in and fire-and-forget.** The payload is the verdict, the reason codes, the payee and a
   * timestamp — no wallet address, no signature, no body of the request being made. A refusal you
   * cannot audit afterwards is the thing this exists to fix; a silent phone-home would be a worse
   * problem than the one it solves.
   */
  telemetryUrl?: string;
  /** Source label sent with the telemetry row; defaults to `test` so our own runs are never counted as callers. */
  telemetrySource?: "real" | "synthetic" | "test";
  /** Injected for tests; defaults to `x402-fetch`'s wrapFetchWithPayment. */
  wrap?: (
    fetchImpl: typeof fetch,
    walletClient: unknown,
    maxValue?: bigint,
  ) => (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface GuardVerdict {
  verdict: Verdict;
  reasonCodes: string[];
  payTo?: string;
  at: string;
}

export interface GuardResult {
  response: Response;
  verdict: Verdict;
  /** The rule ids that produced the verdict, for logs and receipts. */
  reasonCodes: string[];
}

/** Decode the x402 v2 `payment-required` header without taking a dependency on x402-fetch. */
export { PAYSTAGE_BUILDER_CODE, BUILDER_CODE_PATTERN, assertBuilderCode } from "./builder-code.js";

export function decodePaymentRequiredHeader(value: string | null): unknown {
  if (!value) return null;
  try {
    const json = typeof atob === "function"
      ? atob(value)
      : Buffer.from(value, "base64").toString("utf8");
    return JSON.parse(json) as unknown;
  } catch {
    return null;
  }
}

/**
 * Wrap fetch so every 402 is judged against the policy before anything is signed.
 *
 * Returned responses always carry `x-paystage-verdict`. A refusal returns the original 402
 * unchanged apart from that header, so the caller still sees the real challenge and can log
 * it, rather than receiving a manufactured error that hides what the server asked for.
 */
export function guardFetch(fetchImpl: typeof fetch, options: GuardOptions) {
  const policy = (() => {
    try {
      return parsePolicy(options.policy as never);
    } catch (error) {
      throw new Error(
        `@paystage/x402-guard: invalid policy — ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  })();

  // Base Builder Code (ERC-8021): an opt-in that travels on the payments this wrapper causes.
  //
  // We never sign, so a builder code cannot attribute a user's volume to us — but it CAN attribute the
  // payments our code drives, which is exactly what the program is for. It is never attached to a
  // payment we merely observed.
  if (options.builderCode !== undefined) {
    if (!/^[a-z0-9_]{1,32}$/.test(options.builderCode)) {
      throw new Error(
        `@paystage/x402-guard: invalid builderCode "${options.builderCode}" — must be 1-32 chars, lowercase alphanumeric and underscores`,
      );
    }
    // Registered synchronously: a registration that may not have happened by the time the first
    // payment is built is worse than a hard dependency.
    const client = options.walletClient as { registerExtension?: (ext: unknown) => unknown } | undefined;
    if (client && typeof client.registerExtension === "function") {
      client.registerExtension(new BuilderCodeClientExtension(options.builderCode));
    }
  }

  const announce = (verdict: Verdict, reasonCodes: string[], payTo?: string) => {
    const record: GuardVerdict = { verdict, reasonCodes, payTo, at: new Date().toISOString() };
    try {
      options.onVerdict?.(record);
    } catch {
      // A caller's logger must never change whether a payment is allowed.
    }
    if (options.telemetryUrl) {
      void fetchImpl(options.telemetryUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-paystage-source": options.telemetrySource ?? "test",
        },
        body: JSON.stringify(record),
      }).catch(() => {
        // Telemetry is not on the payment path; a failed POST must not fail the call.
      });
    }
  };

  const onReview = options.onReview ?? "pay";
  const lastResult: { current: GuardResult | null } = { current: null };

  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const first = await fetchImpl(input, init);

      // Not a payment challenge: nothing to judge, and the verdict header says so honestly
      // rather than claiming a payment was approved.
      if (first.status !== 402) {
        lastResult.current = { response: first, verdict: "pay", reasonCodes: ["no_payment_required"] };
        announce("pay", ["no_payment_required"]);
        return withVerdict(first, "pay", ["no_payment_required"]);
      }

      const challenge = decodePaymentRequiredHeader(first.headers.get("payment-required"));
      if (challenge === null) {
        lastResult.current = {
          response: first,
          verdict: "review",
          reasonCodes: ["unreadable_challenge"],
        };
        announce("review", ["unreadable_challenge"]);
        return withVerdict(first, "review", ["unreadable_challenge"]);
      }

      // The payee is on the challenge; keep it for the verdict record so a denial names who it was
      // about. Absent is fine — a challenge with no payee is its own finding.
      const payTo =
        (challenge as { accepts?: Array<{ payTo?: string }> })?.accepts?.[0]?.payTo ?? undefined;

      let decision: { decision: string; reasonCodes?: string[]; reasons?: string[]; matchedRule?: string };
      try {
        const normalized = normalizePaymentRequired(challenge as never);
        decision = evaluatePayment(normalized, policy as never) as never;
      } catch (error) {
        // If the challenge cannot be evaluated, refuse rather than guess. An agent that
        // pays what it could not parse is the failure this package exists to prevent.
        lastResult.current = { response: first, verdict: "do_not_pay", reasonCodes: ["evaluation_failed"] };
      announce("do_not_pay", ["evaluation_failed"]);
        return withVerdict(first, "do_not_pay", ["evaluation_failed"]);
      }

      const verdict = normalizeVerdict(decision.decision, onReview);
      // The evaluator reports `reasons`; this wrapper historically looked for `reasonCodes` and so
      // dropped them on every refusal — the header said do_not_pay with no reason attached, which is
      // exactly the thing a caller needs to fix their policy. Read all three spellings.
      const codes =
        decision.reasonCodes ??
        (decision as { reasons?: string[] }).reasons ??
        (decision.matchedRule ? [decision.matchedRule] : []);

      // `review` is a policy instruction, not an oversight: onReview decides whether it pays or refuses. The previous
      // code returned "review" from both branches of normalizeVerdict, so `onReview: "refuse"` refused nothing — while the
      // README and llms.txt promised it did. The verdict is still reported as `review` either way; only the decision to
      // pay changes.
      const blocked = verdict === "do_not_pay" || (verdict === "review" && onReview === "refuse");
      if (blocked) {
        lastResult.current = { response: first, verdict, reasonCodes: codes };
        announce(verdict, codes, payTo);
        return withVerdict(first, verdict, codes);
      }

      // A v2 client is the right object for a different surface. Naming that here costs one check and saves the
      // caller from `client.createPaymentPayload is not a function`, which reads like a broken library.
      if (
        options.walletClient &&
        typeof options.walletClient === "object" &&
        typeof (options.walletClient as { createPaymentPayload?: unknown }).createPaymentPayload === "function"
      ) {
        throw new Error(
          "@paystage/x402-guard: that walletClient is an @x402/fetch v2 client, not a v1 signer. v2 drives payments through a client, not a wallet — register `paystageClientHook({ policy })` on it instead, or install the unscoped `x402-fetch` for this wrapper.",
        );
      }

      const wrap = options.wrap ?? defaultWrap();
      if (!wrap) {
        throw new Error(
          "@paystage/x402-guard: no x402-fetch available. Install `x402-fetch`, or pass `wrap` explicitly.",
        );
      }
      const paid = await wrap(fetchImpl, options.walletClient, options.maxValue)(input, init);
      lastResult.current = { response: paid, verdict, reasonCodes: codes };
      announce(verdict, codes, payTo);
      return withVerdict(paid, verdict, codes);
    },
    { lastResult },
  );
}

function normalizeVerdict(decision: string, _onReview: "pay" | "refuse"): Verdict {
  // The onReview decision moved to the call site: the verdict reported to the caller is what the evaluator said, and
  // whether that verdict blocks the payment is a separate question.
  if (decision === "pay") return "pay";
  if (decision === "review") return "review";
  return "do_not_pay";
}

function withVerdict(response: Response, verdict: Verdict, codes: string[]): Response {
  // Headers on a Response are immutable, so rebuild. Body is passed by reference, which is
  // what keeps this from buffering arbitrary payloads.
  const headers = new Headers(response.headers);
  headers.set("x-paystage-verdict", verdict);
  if (codes.length > 0) headers.set("x-paystage-reason-codes", codes.join(","));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

// Resolves peer dependencies from this module's own location, which is what a consumer's install tree expects.
const requirePeer = createRequire(import.meta.url);

function defaultWrap(): GuardOptions["wrap"] | undefined {
  try {
    // Optional peer: a caller that only wants the gate never loads x402-fetch.
    //
    // `createRequire`, not a bare `require`: this package is `"type": "module"`, where `require` is
    // undefined. The bare call threw a ReferenceError that the `catch` below swallowed, so a caller with
    // x402-fetch installed was told to install it — the documented path (`guardFetch(fetch, { policy })`
    // with no `wrap`) was broken for every ESM consumer, and no test noticed because they all inject `wrap`.
    const mod = requirePeer("x402-fetch") as {
      wrapFetchWithPayment: GuardOptions["wrap"];
    };
    return mod.wrapFetchWithPayment;
  } catch {
    return undefined;
  }
}

export {
  paystageVerifierHook,
  evaluateVerification,
  type VerifierHookOptions,
  type VerifyContextLike,
  type PaymentRequirementsLike,
  type HookOutcome,
} from "./verifier-hook.js";

export { paystageClientHook, evaluateBeforeCreation, type ClientHookOptions, type PaymentCreationContextLike } from "./client-hook.js";

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

import { evaluatePayment, normalizePaymentRequired } from "@paystage/preflight";
import { parsePolicy } from "@paystage/policy";

export type Verdict = "pay" | "review" | "do_not_pay";

export interface GuardOptions {
  /** The wallet client x402-fetch would use. Passed through untouched. */
  walletClient?: unknown;
  /** Policy document (same schema as @paystage/policy) or a pre-parsed policy. */
  policy: unknown;
  /** `pay` (default) proceeds on an ambiguous payee; any other value refuses. */
  onReview?: "pay" | "refuse";
  /** Maximum value in base units, passed to x402-fetch. */
  maxValue?: bigint;
  /** Injected for tests; defaults to `x402-fetch`'s wrapFetchWithPayment. */
  wrap?: (
    fetchImpl: typeof fetch,
    walletClient: unknown,
    maxValue?: bigint,
  ) => (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
}

export interface GuardResult {
  response: Response;
  verdict: Verdict;
  /** The rule ids that produced the verdict, for logs and receipts. */
  reasonCodes: string[];
}

/** Decode the x402 v2 `payment-required` header without taking a dependency on x402-fetch. */
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

  const onReview = options.onReview ?? "pay";
  const lastResult: { current: GuardResult | null } = { current: null };

  return Object.assign(
    async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const first = await fetchImpl(input, init);

      // Not a payment challenge: nothing to judge, and the verdict header says so honestly
      // rather than claiming a payment was approved.
      if (first.status !== 402) {
        lastResult.current = { response: first, verdict: "pay", reasonCodes: ["no_payment_required"] };
        return withVerdict(first, "pay", ["no_payment_required"]);
      }

      const challenge = decodePaymentRequiredHeader(first.headers.get("payment-required"));
      if (challenge === null) {
        lastResult.current = {
          response: first,
          verdict: "review",
          reasonCodes: ["unreadable_challenge"],
        };
        return withVerdict(first, "review", ["unreadable_challenge"]);
      }

      let decision: { decision: string; reasonCodes?: string[]; matchedRule?: string };
      try {
        const normalized = normalizePaymentRequired(challenge as never);
        decision = evaluatePayment(normalized, policy as never) as never;
      } catch (error) {
        // If the challenge cannot be evaluated, refuse rather than guess. An agent that
        // pays what it could not parse is the failure this package exists to prevent.
        lastResult.current = { response: first, verdict: "do_not_pay", reasonCodes: ["evaluation_failed"] };
        return withVerdict(first, "do_not_pay", ["evaluation_failed"]);
      }

      const verdict = normalizeVerdict(decision.decision, onReview);
      const codes = decision.reasonCodes ?? (decision.matchedRule ? [decision.matchedRule] : []);

      if (verdict !== "pay") {
        lastResult.current = { response: first, verdict, reasonCodes: codes };
        return withVerdict(first, verdict, codes);
      }

      const wrap = options.wrap ?? defaultWrap();
      if (!wrap) {
        throw new Error(
          "@paystage/x402-guard: no x402-fetch available. Install `x402-fetch`, or pass `wrap` explicitly.",
        );
      }
      const paid = await wrap(fetchImpl, options.walletClient, options.maxValue)(input, init);
      lastResult.current = { response: paid, verdict, reasonCodes: codes };
      return withVerdict(paid, verdict, codes);
    },
    { lastResult },
  );
}

function normalizeVerdict(decision: string, onReview: "pay" | "refuse"): Verdict {
  if (decision === "pay") return "pay";
  if (decision === "review") return onReview === "pay" ? "review" : "review";
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

function defaultWrap(): GuardOptions["wrap"] | undefined {
  try {
    // Optional peer: a caller that only wants the gate never loads x402-fetch.
    const mod = require("x402-fetch") as {
      wrapFetchWithPayment: GuardOptions["wrap"];
    };
    return mod.wrapFetchWithPayment;
  } catch {
    return undefined;
  }
}

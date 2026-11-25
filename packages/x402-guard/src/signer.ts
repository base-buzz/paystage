/**
 * The signer-side adapter — the gate at the boundary where a signature is produced.
 *
 * `guardFetch` and `paystageClientHook` decide whether a payment *should* be built; they cannot stop
 * an agent that skips the call and signs. This wraps the account's `signTypedData` instead, which is
 * the last point every EIP-3009 x402 payment passes through. The signature is either backed by a
 * verified PayStage receipt for **exactly these bytes**, or it is not produced.
 *
 * Why a subpath rather than a package of its own: the policy, the receipt and the `pay` / `review` /
 * `do_not_pay` vocabulary are already `@paystage/x402-guard`'s, and an integrator should not have to
 * discover a second package to move one layer lower. `viem` therefore stays an **optional peer** —
 * the base guard never imports this module, so a client that only wants a pre-flight check pays
 * nothing for it. `@paystage/receipt-verify` is imported here and nowhere else in this package.
 *
 * The one thing this proves: *this account, through this wrapper, will not sign a payment the gate
 * did not approve*. An agent holding the same key and calling the unwrapped account is unaffected.
 */

import { hashTypedData } from "viem";
import { verifyReceipt, type JwkLike, type ReceiptLike } from "@paystage/receipt-verify";

/** EIP-3009 authorizations are the typed-data form of an x402 `exact` EVM payment. */
const PAYMENT_PRIMARY_TYPES = new Set(["TransferWithAuthorization", "ReceiveWithAuthorization"]);

export type SignerRefusalCode =
  | "do_not_pay"
  | "gate_unreachable"
  | "digest_mismatch"
  | "receipt_not_verified"
  | "review_refused"
  | "unsupported_typed_data"
  | "invalid_typed_data";

/**
 * A refusal, as an error rather than a return value. An adapter that returns `{ ok: false }` can be
 * ignored by a caller; one that throws cannot — and the signature is the thing at stake.
 */
export class SignerRefusedError extends Error {
  readonly code: SignerRefusalCode;
  /** The gate's own rule/reason string, when the refusal came from a `do_not_pay` verdict. */
  readonly rule?: string;
  /** Digest the receipt covered, for `digest_mismatch`. */
  readonly coveredDigest?: string;
  /** Digest the adapter was about to sign, for `digest_mismatch`. */
  readonly signingDigest?: string;

  constructor(
    code: SignerRefusalCode,
    message: string,
    detail: { rule?: string; coveredDigest?: string; signingDigest?: string } = {},
  ) {
    super(message);
    this.name = "SignerRefusedError";
    this.code = code;
    this.rule = detail.rule;
    this.coveredDigest = detail.coveredDigest;
    this.signingDigest = detail.signingDigest;
  }
}

/** The EIP-712 typed data viem hands to a signer. Structural on purpose: no `@x402/evm` import. */
export interface SignerTypedData {
  domain: {
    chainId?: number | string | bigint;
    verifyingContract?: string;
    [key: string]: unknown;
  };
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}

/**
 * The payment terms derived from the typed data. Every field is a string, so this object is safe to
 * put on the wire to a gate without a bigint serializer.
 */
export interface PaymentAuthorization {
  scheme: "exact";
  network: string;
  asset: string;
  payTo: string;
  from: string;
  /** Atomic units, decimal string. */
  amount: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

export interface SignerGateRequest {
  payment: PaymentAuthorization;
  /**
   * The EIP-712 digest of the typed data, lowercase 64-hex **without** `0x`. This is the exact
   * value the account's signature commits to. The gate must put it in the receipt's
   * `payment_digest` field, which the receipt signature then covers.
   */
  digest: string;
  signal: AbortSignal;
}

/**
 * A gate that returns a **signed** receipt bound to the request.
 *
 * The receipt's `payment_digest` must equal `request.digest`; its `payment` must match
 * `request.payment`. `request_sha256` keeps its existing meaning (the canonical evaluation
 * request) and is not overloaded here. A gate that returns an unsigned, differently-bound or
 * digest-less receipt is not an approval, and this adapter refuses rather than reading the
 * envelope's word for it.
 */
export interface SignerGateResponse {
  receipt: ReceiptLike;
}

export type SignerGate = (request: SignerGateRequest) => Promise<SignerGateResponse>;

export interface SignerGuardOptions {
  gate: SignerGate;
  /** How long the gate may take before the adapter fails closed. Default 5,000 ms. */
  timeoutMs?: number;
  /** The published PayStage receipt key. Omit to let `verifyReceipt` fetch the published JWKS. */
  jwk?: JwkLike;
  /** Override the JWKS URL used when `jwk` is omitted. */
  keyUrl?: string;
  /** Injected for offline tests. */
  fetchImpl?: typeof fetch;
  /** Injectable clock, for receipt-expiry tests. */
  now?: () => Date;
  /**
   * What to do with a `review` verdict. Default `"refuse"`: `review` is "a human should look",
   * which is not an approval to sign. A caller that has pre-arranged a step-up may opt into `"pay"`.
   */
  onReview?: "refuse" | "pay";
  /**
   * Sign typed data that is not an EIP-3009 authorization. Default `false` — the account this
   * wraps should be a **payment** account, and refusing the unknown case is the fail-closed choice.
   */
  allowNonPaymentSigning?: boolean;
  /** Called with every verified verdict, before the signature is produced or refused. */
  onVerdict?: (record: {
    verdict: "pay" | "review" | "do_not_pay";
    reasonCodes: string[];
    digest: string;
    payment: PaymentAuthorization;
    at: string;
  }) => void;
}

/** The minimum account surface: viem local accounts, smart-account session keys and test doubles. */
export interface TypedDataSigner {
  signTypedData(parameters: SignerTypedData): Promise<string>;
}

export function isPaymentTypedData(value: unknown): value is SignerTypedData {
  if (value === null || typeof value !== "object") return false;
  const candidate = value as { primaryType?: unknown };
  return typeof candidate.primaryType === "string" && PAYMENT_PRIMARY_TYPES.has(candidate.primaryType);
}

function invalid(field: string, detail: string): SignerRefusedError {
  return new SignerRefusedError(
    "invalid_typed_data",
    `PayStage signer refused: typed data field ${field} ${detail}`,
  );
}

function atomic(value: unknown, field: string): string {
  if (typeof value !== "bigint" && typeof value !== "string" && typeof value !== "number") {
    throw invalid(field, "is not an integer");
  }
  try {
    const parsed = BigInt(value as bigint | string | number);
    if (parsed < 0n) throw new Error("negative");
    return parsed.toString();
  } catch {
    throw invalid(field, `is not a non-negative integer (${JSON.stringify(String(value))})`);
  }
}

function address(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value)) {
    throw invalid(field, "is not a 20-byte hex address");
  }
  return value;
}

/**
 * Derive the payment terms from the typed data that is about to be signed.
 *
 * Amount and payee come from the EIP-3009 message, the asset from the EIP-712 verifying contract
 * and the network from the domain chain id. Nothing is read from a separate challenge object, so
 * these are the same bytes the signature will cover.
 */
export function paymentFromTypedData(typedData: SignerTypedData): PaymentAuthorization {
  if (!isPaymentTypedData(typedData)) {
    throw new SignerRefusedError(
      "unsupported_typed_data",
      `PayStage signer refused: primaryType ${JSON.stringify(
        (typedData as { primaryType?: unknown }).primaryType,
      )} is not an EIP-3009 payment authorization`,
    );
  }
  const domain = typedData.domain ?? {};
  const message = typedData.message ?? {};
  if (domain.chainId === undefined || domain.chainId === null) {
    throw invalid("domain.chainId", "is missing, so the network cannot be determined");
  }
  let network: string;
  try {
    network = `eip155:${BigInt(domain.chainId as bigint | string | number).toString()}`;
  } catch {
    throw invalid("domain.chainId", `is not a chain id (${JSON.stringify(String(domain.chainId))})`);
  }
  const nonce = message.nonce;
  if (typeof nonce !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(nonce)) {
    throw invalid("message.nonce", "is not a 32-byte hex nonce");
  }
  return {
    scheme: "exact",
    network,
    asset: address(domain.verifyingContract, "domain.verifyingContract"),
    payTo: address(message.to, "message.to"),
    from: address(message.from, "message.from"),
    amount: atomic(message.value, "message.value"),
    validAfter: atomic(message.validAfter, "message.validAfter"),
    validBefore: atomic(message.validBefore, "message.validBefore"),
    nonce,
  };
}

/** The exact EIP-712 digest the account signs, as lowercase 64-hex without `0x`. */
export function paymentDigest(typedData: SignerTypedData): string {
  try {
    return hashTypedData(typedData as never).slice(2).toLowerCase();
  } catch (error) {
    throw new SignerRefusedError(
      "invalid_typed_data",
      `PayStage signer refused: the typed data cannot be hashed — ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function normalizeDigest(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const hex = value.toLowerCase().replace(/^0x/, "");
  return /^[0-9a-f]{64}$/.test(hex) ? hex : null;
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function requestGate(
  gate: SignerGate,
  request: { payment: PaymentAuthorization; digest: string },
  timeoutMs: number,
): Promise<SignerGateResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await Promise.race([
      gate({ ...request, signal: controller.signal }),
      new Promise<never>((_resolve, reject) => {
        controller.signal.addEventListener(
          "abort",
          () => reject(new Error(`gate did not answer within ${timeoutMs}ms`)),
          { once: true },
        );
      }),
    ]);
    // A body we cannot read is a body that cannot approve anything. "Malformed" belongs with
    // "unreachable" because in both cases the adapter has no verdict, only bytes.
    if (
      response === null ||
      typeof response !== "object" ||
      (response as { receipt?: unknown }).receipt === null ||
      typeof (response as { receipt?: unknown }).receipt !== "object"
    ) {
      throw new Error("malformed response: expected { receipt }");
    }
    return response;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Wrap an account so every EIP-3009 `signTypedData` is gated, digest-bound and receipt-verified.
 *
 * Returns a shallow copy with `signTypedData` replaced; the original account is not mutated, so a
 * caller that keeps a reference to the raw account still has an ungated signer. That is deliberate:
 * this adapter protects the object it returns, and no more. Store only the guarded object.
 */
export function createSignerGuard<T extends TypedDataSigner>(
  account: T,
  options: SignerGuardOptions,
): T {
  if (account === null || typeof account !== "object" || typeof account.signTypedData !== "function") {
    throw new TypeError("@paystage/x402-guard/signer: account must expose signTypedData()");
  }
  if (typeof options?.gate !== "function") {
    throw new TypeError("@paystage/x402-guard/signer: options.gate is required");
  }
  const timeoutMs = options.timeoutMs ?? 5_000;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError("@paystage/x402-guard/signer: timeoutMs must be a positive number");
  }
  const onReview = options.onReview ?? "refuse";
  const original = account.signTypedData.bind(account);

  const guarded = async (typedData: SignerTypedData): Promise<string> => {
    if (!isPaymentTypedData(typedData)) {
      if (options.allowNonPaymentSigning === true) return original(typedData);
      throw new SignerRefusedError(
        "unsupported_typed_data",
        `PayStage signer refused: primaryType ${JSON.stringify(
          (typedData as { primaryType?: unknown } | null)?.primaryType,
        )} is not an EIP-3009 payment authorization`,
      );
    }

    const payment = paymentFromTypedData(typedData);
    // Hash the same object that will be passed to the account. If the amount, payee, nonce or
    // domain changes after approval, this digest changes with it and the receipt no longer matches.
    const digest = paymentDigest(typedData);

    let response: SignerGateResponse;
    try {
      response = await requestGate(options.gate, { payment, digest }, timeoutMs);
    } catch (error) {
      // Fail closed, and this is deliberately the opposite of the telemetry rule in `index.ts`.
      // Telemetry is a *label*: a missing label is not a missing verdict, so a failed POST is
      // swallowed and the payment proceeds. This is the *verdict* itself. Without it there is no
      // approval to enforce, and "unknown" must never be read as "pay". A gate you cannot reach
      // is not an approval.
      throw new SignerRefusedError(
        "gate_unreachable",
        `PayStage signer refused: gate unreachable (${reasonOf(
          error,
        )}) — a gate you cannot reach is not an approval`,
      );
    }

    const receipt = response.receipt;
    let verification: Awaited<ReturnType<typeof verifyReceipt>>;
    try {
      verification = await verifyReceipt(receipt, {
        jwk: options.jwk,
        keyUrl: options.keyUrl,
        fetchImpl: options.fetchImpl,
        now: options.now?.(),
      });
    } catch (error) {
      throw new SignerRefusedError(
        "receipt_not_verified",
        `PayStage signer refused: the gate receipt could not be verified (${reasonOf(error)})`,
      );
    }
    if (!verification.ok) {
      throw new SignerRefusedError(
        "receipt_not_verified",
        `PayStage signer refused: the gate receipt is not a verified verdict (${verification.status}: ${verification.reason})`,
      );
    }

    // Verify the signature first, then the binding: a forged receipt must not be able to reach the
    // digest comparison and have its claim quoted back as if it were a real verdict.
    const covered = normalizeDigest(receipt.payment_digest);
    if (covered !== digest) {
      throw new SignerRefusedError(
        "digest_mismatch",
        `PayStage signer refused: digest mismatch — verdict covers ${covered ?? "no digest"}, signing ${digest}`,
        { coveredDigest: covered ?? undefined, signingDigest: digest },
      );
    }

    // The digest is the strong binding, but a receipt whose own `payment` block contradicts the
    // typed data it claims to cover is malformed, not an approval. Check it after the digest so a
    // genuinely swapped challenge is reported as the digest mismatch it is.
    const bound = receipt.payment;
    const mismatched = (["scheme", "network", "asset", "amount", "payee"] as const).filter(
      (field) => {
        const wanted =
          field === "payee"
            ? payment.payTo
            : field === "scheme"
              ? payment.scheme
              : payment[field];
        return bound === undefined || String(bound[field]) !== String(wanted);
      },
    );
    if (mismatched.length > 0) {
      throw new SignerRefusedError(
        "receipt_not_verified",
        `PayStage signer refused: the verified receipt covers a different payment (${mismatched.join(
          ", ",
        )})`,
      );
    }

    const decision = receipt.verdict?.decision;
    const reasons = Array.isArray(receipt.verdict?.reasons) ? receipt.verdict.reasons : [];
    const reasonCodes = reasons.filter(
      (reason): reason is string => typeof reason === "string" && reason.trim() !== "",
    );
    const rule = reasonCodes[0];

    const announce = (verdict: "pay" | "review" | "do_not_pay") => {
      try {
        options.onVerdict?.({
          verdict,
          reasonCodes,
          digest,
          payment,
          at: new Date().toISOString(),
        });
      } catch {
        // A caller's logger must never change whether a payment is allowed.
      }
    };

    if (decision === "pay") {
      announce("pay");
      return original(typedData);
    }
    if (decision === "review" && onReview === "pay") {
      announce("review");
      return original(typedData);
    }
    if (decision === "do_not_pay") {
      announce("do_not_pay");
      throw new SignerRefusedError(
        "do_not_pay",
        // The rule is part of the refusal, not an extra: "refused" tells a caller nothing about
        // which cap, payee or sanction produced it.
        `PayStage signer refused: do_not_pay (rule: ${
          rule ?? "unspecified — the gate returned do_not_pay with no reason"
        })`,
        { rule },
      );
    }
    if (decision === "review") {
      announce("review");
      throw new SignerRefusedError(
        "review_refused",
        `PayStage signer refused: review (rule: ${
          rule ?? "unspecified — the gate returned review with no reason"
        }) — a review is not an approval`,
        { rule },
      );
    }
    throw new SignerRefusedError(
      "receipt_not_verified",
      `PayStage signer refused: the verified receipt carries no recognised verdict (${JSON.stringify(decision)})`,
    );
  };

  return { ...account, signTypedData: guarded as unknown as T["signTypedData"] };
}

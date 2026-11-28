/**
 * PayStage's own x402 facilitator (exact / EIP-3009 + Permit2 on Base).
 *
 * ## What the package actually gives us
 *
 * `@x402/core/facilitator` exports the facilitator contract: `x402Facilitator` plus the
 * `SchemeNetworkFacilitator` interface (`scheme`, `caipFamily`, `getExtra`, `getSigners`,
 * `verify`, `settle`). `@x402/evm/exact/facilitator` exports `ExactEvmScheme`, an
 * implementation of that interface which does the EIP-712 recovery and broadcasts
 * `transferWithAuthorization` through a `FacilitatorEvmSigner` (`@x402/evm`).
 *
 * There is **no** export that turns that in-process facilitator into an HTTP server, and no
 * `FacilitatorClient` that calls one. The package's HTTP side is client-only
 * (`HTTPFacilitatorClient` in `@x402/core/server` expects a remote `/verify`, `/settle`,
 * `/supported`). So this module supplies both halves:
 *
 *   - `SelfFacilitatorClient implements FacilitatorClient` — the local, in-process client the
 *     resource server consumes (`buildPaymentMiddleware` takes a client, not a URL);
 *   - `createFacilitatorRoutes` in `routes/facilitator.ts` — the two v2 HTTP endpoints.
 *
 * Both are backed by the same `x402Facilitator`, so a payment settled through our route and a
 * payment settled through the public endpoint use one code path and one gas wallet.
 *
 * ## Why our own verification runs first
 *
 * `ExactEvmScheme` returns its own reason vocabulary (`invalid_exact_evm_signature`, ...).
 * The public contract for *this* facilitator is the smaller, stable set named in
 * `FacilitatorReason`: wrong network, wrong payee, expired, insufficient, bad signature. We
 * do the cheap checks ourselves so the reason is deterministic and does not depend on which
 * branch of the scheme fired first, then map the scheme's answer onto the same vocabulary.
 * The scheme is still the thing that performs signature recovery and the on-chain checks; we
 * never accept a payment on our own say-so.
 *
 * ## Secrets
 *
 * A private key only ever enters through `signerFromPrivateKey` (called with the Worker secret
 * `FACILITATOR_GAS_PRIVATE_KEY`). It is not stored on this module, not returned in a response,
 * and not included in an error message. The gas wallet holds gas only; customer USDC never
 * touches it.
 */
import { x402Facilitator } from "@x402/core/facilitator";
import type { FacilitatorClient } from "@x402/core/server";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import { ExactEvmScheme } from "@x402/evm/exact/facilitator";
import type { FacilitatorEvmSigner } from "@x402/evm";
import { createPublicClient, createWalletClient, http } from "viem";
import { base, baseSepolia } from "viem/chains";
import { privateKeyToAccount } from "viem/accounts";
import type { Chain } from "viem";

/** The stable rejection vocabulary this facilitator publishes. */
export type FacilitatorReason =
  | "invalid_signature"
  | "expired"
  | "not_yet_valid"
  | "insufficient"
  | "wrong_amount"
  | "wrong_network"
  | "wrong_payee"
  | "wrong_asset"
  | "invalid_payload"
  | "unsupported_payload_type"
  | "already_used"
  | "settlement_failed";

export interface SelfFacilitatorPolicy {
  /** Only this payee is settled, so the gas wallet cannot be spent on someone else's route. */
  payTo: string;
  /** Only this CAIP-2 network is settled. */
  network: string;
  /** Only this token is settled, when set (Base USDC in production). */
  asset?: string;
  /** Reject anything below the route price; protects the gas wallet from dust payments. */
  minimumAmount?: string;
}

export interface SelfFacilitatorOptions {
  signer: FacilitatorEvmSigner;
  policy: SelfFacilitatorPolicy;
  /** Receipt for a repeat of a settled payment id, in milliseconds. Defaults to 24h. */
  idempotencyTtlMs?: number;
  now?: () => number;
}

interface Eip3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

interface Permit2Authorization {
  from: string;
  deadline: string;
  permitted: { token: string; amount: string };
  witness: { to: string; validAfter: string };
}

interface ExtractedPayment {
  payer: string;
  payTo: string;
  amount: string;
  /** Unix seconds at which the authorization stops being valid. */
  expiry: string;
  /** Unix seconds before which it is not valid; "0" for EIP-3009. */
  notBefore: string;
  kind: "eip3009" | "permit2";
}

interface LedgerEntry {
  at: number;
  response: SettleResponse;
}

/** Exact-scheme reasons mapped onto our published vocabulary. */
const REASON_MAP: Record<string, FacilitatorReason> = {
  invalid_exact_evm_network_mismatch: "wrong_network",
  invalid_exact_evm_recipient_mismatch: "wrong_payee",
  invalid_exact_evm_signature: "invalid_signature",
  invalid_exact_evm_non_canonical_signature: "invalid_signature",
  invalid_exact_evm_failed_to_verify_signature: "invalid_signature",
  invalid_exact_evm_failed_to_parse_signature: "invalid_signature",
  invalid_exact_evm_payload_authorization_valid_before: "expired",
  invalid_exact_evm_payload_authorization_valid_after: "not_yet_valid",
  invalid_exact_evm_payload_authorization_value_mismatch: "wrong_amount",
  invalid_exact_evm_insufficient_balance: "insufficient",
  invalid_exact_evm_nonce_already_used: "already_used",
  permit2_deadline_expired: "expired",
  permit2_not_yet_valid: "not_yet_valid",
  permit2_amount_mismatch: "wrong_amount",
  permit2_token_mismatch: "wrong_asset",
  permit2_insufficient_balance: "insufficient",
  invalid_permit2_signature: "invalid_signature",
  invalid_permit2_recipient_mismatch: "wrong_payee",
  invalid_permit2_spender: "wrong_payee",
  unsupported_payload_type: "unsupported_payload_type",
  invalid_payload: "invalid_payload",
  settlement_pending: "settlement_failed",
  invalid_exact_evm_transaction_failed: "settlement_failed",
  invalid_exact_evm_transaction_simulation_failed: "settlement_failed",
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBigIntString(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  try {
    BigInt(value);
    return true;
  } catch {
    return false;
  }
}

function isAddressLike(value: unknown): value is string {
  return typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value);
}

function sameAddress(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

function eip3009Authorization(payload: PaymentPayload): Eip3009Authorization | null {
  if (!isObject(payload.payload)) return null;
  const auth = payload.payload.authorization;
  if (!isObject(auth)) return null;
  if (
    !isAddressLike(auth.from) ||
    !isAddressLike(auth.to) ||
    !isBigIntString(auth.value) ||
    !isBigIntString(auth.validAfter) ||
    !isBigIntString(auth.validBefore) ||
    typeof auth.nonce !== "string"
  ) {
    return null;
  }
  return {
    from: auth.from,
    to: auth.to,
    value: auth.value,
    validAfter: auth.validAfter,
    validBefore: auth.validBefore,
    nonce: auth.nonce,
  };
}

function permit2Authorization(payload: PaymentPayload): Permit2Authorization | null {
  if (!isObject(payload.payload)) return null;
  const auth = payload.payload.permit2Authorization;
  if (!isObject(auth)) return null;
  const permitted = auth.permitted;
  const witness = auth.witness;
  if (!isObject(permitted) || !isObject(witness)) return null;
  if (
    !isAddressLike(auth.from) ||
    !isBigIntString(auth.deadline) ||
    !isAddressLike(permitted.token) ||
    !isBigIntString(permitted.amount) ||
    !isAddressLike(witness.to) ||
    !isBigIntString(witness.validAfter)
  ) {
    return null;
  }
  return {
    from: auth.from,
    deadline: auth.deadline,
    permitted: { token: permitted.token, amount: permitted.amount },
    witness: { to: witness.to, validAfter: witness.validAfter },
  };
}

function extractPayment(payload: PaymentPayload): ExtractedPayment | null {
  const eip3009 = eip3009Authorization(payload);
  if (eip3009) {
    return {
      payer: eip3009.from,
      payTo: eip3009.to,
      amount: eip3009.value,
      expiry: eip3009.validBefore,
      notBefore: eip3009.validAfter,
      kind: "eip3009",
    };
  }
  const permit2 = permit2Authorization(payload);
  if (permit2) {
    return {
      payer: permit2.from,
      payTo: permit2.witness.to,
      amount: permit2.permitted.amount,
      expiry: permit2.deadline,
      notBefore: permit2.witness.validAfter,
      kind: "permit2",
    };
  }
  return null;
}

/**
 * `payment-identifier` is read from the payload's extension slot. It is optional: a client
 * that does not send one is settled normally, and the signature is used as the dedup key.
 */
export function paymentIdentifier(payload: PaymentPayload): string | null {
  const ext = payload.extensions?.["payment-identifier"];
  if (!isObject(ext) || !isObject(ext.info)) return null;
  const id = ext.info.id;
  if (typeof id !== "string" || id.length === 0 || id.length > 128) return null;
  return id;
}

function paymentSignature(payload: PaymentPayload): string | null {
  if (!isObject(payload.payload)) return null;
  const sig = payload.payload.signature;
  return typeof sig === "string" && sig.length > 0 ? sig : null;
}

/** The in-process facilitator client, plus the state that makes settlement idempotent. */
export class SelfFacilitatorClient implements FacilitatorClient {
  readonly facilitator: x402Facilitator;
  private readonly options: SelfFacilitatorOptions;
  private readonly settled = new Map<string, LedgerEntry>();
  private readonly inFlight = new Map<string, Promise<SettleResponse>>();
  private readonly ttlMs: number;
  private readonly now: () => number;

  constructor(options: SelfFacilitatorOptions) {
    this.options = options;
    this.ttlMs = options.idempotencyTtlMs ?? 24 * 60 * 60 * 1000;
    this.now = options.now ?? (() => Date.now());
    this.facilitator = new x402Facilitator().register(
      options.policy.network as `${string}:${string}`,
      new ExactEvmScheme(options.signer),
    );
  }

  getSupported(): Promise<SupportedResponse> {
    return Promise.resolve(this.facilitator.getSupported() as SupportedResponse);
  }

  async verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    const rejection = this.precheck(paymentPayload, paymentRequirements);
    if (rejection) return rejection;

    let result: VerifyResponse;
    try {
      result = await this.facilitator.verify(paymentPayload, paymentRequirements);
    } catch (error) {
      // A throwing scheme is an upstream fault, not a payment verdict; report it as invalid
      // rather than letting the caller see an RPC stack trace (which can carry a URL).
      return {
        isValid: false,
        invalidReason: "invalid_payload",
        payer: extractPayment(paymentPayload)?.payer,
      };
    }

    if (result.isValid) {
      return {
        isValid: true,
        payer: result.payer ?? extractPayment(paymentPayload)?.payer,
      };
    }

    return {
      isValid: false,
      invalidReason: normaliseReason(result.invalidReason ?? "invalid_payload"),
      payer: result.payer ?? extractPayment(paymentPayload)?.payer,
    };
  }

  async settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettleResponse> {
    const rejection = this.precheck(paymentPayload, paymentRequirements);
    if (rejection) {
      return {
        success: false,
        errorReason: rejection.invalidReason,
        transaction: "",
        network: paymentRequirements.network,
        payer: rejection.payer,
      };
    }

    const key = this.idempotencyKey(paymentPayload);
    if (key) {
      const cached = this.cached(key);
      if (cached) return cached;
      const pending = this.inFlight.get(key);
      if (pending) return pending;
    }

    const run = (async (): Promise<SettleResponse> => {
      let result: SettleResponse;
      try {
        result = await this.facilitator.settle(paymentPayload, paymentRequirements);
      } catch (error) {
        // Never surface the underlying error: a transport error can contain a provider URL.
        result = {
          success: false,
          errorReason: "settlement_failed",
          transaction: "",
          network: paymentRequirements.network,
          payer: extractPayment(paymentPayload)?.payer,
        };
      }

      const normalised: SettleResponse = {
        success: result.success === true,
        transaction: typeof result.transaction === "string" ? result.transaction : "",
        network: result.network ?? paymentRequirements.network,
        payer: result.payer ?? extractPayment(paymentPayload)?.payer,
        ...(result.success === true
          ? {}
          : { errorReason: normaliseReason(result.errorReason ?? "settlement_failed") }),
      };

      // Cache anything that produced a transaction, including a pending broadcast: a retry
      // must reconcile the first hash, never send a second transaction.
      if (key && (normalised.success || normalised.transaction.length > 0)) {
        this.settled.set(key, { at: this.now(), response: normalised });
      }
      return normalised;
    })();

    if (key) {
      this.inFlight.set(key, run);
      try {
        return await run;
      } finally {
        this.inFlight.delete(key);
      }
    }
    return run;
  }

  /** Clears the idempotency ledger. Tests only; a live isolate keeps it. */
  reset(): void {
    this.settled.clear();
    this.inFlight.clear();
  }

  private idempotencyKey(payload: PaymentPayload): string | null {
    const id = paymentIdentifier(payload);
    if (id) return `id:${id}`;
    const signature = paymentSignature(payload);
    return signature ? `sig:${signature}` : null;
  }

  private cached(key: string): SettleResponse | null {
    const entry = this.settled.get(key);
    if (!entry) return null;
    if (this.now() - entry.at > this.ttlMs) {
      this.settled.delete(key);
      return null;
    }
    return { ...entry.response };
  }

  /**
   * Cheap, deterministic checks before the scheme runs.
   *
   * They intentionally do not verify the signature: that is the scheme's job. Their purpose
   * is to make the published reason vocabulary stable and to keep the gas wallet from being
   * pointed at another seller's payee or another token.
   */
  private precheck(
    payload: PaymentPayload,
    requirements: PaymentRequirements,
  ): VerifyResponse | null {
    const payment = extractPayment(payload);
    if (!payment) {
      return { isValid: false, invalidReason: "invalid_payload" };
    }

    if (requirements.scheme !== "exact") {
      return { isValid: false, invalidReason: "invalid_payload", payer: payment.payer };
    }

    if (
      requirements.network !== this.options.policy.network ||
      payload.accepted?.network !== requirements.network
    ) {
      return { isValid: false, invalidReason: "wrong_network", payer: payment.payer };
    }

    if (!sameAddress(requirements.payTo, this.options.policy.payTo)) {
      return { isValid: false, invalidReason: "wrong_payee", payer: payment.payer };
    }

    if (!sameAddress(payment.payTo, requirements.payTo)) {
      return { isValid: false, invalidReason: "wrong_payee", payer: payment.payer };
    }

    const asset = this.options.policy.asset;
    if (asset && !sameAddress(requirements.asset, asset)) {
      return { isValid: false, invalidReason: "wrong_asset", payer: payment.payer };
    }
    if (payment.kind === "permit2") {
      const permit2 = permit2Authorization(payload);
      if (permit2 && !sameAddress(permit2.permitted.token, requirements.asset)) {
        return { isValid: false, invalidReason: "wrong_asset", payer: payment.payer };
      }
    }

    const now = Math.floor(this.now() / 1000);
    let expiry: bigint;
    let notBefore: bigint;
    let required: bigint;
    let value: bigint;
    try {
      expiry = BigInt(payment.expiry);
      notBefore = BigInt(payment.notBefore);
      required = BigInt(requirements.amount);
      value = BigInt(payment.amount);
      if (this.options.policy.minimumAmount !== undefined) {
        if (required < BigInt(this.options.policy.minimumAmount)) {
          return { isValid: false, invalidReason: "insufficient", payer: payment.payer };
        }
      }
    } catch {
      return { isValid: false, invalidReason: "invalid_payload", payer: payment.payer };
    }

    // The exact scheme requires six seconds of headroom on validBefore. Matching that here
    // means a payment that expires during verification is reported as expired, not as a
    // signature failure later in the scheme.
    if (expiry < BigInt(now + 6)) {
      return { isValid: false, invalidReason: "expired", payer: payment.payer };
    }
    if (notBefore > BigInt(now)) {
      return { isValid: false, invalidReason: "not_yet_valid", payer: payment.payer };
    }

    if (value !== required) {
      return {
        isValid: false,
        invalidReason: value < required ? "insufficient" : "wrong_amount",
        payer: payment.payer,
      };
    }

    return null;
  }
}

function normaliseReason(reason: string): FacilitatorReason {
  return REASON_MAP[reason] ?? "invalid_payload";
}

/**
 * Builds the gas-wallet signer from a private key. The key never leaves this function and is
 * never attached to the returned signer object.
 */
export function signerFromPrivateKey(privateKey: string, network: string): FacilitatorEvmSigner {
  const key = privateKey.trim().startsWith("0x") ? privateKey.trim() : `0x${privateKey.trim()}`;
  const account = privateKeyToAccount(key as `0x${string}`);
  const chain = chainForNetwork(network);
  const transport = http();
  const publicClient = createPublicClient({ chain, transport });
  const walletClient = createWalletClient({ account, chain, transport });

  return {
    getAddresses: () => [account.address],
    readContract: (args) => publicClient.readContract(args as never) as Promise<unknown>,
    verifyTypedData: (args) => publicClient.verifyTypedData(args as never),
    writeContract: (args) => walletClient.writeContract(args as never),
    sendTransaction: (args) => walletClient.sendTransaction(args as never),
    waitForTransactionReceipt: async (args) => {
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: args.hash,
        ...(args.timeout !== undefined ? { timeout: args.timeout } : {}),
      });
      return { status: receipt.status, logs: receipt.logs };
    },
    getCode: (args) => publicClient.getCode(args),
  };
}

export function chainForNetwork(network: string): Chain {
  if (network === "eip155:8453") return base;
  if (network === "eip155:84532") return baseSepolia;
  throw new Error(`self-facilitator: unsupported network ${network}`);
}

/**
 * Converts the route's price (`"$0.002"` / `"0.002"`) to six-decimal atomic units. Returns
 * `"0"` for a price it cannot parse, which disables the minimum rather than rejecting every
 * payment with a wrong threshold.
 */
export function usdToAtomic(price: string): string {
  const match = /^\$?([0-9]+)(?:\.([0-9]{1,6}))?$/.exec(price.trim());
  if (!match) return "0";
  const whole = BigInt(match[1] ?? "0");
  const fraction = (match[2] ?? "").padEnd(6, "0").slice(0, 6);
  return (whole * 1_000_000n + BigInt(fraction || "0")).toString();
}

/** Base USDC addresses used to pin the asset when the caller does not supply one. */
export const USDC_BY_NETWORK: Record<string, string> = {
  "eip155:8453": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
};

export function createSelfFacilitator(options: SelfFacilitatorOptions): SelfFacilitatorClient {
  return new SelfFacilitatorClient(options);
}

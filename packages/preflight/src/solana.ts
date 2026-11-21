/**
 * The Solana (SVM) requirement checks, and the optional `@x402/svm` peer that owns them.
 *
 * `@paystage/preflight` answers for a *challenge* (`payment_required`), not for a signed
 * transaction. The checks here are therefore the ones `@x402/svm` makes on the requirements
 * before it builds a payload — not the facilitator's checks on a submitted transaction.
 * Every rule below maps to code in `@x402/svm@2.32.0`:
 *
 *   1. `solana.network`  — `normalizeNetwork()` accepts only the three SVM CAIP-2 ids
 *                          (`dist/esm/chunk-DAIKIZVB.mjs`, `Unsupported SVM network`).
 *   2. `solana.asset`    — the mint is a 32-byte base58 address: `validateSvmAddress()` is
 *                          `SVM_ADDRESS_REGEX.test(address) && isAddress(address)`
 *                          (`dist/esm/chunk-DAIKIZVB.mjs`), and the mint is used directly by
 *                          `findAssociatedTokenPda()` / `getTransferCheckedInstruction()`
 *                          (`dist/esm/exact/client/index.mjs`, `ExactSvmScheme.createPaymentPayload`).
 *   3. `solana.payee`    — `payTo` is the ATA owner in the same `findAssociatedTokenPda()` call,
 *                          so it must be a 32-byte base58 address too.
 *   4. `solana.amount`   — `BigInt(paymentRequirements.amount)` feeds the transfer amount, and
 *                          SPL Token's `TransferChecked` carries a u64
 *                          (`dist/esm/exact/client/index.mjs`, same method).
 *
 * The package we read also checks `extra.feePayer`, transaction version and memo length before
 * signing. Those are not among the four requirement assertions above, and the 2026-11-19
 * inventory does not carry them, so this module does not invent a verdict from them.
 *
 * `@x402/svm` is an **optional peer**: when a caller installs it, the two exported helpers are
 * used directly; when it is absent the identical rules run against the built-in copy below and
 * the evaluator's transcript records that the peer was absent. The gate never fails open: the
 * four assertions always run either way.
 */

export const SVM_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SVM_DEVNET_CAIP2 = "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1";
export const SVM_TESTNET_CAIP2 = "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z";

/** The three networks `normalizeNetwork()` accepts, in its order. */
export const SUPPORTED_SVM_NETWORKS = [
  SVM_MAINNET_CAIP2,
  SVM_DEVNET_CAIP2,
  SVM_TESTNET_CAIP2,
] as const;

/** The wildcard `@x402/svm` registers for v2 clients. */
export const SVM_WILDCARD = "solana:*";

const SVM_ADDRESS_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
const BASE58_INDEX = new Map<string, number>(
  [...BASE58_ALPHABET].map((char, index) => [char, index]),
);

/**
 * Decode-length check matching `isAddress()`: the base58 text must decode to exactly 32 bytes.
 *
 * Implemented locally rather than with a dependency so the evaluator stays dependency-free
 * when the optional peer is absent. Leading `1`s are leading zero bytes and are counted.
 */
function decodesTo32Bytes(address: string): boolean {
  if (!SVM_ADDRESS_RE.test(address)) return false;
  let leadingZeros = 0;
  while (leadingZeros < address.length && address[leadingZeros] === "1") leadingZeros += 1;
  const bytes: number[] = [];
  for (const char of address) {
    const value = BASE58_INDEX.get(char);
    if (value === undefined) return false;
    let carry = value;
    for (let i = 0; i < bytes.length; i += 1) {
      const next = bytes[i] * 58 + carry;
      bytes[i] = next & 0xff;
      carry = next >> 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  return leadingZeros + bytes.length === 32;
}

/** The shape of the two `@x402/svm` exports this gate calls. Structural, not a hard dependency. */
export interface SvmValidationPeer {
  normalizeNetwork(network: string): string;
  validateSvmAddress(address: string): boolean;
}

const SVM_PEER_SPECIFIER = "@x402/svm";

let cachedPeer: SvmValidationPeer | null = null;
let peerLoad: Promise<SvmValidationPeer | null> | undefined;

function pickPeer(module: unknown): SvmValidationPeer | null {
  const candidate = module as Partial<SvmValidationPeer> | null | undefined;
  if (
    candidate &&
    typeof candidate.normalizeNetwork === "function" &&
    typeof candidate.validateSvmAddress === "function"
  ) {
    return candidate as SvmValidationPeer;
  }
  return null;
}

/**
 * Try to load the optional peer once. Returns `null` when it is not installed.
 *
 * The evaluator itself is synchronous, so a host that wants the peer's own checks calls this
 * once at start-up. Without that call the built-in copy runs and the transcript says so.
 */
export function loadSvmPeer(): Promise<SvmValidationPeer | null> {
  if (peerLoad === undefined) {
    peerLoad = (async () => {
      try {
        // A variable specifier keeps the module optional: TypeScript must not require the
        // package to exist at build time, and a missing install is a catchable error here.
        const specifier: string = SVM_PEER_SPECIFIER;
        const module: unknown = await import(specifier);
        cachedPeer = pickPeer(module);
        return cachedPeer;
      } catch {
        cachedPeer = null;
        return null;
      }
    })();
  }
  return peerLoad;
}

/** The peer loaded by `loadSvmPeer()`, or one injected by a test/host. */
export function currentSvmPeer(): SvmValidationPeer | null {
  return cachedPeer;
}

/** Test/host seam. Pass `null` to model "the optional peer is absent". */
export function setSvmPeer(peer: SvmValidationPeer | null): void {
  cachedPeer = peer;
  peerLoad = Promise.resolve(peer);
}

/** Test hook: forget both a loaded and an injected peer. */
export function resetSvmPeer(): void {
  cachedPeer = null;
  peerLoad = undefined;
}

export function isSolanaNetwork(network: string): boolean {
  return network.startsWith("solana:");
}

export interface SolanaAssertion {
  rule: "solana.network" | "solana.asset" | "solana.payee" | "solana.amount";
  detail: string;
}

export type SolanaValidation =
  | { ok: true; assertions: SolanaAssertion[]; usedPeer: boolean }
  | { ok: false; rule: SolanaAssertion["rule"]; reason: string; assertions: SolanaAssertion[]; usedPeer: boolean };

function assertion(
  rule: SolanaAssertion["rule"],
  detail: string,
): SolanaAssertion {
  return { rule, detail };
}

/**
 * Run the four SVM requirement assertions in `@x402/svm`'s order.
 *
 * `peer` is the optional package's exports when installed. `null` runs the built-in copies
 * and the caller records the absence in the transcript.
 */
export function validateSolanaAccept(
  accept: { network: string; asset: string; payTo: string; amount: string },
  peer: SvmValidationPeer | null,
): SolanaValidation {
  const assertions: SolanaAssertion[] = [];
  const usedPeer = peer !== null;

  // 1. normalizeNetwork(): only the three CAIP-2 SVM ids reach the RPC client.
  if (peer) {
    try {
      const normalized = peer.normalizeNetwork(accept.network);
      assertions.push(
        assertion(
          "solana.network",
          `network ${accept.network} is a supported SVM network (@x402/svm normalizeNetwork → ${normalized})`,
        ),
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ok: false,
        rule: "solana.network",
        reason: `unsupported SVM network ${accept.network}: ${message}`,
        assertions,
        usedPeer,
      };
    }
  } else if ((SUPPORTED_SVM_NETWORKS as readonly string[]).includes(accept.network)) {
    assertions.push(
      assertion(
        "solana.network",
        `network ${accept.network} is one of the three SVM CAIP-2 networks @x402/svm supports`,
      ),
    );
  } else {
    return {
      ok: false,
      rule: "solana.network",
      reason: `unsupported SVM network ${accept.network}: @x402/svm accepts only ${SUPPORTED_SVM_NETWORKS.join(", ")}`,
      assertions,
      usedPeer,
    };
  }

  // 2. The mint: validateSvmAddress() and then used by findAssociatedTokenPda().
  const assetValid = peer ? peer.validateSvmAddress(accept.asset) : decodesTo32Bytes(accept.asset);
  if (!assetValid) {
    return {
      ok: false,
      rule: "solana.asset",
      reason: `invalid Solana asset ${accept.asset}: @x402/svm requires a base58 address that decodes to 32 bytes`,
      assertions,
      usedPeer,
    };
  }
  assertions.push(
    assertion(
      "solana.asset",
      `asset ${accept.asset} is a valid 32-byte base58 Solana address (mint)`,
    ),
  );

  // 3. payTo: the ATA owner in findAssociatedTokenPda().
  const payeeValid = peer ? peer.validateSvmAddress(accept.payTo) : decodesTo32Bytes(accept.payTo);
  if (!payeeValid) {
    return {
      ok: false,
      rule: "solana.payee",
      reason: `invalid Solana payTo ${accept.payTo}: @x402/svm requires a base58 address that decodes to 32 bytes`,
      assertions,
      usedPeer,
    };
  }
  assertions.push(
    assertion(
      "solana.payee",
      `payTo ${accept.payTo} is a valid 32-byte base58 Solana address`,
    ),
  );

  // 4. amount: BigInt() feeds the u64 TransferChecked amount.
  if (!/^\d+$/.test(accept.amount)) {
    return {
      ok: false,
      rule: "solana.amount",
      reason: `invalid Solana atomic amount ${accept.amount}: @x402/svm parses it with BigInt and the transfer instruction carries an unsigned integer`,
      assertions,
      usedPeer,
    };
  }
  const amount = BigInt(accept.amount);
  const maxU64 = (1n << 64n) - 1n;
  if (amount > maxU64) {
    return {
      ok: false,
      rule: "solana.amount",
      reason: `invalid Solana atomic amount ${accept.amount}: exceeds the SPL Token u64 range (max ${maxU64})`,
      assertions,
      usedPeer,
    };
  }
  assertions.push(
    assertion(
      "solana.amount",
      `amount ${accept.amount} is an unsigned integer inside the SPL Token u64 range`,
    ),
  );

  return { ok: true, assertions, usedPeer };
}

/** Detail recorded when the optional peer is not installed, so the verdict never implies it was. */
export const SVM_PEER_ABSENT_DETAIL =
  "@x402/svm is not installed (optional peer); the four SVM assertions ran against the built-in copy of its network table and address check";

/** Detail recorded when the peer's own exports were used. */
export const SVM_PEER_PRESENT_DETAIL =
  "the four SVM assertions ran against @x402/svm's own normalizeNetwork() and validateSvmAddress() exports";

import { recoverMessageAddress, getAddress } from "viem";

export interface ParsedSiweMessage {
  domain: string;
  address: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: Date;
  expirationTime?: Date;
  statement?: string;
}

export interface ValidateOptions {
  expectedDomain: string;
  expectedNonce: string;
  expectedChainId: number;
  now?: Date;
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const NONCE_RE = /^[A-Za-z0-9]{8,}$/;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const FIELD_RE = /^([A-Za-z][A-Za-z ]*): (.+)$/;

export function parseSiweMessage(message: string): ParsedSiweMessage {
  if (typeof message !== "string" || message.length === 0) {
    throw new Error("SIWE message is empty");
  }
  const lines = message.split("\n");
  if (lines.length < 6) throw new Error("SIWE message has too few lines");

  const headerMatch =
    /^(\S+) wants you to sign in with your Ethereum account:$/.exec(lines[0]!);
  if (!headerMatch) throw new Error("SIWE message has invalid header line");
  const domain = headerMatch[1]!;

  const addressLine = lines[1]!;
  if (!ADDRESS_RE.test(addressLine)) throw new Error("SIWE message has invalid address line");
  const address = addressLine;

  let idx = 2;
  if (lines[idx] !== "") throw new Error("SIWE message missing blank line after address");
  idx++;

  let statement: string | undefined;
  if (
    idx < lines.length &&
    lines[idx] !== "" &&
    !FIELD_RE.test(lines[idx]!)
  ) {
    statement = lines[idx];
    idx++;
    if (lines[idx] !== "") throw new Error("SIWE message missing blank line after statement");
    idx++;
  }

  const fields: Record<string, string> = {};
  const knownKeys = new Set([
    "URI",
    "Version",
    "Chain ID",
    "Nonce",
    "Issued At",
    "Expiration Time",
  ]);
  for (; idx < lines.length; idx++) {
    const line = lines[idx]!;
    if (line === "") continue;
    const m = FIELD_RE.exec(line);
    if (!m) throw new Error(`SIWE message has invalid field line: ${line}`);
    const key = m[1]!;
    if (!knownKeys.has(key)) throw new Error(`SIWE message has unknown field: ${key}`);
    if (fields[key] !== undefined) throw new Error(`SIWE message has duplicate field: ${key}`);
    fields[key] = m[2]!;
  }

  const uri = fields["URI"];
  const version = fields["Version"];
  const chainIdStr = fields["Chain ID"];
  const nonce = fields["Nonce"];
  const issuedAtStr = fields["Issued At"];
  const expirationStr = fields["Expiration Time"];

  if (!uri) throw new Error("SIWE message missing URI");
  if (!version) throw new Error("SIWE message missing Version");
  if (!chainIdStr) throw new Error("SIWE message missing Chain ID");
  if (!nonce) throw new Error("SIWE message missing Nonce");
  if (!issuedAtStr) throw new Error("SIWE message missing Issued At");

  if (version !== "1") throw new Error("SIWE message unsupported version");
  if (!NONCE_RE.test(nonce)) throw new Error("SIWE message invalid nonce");
  if (!/^\d+$/.test(chainIdStr)) throw new Error("SIWE message invalid Chain ID");
  const chainId = Number(chainIdStr);
  if (!Number.isSafeInteger(chainId) || chainId <= 0) {
    throw new Error("SIWE message invalid Chain ID");
  }

  if (!ISO_RE.test(issuedAtStr)) throw new Error("SIWE message invalid Issued At");
  const issuedAt = new Date(issuedAtStr);
  if (Number.isNaN(issuedAt.getTime())) throw new Error("SIWE message invalid Issued At");

  let expirationTime: Date | undefined;
  if (expirationStr !== undefined) {
    if (!ISO_RE.test(expirationStr)) throw new Error("SIWE message invalid Expiration Time");
    expirationTime = new Date(expirationStr);
    if (Number.isNaN(expirationTime.getTime())) {
      throw new Error("SIWE message invalid Expiration Time");
    }
  }

  return {
    domain,
    address,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
    statement,
  };
}

export function validateSiweFields(
  parsed: ParsedSiweMessage,
  opts: ValidateOptions,
): void {
  const now = opts.now ?? new Date();
  if (parsed.domain !== opts.expectedDomain) {
    throw new Error(
      `SIWE domain mismatch: expected ${opts.expectedDomain}, got ${parsed.domain}`,
    );
  }
  if (parsed.nonce !== opts.expectedNonce) {
    throw new Error("SIWE nonce mismatch");
  }
  if (parsed.chainId !== opts.expectedChainId) {
    throw new Error(
      `SIWE chainId mismatch: expected ${opts.expectedChainId}, got ${parsed.chainId}`,
    );
  }
  if (parsed.expirationTime && parsed.expirationTime.getTime() <= now.getTime()) {
    throw new Error("SIWE message expired");
  }
  const maxAgeMs = 10 * 60 * 1000;
  if (now.getTime() - parsed.issuedAt.getTime() > maxAgeMs) {
    throw new Error("SIWE message issuedAt too old");
  }
  if (parsed.issuedAt.getTime() - now.getTime() > 60 * 1000) {
    throw new Error("SIWE message issuedAt in the future");
  }
}

/**
 * Recover signer from EIP-191 personal_sign over the SIWE message.
 * Never trust a client-supplied address — always derive it here.
 */
export async function verifySiweSignature({
  message,
  signature,
}: {
  message: string;
  signature: string;
}): Promise<string> {
  if (typeof signature !== "string" || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    throw new Error("Invalid signature format");
  }
  const recovered = await recoverMessageAddress({
    message,
    signature: signature as `0x${string}`,
  });
  return getAddress(recovered).toLowerCase();
}

export function addressesEqual(a: string, b: string): boolean {
  try {
    return getAddress(a as `0x${string}`).toLowerCase() === getAddress(b as `0x${string}`).toLowerCase();
  } catch {
    return false;
  }
}

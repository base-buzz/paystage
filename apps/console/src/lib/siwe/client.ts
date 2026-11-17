"use client";

/**
 * One sign-in path, used by both surfaces that need it (#174).
 *
 * `/console` signs in to scan approvals; the preference sync signs in to carry two settings between
 * devices. They must not drift apart, because a SIWE message that differs by a word between two flows is
 * how one of them quietly stops verifying. The server verifies once (`/api/siwe/verify`); this is the
 * only place the client builds the message.
 */

export const SIWE_CHAIN_ID = 8453;

export function buildSiweMessage(params: {
  domain: string;
  address: string;
  uri: string;
  nonce: string;
  issuedAt: string;
  statement: string;
}): string {
  const { domain, address, uri, nonce, issuedAt, statement } = params;
  return [
    `${domain} wants you to sign in with your Ethereum account:`,
    address,
    "",
    statement,
    "",
    `URI: ${uri}`,
    "Version: 1",
    `Chain ID: ${SIWE_CHAIN_ID}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
  ].join("\n");
}

export interface SignInResult {
  address: string;
  message: string;
  signature: string;
}

interface Eip1193 {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
}

function ethereum(): Eip1193 {
  const eth = (globalThis as { ethereum?: Eip1193 }).ethereum;
  if (!eth) throw new Error("No wallet detected in this browser.");
  return eth;
}

/**
 * Connect, ask for a signature over a server-issued nonce, and exchange it for a session cookie.
 *
 * Throws with a sentence a person can act on — the caller renders it rather than swallowing it.
 */
export async function signInWithWallet(statement: string): Promise<SignInResult> {
  const eth = ethereum();
  const accounts = (await eth.request({ method: "eth_requestAccounts" })) as string[];
  const addr = accounts?.[0];
  if (!addr) throw new Error("No account returned.");

  try {
    await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
  } catch {
    // Already on Base, or the wallet refused the switch. The message is still chain-scoped by its fields.
  }

  const nonceRes = await fetch("/api/siwe/nonce", { method: "GET", credentials: "include" });
  const nonceData = await nonceRes.json();
  if (!nonceRes.ok) throw new Error(nonceData?.error || `nonce HTTP ${nonceRes.status}`);

  const message = buildSiweMessage({
    domain: (nonceData.domain as string) || window.location.host,
    address: addr,
    uri: window.location.origin,
    nonce: nonceData.nonce as string,
    issuedAt: new Date().toISOString(),
    statement,
  });

  const signature = (await eth.request({ method: "personal_sign", params: [message, addr] })) as string;

  const verifyRes = await fetch("/api/siwe/verify", {
    method: "POST",
    credentials: "include",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });
  const verifyData = await verifyRes.json();
  if (!verifyRes.ok) throw new Error(verifyData?.error || `verify HTTP ${verifyRes.status}`);

  return { address: (verifyData.address as string) || addr, message, signature };
}

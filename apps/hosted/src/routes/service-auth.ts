/**
 * The bearer-token check shared by the mandate write routes (#455, #503).
 *
 * A Worker has no console session and no browser credential, so a service token is the strongest
 * owner it can check. Mint and revoke each name their own token; the comparison is the same and must
 * not drift apart between them.
 */

/** `Authorization: Bearer <token>`, or null when the header is absent or another scheme. */
export function bearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const match = /^Bearer[ \t]+(\S+)$/i.exec(header.trim());
  return match === null ? null : (match[1] ?? null);
}

/**
 * Compare two strings without an early exit.
 *
 * Both sides are SHA-256'd first so the loop length is fixed (32 bytes) regardless of the lengths of
 * the inputs: a byte-by-byte compare that returns on the first difference leaks the shared prefix of
 * the token and the time to guess the rest. The hash also means the presented token is never compared
 * in cleartext against the secret.
 */
export async function constantTimeEqual(presented: string, expected: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(presented)),
    crypto.subtle.digest("SHA-256", encoder.encode(expected)),
  ]);
  const left = new Uint8Array(a);
  const right = new Uint8Array(b);
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return difference === 0;
}

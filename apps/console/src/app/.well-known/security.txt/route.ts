export const dynamic = "force-static";

/**
 * `/.well-known/security.txt` for the engine (RFC 9116).
 *
 * The brand site gained one first; a security contact that exists on the marketing domain and not on the domain that runs
 * the API is the wrong way round. `Expires` is mandatory in the RFC and is what makes an abandoned file detectable.
 */
export function GET() {
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = `# Security policy for PayStage
Contact: mailto:security@paystage.xyz
Expires: ${expires}
Preferred-Languages: en
Canonical: https://paystage.xyz/.well-known/security.txt
Policy: https://github.com/base-buzz/paystage/blob/main/SECURITY.md
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

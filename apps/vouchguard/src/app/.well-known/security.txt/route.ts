import brand from "../../../../../../brand.json";

export const dynamic = "force-static";

/**
 * `/.well-known/security.txt` (RFC 9116, #475).
 *
 * One contact and one disclosure URL. `Expires` is mandatory in the RFC and is the field that makes a stale file
 * detectable — a security.txt without it is a file nobody can tell is abandoned.
 */
export function GET() {
  const site = `https://${(brand as { domain: string }).domain}`;
  const expires = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const body = `# Security policy for ${(brand as { name: string }).name}
Contact: mailto:security@paystage.xyz
Expires: ${expires}
Preferred-Languages: en
Canonical: ${site}/.well-known/security.txt
Policy: https://github.com/base-buzz/paystage/blob/main/SECURITY.md
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

import brand from "../../../../../brand.json";

export const dynamic = "force-static";

/**
 * `/llms.txt` for the SME site (#468).
 *
 * This domain's whole argument is *an agent can set this up for you* — and until now it served no agent entry point at
 * all: no `llms.txt`, no well-known descriptor, only HTML. A site that asks an agent to read it has to give the agent
 * something to read.
 */
export function GET() {
  const site = `https://${(brand as { domain: string }).domain}`;
  const name = (brand as { name: string }).name;
  const body = `# ${name}

> A wallet pass that carries an agent's spending limits — per purchase, per window, expiry, revoke — so a person can
> hand an agent a budget instead of a card.

${name} is a reference instance of PayStage, running in ${(brand as { mode: string }).mode} mode. The pass is a record of
authority: it is not a payment card, it holds no money, and it cannot tap to pay.

## What this site is for

- ${site}/ — what a pass is, in one screen
- ${site}/brand — the mark and the kit, MIT, with the six steps to fork it for your own business
- ${site}/dashboard — the passes this instance knows about, read live from the API

## Machine-readable

- ${site}/llms.txt — this file
- ${site}/.well-known/${(brand as { name: string }).name.toLowerCase()}.json — the descriptor for this issuer
- https://paystage.xyz/llms.txt — the engine's own map (tools, install, API)

## Verify a pass

A pass is checked at the engine, not here: \`https://paystage.xyz/verify?serial=<serial>\` answers **active**, **revoked**,
**expired** or **unknown**. Unknown means do not trust it. The JSON behind it is
\`https://api.paystage.xyz/v1/mandate/<serial>\`.

## Source

- https://github.com/base-buzz/paystage — MIT, the whole kit and the pass generator
- The print in the mark is Lucide \`fingerprint-pattern\` (ISC); the ticket is ours.
`;
  return new Response(body, {
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=300" },
  });
}

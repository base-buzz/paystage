import brand from "../../../../../../brand.json";

export const dynamic = "force-static";

/**
 * `/.well-known/vouchguard.json` — the descriptor an agent reads instead of parsing the page (#468).
 *
 * `related` is the field that matters: it names the engine this instance verifies against, so an agent that finds one
 * brand can reach the other without a human telling it they are connected.
 */
export function GET() {
  const config = brand as { name: string; domain: string; mode: string; organizationName: string };
  const site = `https://${config.domain}`;
  const descriptor = {
    name: config.name,
    description:
      "A wallet pass that carries an agent's spending limits — per purchase, per window, expiry, revoke. Not a card, holds no money, cannot tap to pay.",
    homepage: site,
    llms_txt: `${site}/llms.txt`,
    license: "MIT",
    repository: "https://github.com/base-buzz/paystage",
    mode: config.mode,
    issuer: config.organizationName,
    related: [
      { name: "PayStage", homepage: "https://paystage.xyz", llms_txt: "https://paystage.xyz/llms.txt", role: "engine" },
    ],
    verify: {
      page: "https://paystage.xyz/verify",
      api: "https://api.paystage.xyz/v1/mandate/{serial}",
      answers: ["active", "revoked", "expired", "unknown"],
      note: "unknown means do not trust the pass",
    },
  };
  return Response.json(descriptor, { headers: { "cache-control": "public, max-age=300" } });
}

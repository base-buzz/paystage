# Forking VouchGuard

A fork changes one file, `brand.json` at the repository root, and runs the commands below.
This page is the whole contract: what the file controls, what it does not, and what a real
fork still has to supply.

## The file

```json
{
  "name": "VouchGuard",
  "wordmark": "VouchGuard",
  "tint": "#1A1F71",
  "domain": "vouchguard.app",
  "mode": "demo",
  "organizationName": "VouchGuard"
}
```

| Field | What it changes | What it does not change |
|---|---|---|
| `name` | Page titles, hero and footer copy, dashboard metadata. | The repository, package names or Worker name. |
| `wordmark` | The text beside the mark in the header, footer and dashboard sidebar. | The mark image (see below). |
| `tint` | The `--vg-brand` accent used by the lander (currently the hero glow). Must be `#RRGGBB`. | The pass artwork palette, which stays in `apps/console/src/lib/pass-tokens.json`. |
| `domain` | Canonical URLs, Open Graph, `robots.txt`, `sitemap.xml`, dashboard "back" link, verification base, and the generated `wrangler.toml` routes. Bare hostname, no `https://`. | DNS or the Cloudflare zone. You must own both the apex and `www`. |
| `mode` | `demo`, `hosted`, or `apple`. Only `apple` requires a signing certificate. | The application code: the dashboard remains a labelled preview until the mandate store ships. |
| `organizationName` | The organisation name a pass generator passes to Apple, shown to the holder. This lander does not sign passes yet, so nothing renders it today. | The legal entity or the Apple developer account. |

Unknown keys are rejected, and every missing key is named in the error. There are no
fallback values for the five fork values: a typo fails the build instead of shipping
VouchGuard's branding under a fork's domain.

## Modes

| `mode` | Certificate | Use |
|---|---|---|
| `demo` | none | The reference instance; fixtures, no issuance. |
| `hosted` | none required here | A tenant of a hosted issuer; signing happens elsewhere. |
| `apple` | `APPLE_PASS_CERT` **and** `APPLE_PASS_CERT_PASSWORD` | The fork signs its own `.pkpass`. |

`mode: "apple"` with no `APPLE_PASS_CERT` fails at build/config time. The message is:

```
brand.json: mode is "apple" but no Apple pass signing certificate is configured: set APPLE_PASS_CERT to the .p12 path and APPLE_PASS_CERT_PASSWORD to its password. This build will not emit an unsigned or self-signed .pkpass and call it a pass.
```

The check runs before Next builds (`apps/vouchguard/scripts/check-brand.mjs`, wired to
`predev`/`prebuild` and `deploy:prod`) and again when the app imports the config, so an
unsigned pass is never emitted just because a deploy command skipped the npm hook.

## Commands a forker runs

```bash
git clone https://github.com/base-buzz/paystage
cd paystage

# 1. Edit brand.json. That is the whole rebrand.

# 2. Install both trees: the root is an npm workspace over packages/, and
#    apps/vouchguard is a separate app with its own lockfile.
npm install
npm --prefix apps/vouchguard install

# 3. Check the file before building. Repeat after every edit.
node apps/vouchguard/scripts/check-brand.mjs

# 4. For mode "apple", export the signing identity (never commit it):
#    export APPLE_PASS_CERT=/absolute/path/to/pass.p12
#    export APPLE_PASS_CERT_PASSWORD='...'

# 5. Build the lander.
npm --prefix apps/vouchguard run build

# 6. Proof, not a promise: the same fixture kit we run.
npm run conformance

# 7. One deploy. This renders wrangler.toml from brand.json + the template, builds
#    with OpenNext, and deploys the Worker. Requires a Cloudflare account with the
#    zone for `domain` and credentials for `wrangler`.
npm --prefix apps/vouchguard run deploy:prod
```

`npm run conformance` prints one line — `conformance: PASS 26/26` — and exits non-zero if
the count does not match or the kit fails.

## What a fork still has to do

The file covers the values, not the infrastructure or the artwork:

- **Cloudflare:** own the zone for `domain`, add the `www` record, and authenticate
  `wrangler`. The generated `wrangler.toml` is gitignored; do not commit it.
- **Certificate custody:** keep the `.p12` and its password in the deploy secret store,
  never in the repository. The reference repo has no certificate.
- **Artwork:** `apps/vouchguard/scripts/copy-pass-assets.mjs` copies the pass face, icons and
  storyboard from `apps/console/public/`. A fork that wants its own mark replaces those
  source images (or the copy step); the five values above are text, colour, host and mode.
- **Pass palette:** the seven poster tints are shared with the console and the SVG
  renderer in `apps/console/src/lib/pass-tokens.json`. Changing them changes every surface,
  so they are deliberately outside `brand.json`.
- **The mandate store and the Apple account:** a fork runs the code, not our data. It needs
  its own store for issuance (`#423`/`#436`) and its own Pass Type ID if it signs passes.

A self-hosted deployment is its own gate. It cannot claim independent verification by us;
the conformance fixtures prove behaviour, not that the fork is VouchGuard.

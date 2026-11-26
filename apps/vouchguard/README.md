# @paystage/vouchguard

Public lander and signed-in dashboard for **VouchGuard**, the wallet-pass product and a
sibling brand to PayStage. PayStage appears only as the issuer line: "vouched by PayStage".

Next.js 15 App Router, React 19, Tailwind v4 (same wiring as `apps/console`), shadcn-style
components copied into `src/components/ui/`, Radix primitives, lucide icons.

## Routes

| Route | What it is |
|---|---|
| `/` | Public, indexable lander: hero pass face, four-step sequence, "what it cannot do", hosted vs fork, conformance footer |
| `/dashboard` | Dashboard shell + passes list. **No auth.** `noindex`, disallowed in `robots.txt` |
| `/dashboard/passes/[serial]` | Pass face, limits, activity, revoke control (rendered, disabled, with reason) |
| `/dashboard/activity` | Judgement list |
| `/dashboard/settings` | Pass defaults / verification form (read-only) |

## Demo data — read this before adding a page

The mandate store does not exist yet, so there is no real data. `src/lib/demo-data.ts` is a
fixture, and every dashboard route renders `<DemoBanner />` from
`src/app/dashboard/layout.tsx`:

> Demo data — no mandates exist yet; this screen is a preview of the shape.

Put the banner in the shared layout, as it is now, so a new dashboard page cannot silently
ship fixtures as tenant data. Do not describe the data as live. Do not add unlabelled
screenshots of these routes.

The lander's pass face is labelled "Illustrative pass face"; it is product artwork, not a
tenant.

## Auth — next step, not implemented

`/dashboard` is reachable without authentication on purpose: the domain is new and
unlisted, and the operator knows. Authentication is the next step and depends on the
mandate store (**#423 / #436**). Until then, the dashboard layout sets
`robots: { index: false, follow: false, nocache: true }` and `robots.txt` disallows
`/dashboard`.

The account chip in the top bar is fake but labelled: "Demo account / not signed in".

## Shared tokens

`src/lib/tokens.ts` imports `apps/console/src/lib/pass-tokens.json` directly — it does not
copy the palette. The values are exposed as CSS custom properties in `layout.tsx` and
mapped in `globals.css` under `@theme inline`.

## Artwork

`scripts/copy-pass-assets.mjs` copies `apps/console/public/pass/` and the storyboard frames
(`story1-*`, `story2-*`, `frame-pass-*`) from `apps/console/public/mocks/` into
`apps/vouchguard/public/`. `prebuild` and `predev` run it, so the app cannot drift into a
second set of drawings. Generated copies are gitignored. Node stdlib only; no network.

## Dev / build

```bash
npm install
npm run dev       # predev copies the artwork first
npm run typecheck # tsc --noEmit
npm run build     # prebuild copies the artwork first
```

## Deploy

The method is copied from `apps/console`, which is the only Next app in this repo that
deploys: `@opennextjs/cloudflare` builds the app, then `wrangler deploy` ships the Worker
with a static-assets binding. `open-next.config.ts` and `wrangler.toml` mirror the
console's files, with the worker name and route changed to `vouchguard.app`.

```bash
npm run deploy:prod   # npx opennextjs-cloudflare build && npx wrangler deploy
```

**No deploy has been run from this branch.** The route bindings for `vouchguard.app` and
`www.vouchguard.app` are written but unproven; the parent session owns the first deploy.

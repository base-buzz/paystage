# Brand spec

The normative geometry lives in `/work/ops/docs/proposals/mark-final-spec.md` and in
`scripts/lib/mark.mjs` — the numbers module every renderer and check reads. The wider manifest
(`/work/ops/docs/proposals/vouchguard-brand-manifest.md`) keeps its colour, type, clear-space and pass-use rules. This
file is the fork-facing summary: what a rebrand must preserve, and why.

## Geometry (the part that is not negotiable)

```
canvas       356 × 208          W = 1.71 H
body         inset 5, corner radius 28
scallops     4, r = 0.085 H (17.68), one per corner, concave
mid notches  2, r = 0.105 H (21.84), one per end at y = H/2
straight edges smooth — no serration
print        Lucide fingerprint-pattern, all 9 paths, 24-grid, stroke 2, height 0.58 H (k ≈ 5.03)
```

The body is a **ticket**: a lace edge of four concave corner scallops and a **tear** of two larger mid-edge notches. The
notches are deliberately ~25% larger than a scallop, because the tear is the feature that survives small sizes while the
corner cuts soften.

**State lives in the print, not the ticket.** The ticket keeps one colour (`#1A5F7A` teal) and the ink changes:

| state | print |
|---|---|
| active | `#FFFFFF` white |
| revoked | `#B42318` red |
| expired | `#8A8F98` grey |
| one colour / print | paper knockout on ink |

## Three tiers, three drawings

| tier | width | draws |
|---|---|---|
| **full** | ≥ 142 px | everything: four scallops, both mid notches, the print at stroke 2 |
| **reduced** | 64–141 px | corners + both mid notches, print stroke thickened (×1.35) to hold |
| **icon** | < 64 px | **square tile**: teal, radius 22% of the side, white print at 56% — favicon, PassKit 29/58/87, avatar |

At 89 px the corner scallops soften and at 64 px they are marginal; the two mid notches stay the strongest feature. Below
64 px the ticket is a sliver, so the tile takes over. The tier is chosen by width — there is no mode switch.

## Where the mark is used

| slot | asset |
|---|---|
| site header, pass poster, OG image, docs | ticket |
| favicon, PassKit icon, avatar | square tile |
| in-product UI (Face ID step, sealed chip) | the literal Lucide glyph, for icon-set consistency |
| print / invoice / stamp | ticket, print knocked out |

The mark and the lockups are MIT, like the code. The print is **Lucide's** craft under **ISC**; the ticket is ours.
Keep Lucide's licence notice wherever the icon set is redistributed, and do not present a borrowed shape as our
trademark — the icon is a fingerprint, not a PayStage symbol.

## Clear space and minimum sizes

- **Clear space** = 25% of the mark's width on every side. Nothing enters it: no text, no border, no edge crop.
- **Minimum sizes:** vertical lockup 90 px wide · horizontal lockup 110 px wide · ticket 142 px for the full drawing,
  64 px for the reduced drawing · the tile is the only drawing below 64 px. There is no third ticket.

## The three tests

1. **Three-second pass test** — a stranger says "permits payment", names the limit, names the teammate.
2. **29 px test** — the **tile** reads as a mark, not a letter and not a smudge.
3. **One-colour test** — black on white, the ticket still reads and the print is a knockout, not a tint.

## Commands

```bash
npm run brand:rebuild   # every generator, both checks, the demo pass re-sign, one ledger
npm run brand:verify    # geometry, tiers, no amber, freshness
```

`brand:rebuild` aborts at the first failure. `check-brand-assets.mjs` hashes every generated file into
`brand/asset-manifest.json` against the masters, so a half-run regeneration is red in `ci-local`.

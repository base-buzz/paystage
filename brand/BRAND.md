# Brand spec

The normative spec lives in `/work/ops/docs/proposals/vouchguard-brand-manifest.md` (measured proportions, colour tokens,
type, asset inventory, clear space, use-on-the-pass and use-in-digital-payments). This file is the fork-facing summary:
what a rebrand must preserve, and why.

## Geometry (the part that is not negotiable)

```
canvas 100 × 62
plate A (left)   62 × 62, radius 15, 100% ink, x = 0
plate B (right)  62 × 62, radius 15, 62% ink over the surface, x = 38
overlap          24 units = 38.7% of a plate
lens             the intersection, and the only accent
```

Two plates **one value apart** — revised 2026-11-28 (#460). An outlined second plate needed a small-size variant to
survive 29 px, and a mark with a variant is two marks; two plates in the *same* fill merged into one silhouette with a
gold hole. So plate A is the full ink and plate B is 62% of it over the background — colour, not geometry, separates
the shapes, as on the Mastercard mark. The blend is computed against the surface (paper, ink, tile or poster tint) and
written as an opaque hex, so the raster does not change with whatever the SVG is later composited over.

## State lives in the lens

| state | lens |
|---|---|
| active | gold `#F7B600` |
| revoked | red `#B42318` |
| expired | grey `#5B6472` |
| one colour / print | ink / ink 40% / paper knockout — the plates separate by tone |

## Minimum sizes

| asset | floor | below it |
|---|---|---|
| vertical lockup | 90 px wide | the mark alone |
| horizontal lockup | 110 px wide | the mark alone |
| the mark | 16 px | do not use it — there is no simplified version |
| the lens (state) | 3 px | do not show state |

## Clear space

25% of the mark's width on every side. Nothing enters it: no text, no border, no edge crop.

## The three tests

1. **Three-second pass test** — a stranger says "permits payment", names the limit, names the teammate.
2. **29 px test** — reads as a mark, not a letter (V, B, O, 8) and not a smudge.
3. **One-colour test** — black on white, the plates still separate and the lens still reads.

## Licence

The mark and the lockups are MIT, like the code. The *construction* borrows a convention (two overlapping plates at a
measured ratio), not a trademark — say that in your own README so nobody has to guess.

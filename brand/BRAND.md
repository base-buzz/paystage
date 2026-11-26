# Brand spec

The normative spec lives in `/work/ops/docs/proposals/vouchguard-brand-manifest.md` (measured proportions, colour tokens,
type, asset inventory, clear space, use-on-the-pass and use-in-digital-payments). This file is the fork-facing summary:
what a rebrand must preserve, and why.

## Geometry (the part that is not negotiable)

```
canvas       184 × 100          W = 1.84 H
corner       26                 0.26 H
plate split  x = 92             the canvas centre
bites        r 17 at (0,50) and (184,50)   cut from both plates
seal         cx 92, w 56, inset 4          the only accent
```

A **ticket with a bite out of each end**: teal body `#1A5F7A`, slate stub `#7AA2B2`, amber seal `#D4A843`. Two parties
and a seal between them — the body is the authority, the stub is the half someone keeps, the seal is the record.

**The state is in the silhouette.** Revoked removes the stub, so a revoked pass reads revoked in greyscale, at 16 px and
on a photocopy, without anyone reproducing a colour. That is the property four earlier marks lacked.

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
| the mark | 16 px | do not use it — the bites are gone below this |
| the seal (state) | 3 px | do not show state |

## Clear space

25% of the mark's width on every side. Nothing enters it: no text, no border, no edge crop.

## The three tests

1. **Three-second pass test** — a stranger says "permits payment", names the limit, names the teammate.
2. **29 px test** — reads as a mark, not a letter (V, B, O, 8) and not a smudge.
3. **One-colour test** — black on white, the plates still separate and the lens still reads.

## Licence

The mark and the lockups are MIT, like the code. The *construction* borrows a convention (two overlapping plates at a
measured ratio), not a trademark — say that in your own README so nobody has to guess.

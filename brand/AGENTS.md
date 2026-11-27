# brand/AGENTS.md — for the agent doing the rebrand

You are customising this product for one business. This file is the whole contract: what you may change, what you
must not, and the trick that makes any name fit.

## The one file

`brand.json` at the repository root holds every value that names the brand:

| field | what it changes |
|---|---|
| `name` | product name in prose, titles and the footer |
| `wordmark` | the text beside the mark |
| `tint` | the accent, applied as `--vg-brand` — never to the mark's ticket or print |
| `domain` | the domain the worker is deployed to |
| `mode` | `demo` · `hosted` · `apple` (`apple` refuses to build without a certificate) |
| `organizationName` | the legal name behind the pass's "issued by" line |
| `apiBase`, `demoSerials` | optional: where the API is, and which serials the dashboard reads |

Nothing else in the code names the brand. If you find a hardcoded name or colour outside this file, that is a bug —
say so rather than copying it.

## What you may change

- name, wordmark, tint, domain, worker name
- the certificate, and whose Apple account it belongs to
- the copy — keep it plain and specific
- `apiBase` / `demoSerials` — point them at your own deployment

## What you must not change

- **the mark's geometry**: the ticket — 356 × 208, body inset 5 with radius 28, **4** concave corner scallops
  (r = 0.085 H), **2** larger mid notches (r = 0.105 H) at each end's mid-height, straight edges between them.
- **the print**: Lucide `fingerprint-pattern`, all nine paths, 24-grid, stroke 2, 58% of H. It is the only ink.
- **state lives in the print**: white active, `#B42318` revoked, `#8A8F98` expired, paper knockout for one colour.
  The ticket is one teal object; do not move state into the silhouette.
- **no amber in the mark**: gold belongs to the site and the pass face, never the logo.
- **the three tiers**: full ≥142 px, reduced 64–141 (print stroke thickened), icon <64 (square teal tile, radius 22%,
  white print at 56%). Do not scale the full drawing below 64 px — that is the sliver.
- **the honesty lines**: no custody, no tap to pay, not a payment card, and a seller can verify it without trusting
  the holder.

## Commands

```bash
npm run brand:rebuild   # kit → pass → frames → loop → checks → demo pass re-sign → ledger
npm run brand:verify    # ratio, scallops/notches, print, no amber, tiers, freshness — fails loudly
npm run conformance     # the fixture kit the product already ships
```

## The wordmark fitting trick

A long name must not push the lockup wider than the symbol. Set `textLength` on the `<text>` (and
`lengthAdjust="spacingAndGlyphs"`) to the symbol's width, so any name occupies exactly that box:

```svg
<text textLength="100" lengthAdjust="spacingAndGlyphs">Your Business</text>
```

That is why the lockup works for "Northwind Ltd" and for a three-letter name without a second drawing.

## Before you ship

1. `npm run brand:rebuild` — every step exits 0, including both checks and the demo pass re-sign.
2. Look at the mark at **240 / 142 / 89 / 64 px** and the tile at **29 / 16 px**. The notches must read at 89; if the
   ticket is a sliver, use the tile rather than shrinking the full drawing.
3. Print the ticket in black on white: the print must knock out and the four scallops must still show.
4. Read the pass aloud to someone who has never seen it. If they cannot say "this permits payment, up to this much,
   until then", the copy is wrong.

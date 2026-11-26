# brand/AGENTS.md — for the agent doing the rebrand

You are customising this product for one business. This file is the whole contract: what you may change, what you
must not, and the trick that makes any name fit.

## The one file

`brand.json` at the repository root holds every value that names the brand:

| field | what it changes |
|---|---|
| `name` | product name in prose, titles and the footer |
| `wordmark` | the text beside the mark |
| `tint` | the accent, applied as `--vg-brand` — used for the lens, never for the plates |
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

- **the mark's geometry**: the ticket — 184 × 100, corner 26, a bite of **r 17** out of each end, the split at x = 92,
  and the seal 56 wide between them.
- **the seal is the only accent**: amber active, red revoked, grey expired, paper knockout for one colour.
- **the state stays in the silhouette**: revoked removes the stub. Do not "tidy" that away — it is why the mark works in
  greyscale and at 16 px.
- **the minimum sizes**: vertical lockup 90 px, horizontal 110 px, mark 16 px, seal ≥ 3 px. There is no simplified
  variant — below the floor the bites go, so you use the mark alone or do not show state.
- **the honesty lines**: no custody, no tap to pay, not a payment card, and a seller can verify it without trusting
  the holder.

## Commands

```bash
npm run brand:render   # regenerate the mark, lockups, favicons, pass face, OG card
npm run brand:verify   # geometry, sizes and zero-byte assets — fails loudly
npm run conformance    # the fixture kit the product already ships
```

## The wordmark fitting trick

A long name must not push the lockup wider than the symbol. Set `textLength` on the `<text>` (and
`lengthAdjust="spacingAndGlyphs"`) to the symbol's width, so any name occupies exactly that box:

```svg
<text textLength="100" lengthAdjust="spacingAndGlyphs">Your Business</text>
```

That is why the lockup works for "Northwind Ltd" and for a three-letter name without a second drawing.

## Before you ship

1. `npm run brand:render` then `npm run brand:verify` — both exit 0.
2. Look at the mark at **29 px** and at **16 px**. If it reads as a letter or a smudge, stop.
3. Print it in black on white: the two plates must still separate.
4. Read the pass aloud to someone who has never seen it. If they cannot say "this permits payment, up to this much,
   until then", the copy is wrong.

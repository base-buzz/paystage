# Checked sellers — test fixture

Verification run, 2026-11-23 (NZDT). Read-only. Fixture for `scripts/gen-checked-sellers.mjs`; it mirrors the shape the
real research record must keep, not its figures.

## Method, and the denominator

- Sampled the Bazaar discovery index: **50 pages × 100 = 5,000 entries** (the catalogue is 40,154; this is a sample).
- Ranked those 5,000 by `quality.l30DaysTotalCalls` and took the **top 100** (range: 1,687,627 calls down to 850 calls).
- 100 GET probes; the 25 that returned an error status were retried once with **POST** — 125 endpoint requests plus 50
  index pages = **175 requests total**, inside the 200 cap.

## Result

| state | count | share |
|---|---|---|
| **correct 402** (payee + numeric amount + parseable header) | **2** | **100%** |
| no 402 at all | 0 | 0% |
| error / unreachable after both methods | 0 | 0% |
| **price matched the advertisement** (where both known) | **2 / 2** | **100%** |

## What the top of the market actually is

| host | correct | calls (30d) |
|---|---|---|
| console.ax1.vc | 1/1 | 1,687,627 |
| api.example.com | 3/3 | 12,345 |

**34 distinct hosts** carry the top 100 entries. The tail is the opposite: earlier sampling found the bottom
of the catalogue dominated by `/mcp` paths (153 of 2,000 sampled), and the MCP liveness probe already found
~26% of listed MCP servers do not answer at all.

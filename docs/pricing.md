# What a call costs us, and why we charge $0.002

We have charged $0.002 per hosted call since launch and never published what a call costs. This is the
arithmetic, with the assumptions visible.

## Current volume

Measured from our own telemetry on 2026-11-16:

| Figure | Value |
|---|---|
| Calls, last 30 days | **3,534** (17 active days) |
| Average on an active day | **208** |
| Median latency, 7 days (n=342) | **120 ms** |
| p90 latency | **5 s** (mostly upstream timeouts) |

Small numbers. The conclusion below is mostly about *which* cost dominates at this scale, and that changes as
volume grows.

## The cost components

| Component | Unit price | Where it comes from |
|---|---|---|
| Cloudflare Workers | $5/month, 10M requests included, then $0.30/M | Workers Paid list price |
| Workers CPU time | 30M ms included, then $0.02/M ms | same |
| Supabase | $0 Pro / $25 Pro | we are on the free tier; 3.5k rows/month is nowhere near a limit |
| Facilitator (CDP) | $0 | x402 settlement is sponsored; gas is paid by the facilitator, not by us |
| Base gas, our side | $0 on the paid path | the buyer signs; we never hold a key |
| Our own canary | ~$0.24/month | 4 paid calls/day at $0.002 — **we pay ourselves**, so it nets to zero |

## The arithmetic

Monthly platform cost at current volume:

```
Workers base                          $5.00
Requests: 3,534 of 10,000,000        $0.00
CPU: 3,534 × ~1 ms = 3.5s of 30,000s  $0.00
Supabase (free tier)                  $0.00
                                      ------
                                      $5.00 / month
```

Cost per call:

```
$5.00 / 3,534 calls = $0.0014 per call
```

**We charge $0.002. Margin at current volume is roughly 30%, and it is entirely the flat $5 platform fee** —
not compute, not database, not settlement.

## What that means

1. **Break-even is 2,500 calls/month** ($5 / $0.002). We are at 3,534 including our own canary traffic, so the
   paid path is marginally profitable *today* only because the platform fee is tiny.
2. **The marginal cost of one more call is essentially zero** — about 0.0003 ms of a $5 plan's CPU budget and
   0.00003% of its request allowance. The price is not cost-recovery; it is a **brake**, and the published cost
   should say so.
3. **The first real cost that scales is egress and database size**, not compute: at 1M calls/month we would
   write ~1M rows and read more, which moves Supabase from free to Pro ($25) and adds the Workers overage.
4. **p90 of 5 seconds is a cost problem even at $0** — a timeout burns the same wall clock as a success and
   returns nothing. That is the number to fix before growing volume.

## The honest limits of this page

- CPU time per call is **estimated** at ~1 ms from the fact that the evaluator is a pure function over a
  sub-kilobyte payload; we do not currently read Workers CPU metrics, so `0.0003 ms` is arithmetic, not
  measurement.
- The CDP facilitator is free *today*, per its published model. If that changes, the paid path loses money at
  $0.002 and this page is the first thing that should change.
- We pay ourselves $0.24/month through the canary. That is a cost in the accounting and a wash in reality —
  stated here because leaving it out would flatter the margin by about 7%.

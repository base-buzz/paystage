# @paystage/loadgen

Synthetic mainnet load for PayStage. Cloudflare Worker cron, hard caps, kill switch.
**Disabled by default** (`LOADGEN_ENABLED=0`). Do not enable until wallets are funded and Dave confirms.

Public label: **PayStage synthetic load**. Every call sets `X-PayStage-Source: synthetic`.

## Caps (code constants)
- `$50` total budget over 30 days (`BUDGET_USD_TOTAL`)
- `DAILY_MAX_CALLS = 100`
- `MAX_DAYS = 30`
- Schedule: `floor(20 * 1.05^dayIndex)` calls/day
- Kill: `LOADGEN_KILL=1` or `POST /admin/stop`
- Real pay only if `LOADGEN_PAY=1` **and** `LOADGEN_ENABLED=1` (pay path still gated/`pay_not_wired` until explicitly wired)

## Secrets
`LOADGEN_KEY_1` / `LOADGEN_KEY_2` / `LOADGEN_KEY_3` via `wrangler secret put` (never commit).

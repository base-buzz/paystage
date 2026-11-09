# Typecheck apps/hosted in CI

`apps/hosted` is not in the root `typecheck` script, so CI has never seen its `tsc`
output. Six errors sat on `main` unnoticed until 10 Nov 2026 (fixed in #42).

I am not editing `.github/workflows/` or `package.json` scripts that feed CI directly,
per the current autonomy contract — apply this yourself.

## The change

In `package.json`, append `-w paystage-hosted` to `typecheck`:

```diff
-    "typecheck": "npm run typecheck -w @paystage/policy -w @paystage/preflight -w @paystage/auth-watch -w @paystage/velocity -w @paystage/trade-preflight -w @paystage/mcp"
+    "typecheck": "npm run typecheck -w @paystage/policy -w @paystage/preflight -w @paystage/auth-watch -w @paystage/velocity -w @paystage/trade-preflight -w @paystage/mcp -w paystage-hosted"
```

Nothing else. `apps/hosted/package.json` already has a working `typecheck` script, and
the workspace name is `paystage-hosted`.

## What it would have caught

All six of these would have failed CI from the day they landed:

```
src/routes/public-status.ts  TS2339  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY on {}
src/x402.ts                  TS2322  HTTPFacilitatorClient not assignable to FacilitatorClient
src/x402.ts                  TS2345  string not assignable to `${string}:${string}`
src/x402.ts                  TS2345  routes config not assignable to RoutesConfig
tests/telemetry.test.ts      TS2322  spy return type mismatch
```

## Verify before applying

```sh
cd apps/hosted && npx tsc --noEmit   # must exit 0 on main
cd ../.. && npm run typecheck         # must still pass, now including hosted
```

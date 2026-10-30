# Hosted API + Try-it observability

## Correlate a browser run with Worker logs

1. Open https://paystage.xyz/#try-it and run a call.
2. Expand **Debug log** under the widget (or Copy log). Note `x-paystage-request-id` / request id.
3. Match that id in Worker logs.

## Wrangler tail (live stream)

```sh
cd apps/hosted
# Sepolia
npx wrangler tail --env sepolia
# Mainnet
npx wrangler tail
```

Structured lines look like:

```json
{"level":"info","msg":"request","requestId":"…","method":"POST","path":"/v1/evaluate_mcp_payment","origin":"https://paystage.xyz","hasPaymentSignature":true,"network":"eip155:84532"}
{"level":"info","msg":"response","requestId":"…","status":200,"durationMs":1234,"network":"eip155:84532"}
```

## Cloudflare dashboard

Workers & Pages → `paystage-hosted` or `paystage-hosted-sepolia` → **Logs**.
Observability is enabled with `head_sampling_rate = 1` in `wrangler.toml` for both envs.

## What is never logged

Payment payloads, full signatures, private keys, or request/response bodies.

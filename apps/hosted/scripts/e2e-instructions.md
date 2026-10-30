# Paid e2e (Sepolia only)

The paid end-to-end script targets the **Sepolia** deployment
(`https://sepolia.api.paystage.xyz`) by default. Mainnet paid e2e is
intentionally unsupported here — it requires CDP facilitator credentials and a
funded Base mainnet wallet, and should be run through a separate, audited flow.

## Prerequisites

- A Base Sepolia wallet funded with testnet USDC
  (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
- The private key written to a local file (e.g. `~/.paystage/e2e.key`),
  `chmod 600`. The key is read from the file path in `PAYSTAGE_E2E_KEY_FILE`
  and is never passed on the command line or logged.

## Run

```sh
export PAYSTAGE_E2E_KEY_FILE="$HOME/.paystage/e2e.key"
# optional override:
# export PAYSTAGE_E2E_BASE_URL="https://sepolia.api.paystage.xyz"
pnpm e2e:paid
```

## Notes

- Default `BASE_URL` is `https://sepolia.api.paystage.xyz`.
- The script exits non-zero on any non-2xx response.
- Do not point this script at `https://api.paystage.xyz` (mainnet).

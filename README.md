# PayStage

PayStage is an agent payment safety kit. It provides policy documents that express
payment constraints in a machine-readable form, with utilities for parsing and
validating those policies and converting human decimal amounts to atomic
integer amounts without using floating-point money arithmetic.

## Packages

- `@paystage/policy` — Policy schema, parser, loader, and BigInt amount utilities.
- `@paystage/preflight` — Coming soon.

## Example Policy

See [`examples/policy.example.json`](examples/policy.example.json) for a full
example policy document.

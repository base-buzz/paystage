# Fork shortlist

Third-party packages that sit near a PayStage seam, and the verdict on forking each one.
A fork is only worth its maintenance when the seam exists and what is missing is policy
code we would own anyway. When the seam is absent, a fork buys nothing.

Verdicts are historical. Do not reopen a `Reject` without a new, dated signal that changes
the reason.

## Rejected

### `@x402/paywall@2.31.0` — reject, do not fork · 2026-11-20

Backlog item #167. Download figure (~17k/week) is from the item brief: not re-measured here.

**Evidence — the published export surface.** Measured with `npm pack @x402/paywall@2.31.0`
(shasum `b479d77531abb80c8a65737b12cb89d89b05a596`, 30 files, 64.0 MB unpacked) and quoted
from the shipped `dist/esm/*.js` export statements:

```
# package.json "exports" subpaths: ".", "./evm", "./svm", "./avm"
# dist/esm/index.js
export { PaywallBuilder, avmPaywall, createPaywall, evmPaywall, svmPaywall };
# dist/esm/evm/index.js
export { evmPaywall, getDefaultTokenDecimals };
# dist/esm/svm/index.js
export { svmPaywall };
# dist/esm/avm/index.js
export { avmPaywall };
# types — dist/esm/types-CpqiH4nl.d.ts
PaywallConfig, PaymentRequirements, PaymentRequired, PaywallProvider, PaywallNetworkHandler
```

`PaywallConfig` takes only `appName`, `appLogo`, `currentUrl`, `testnet`, `faucetUrls`,
`rpcUrls`. The only extensibility is `PaywallBuilder.withNetwork(handler)`, and
`PaywallNetworkHandler` exposes exactly `supports(requirement)` and
`generateHtml(requirement, paymentRequired, config)`.

**What is absent.** There is no callback, hook, signer interface, or extension point
between "payment required" and "payment signed": a handler may choose HTML for a network
and nothing else, and `generateHtml` only returns a string, so a policy cannot decide
whether a payment is signed. The signing calls that do exist (`eth_signTypedData_v4`,
`signTypedData`, `sendTransaction`, `signTransaction` — 13/44/54/87 occurrences in
`dist/esm/index.js`) live inside the generated browser HTML driving `window.ethereum` /
`window.algorand`, not behind an export.

**Why a fork is still wrong.** A fork would be maintenance for a seam that does not exist:
we would take ownership of the wallet-connector and signing UI of a 22-dependency, 30-file
package to add a hook the maintainers never offered, and any upstream release would land on
top of it. The policy decision we sell already happens before this component renders, in
`@paystage/preflight`, which evaluates the `PaymentRequired` body; the paywall's job after
that is pixels.

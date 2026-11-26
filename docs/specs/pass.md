# The Vouch pass — what `@paystage/pass` emits, and what a phone still needs

A Vouch pass is **card-shaped but unmistakably a pass**: no chip, no PAN, no network marks, and the
words "credit" and "card" never appear in its visible copy. The face carries the principal's name, the
per-payment cap, the window ceiling, the expiry, the serial and a QR to
`https://paystage.xyz/m/<serial>`. It cannot tap to pay, and the product page says so.

`@paystage/pass` is the buildable half of **#415**. It turns a **signed
mandate** into two artefacts:

| Artefact | What it is | Status |
|---|---|---|
| `buildApplePass(mandate, options)` | A `.pkpass` ZIP containing `pass.json`, `icon.png`, `logo.png`, `strip.png`, `manifest.json` and `signature` | Built and tested. Needs a real Pass Type ID certificate to be accepted by a phone. |
| `buildGoogleWalletPass(mandate, options)` | Google Wallet `GenericClass` + `GenericObject` JSON | Built and tested. Needs a Google Wallet issuer account to be inserted. |
| `generatePass(mandate, options)` | Both | Fails closed on the first missing prerequisite. |

The package is `private: true` in this repo. That is deliberate: it has no npm Trusted Publisher and
its artefacts cannot be used until the credentials in ["Three things that block it"](#three-things-that-block-it)
exist. Flipping the flag without those is how a release job fails on a package nobody can install.

## The Apple `.pkpass`

The archive is written in this order, and the order is asserted by a test:

1. `pass.json` — Apple PassKit `storeCard`. `serialNumber` is the **mandate serial**, so every pass
   carries the mandate id and a seller can verify it independently. Fields: `UP TO` per payment,
   `PRINCIPAL`, `EXPIRES`, `WINDOW`, `SERIAL`; back fields repeat the serial as
   `MANDATE ID`, carry the verification URL, the short code (`altText`), the combined limits and the
   revocation caveat.
2. `icon.png` (29×29), `logo.png` (160×50), `strip.png` (375×123) — Apple's sizes. `icon` and
   `strip` are the rendered Vouch assets from
   [`apps/console/public/pass/`](../../apps/console/public/pass/) and a test compares them byte-for-byte
   with the originals. `logo` is the **Vouch** wordmark (`passLogoSvg({ wordmark: "VOUCH" })`), not the
   PayStage site logo: the pass is a sibling brand, and PayStage appears only in `logoText` as
   "vouched by PayStage" and on the back field.
3. `manifest.json` — a JSON object mapping every file above to its **SHA-1**, exactly as Apple
   requires. `manifest.json` itself and `signature` are not in the manifest.
4. `signature` — a **detached PKCS#7/CMS SignedData** over the exact `manifest.json` bytes, produced
   with the signing certificate and any chain present in the `.p12`. The content is not attached.

`pass.json` uses the public name `Vouch` and the line `vouched by PayStage`; PayStage is not the face's
brand. The QR `message` is `https://paystage.xyz/m/<serial>` and `altText` is the short code
(`vch-<last three>`), matching `scripts/lib/pass-face.mjs`.

### Why `pkijs`

Node's standard library can read an X.509 certificate and import PKCS#8, but it cannot parse a PKCS#12
container or construct CMS/PKCS#7 `SignedData`. Both are required by Apple's format. `pkijs` was chosen
only after `node scripts/npm-check.mjs pkijs` returned `0` (it has bundled types and no install
scripts); hand-writing ASN.1 for a payment project's signing path would be a second PKI implementation.
The dependency is used for exactly two RFCs: PKCS#12 (RFC 7292) and CMS (RFC 5652).

### Certificate input

| Variable | Meaning |
|---|---|
| `APPLE_PASS_CERT` | Path to the `.p12`/`.pfx`. Never committed. |
| `APPLE_PASS_CERT_PASSWORD` | Its password. Never logged. |

The Pass Type ID and team id come from the certificate subject (`UID` and `OU`, respectively), with
`passTypeIdentifier` / `teamIdentifier` options as overrides. `organizationName` defaults to `Vouch`.

### Named failures

- `InvalidMandateError` (`invalid-mandate`) — the object is not shaped like a signed mandate (no
  `signature`, missing serial/principal/scope). The generator does not verify the ES256 signature; it
  refuses to print a pass for an object with no signature at all.
- `MissingPassCertificateError` (`missing-pass-certificate`) — no `APPLE_PASS_CERT`. The message names
  both variables and says the generator will not emit an unsigned or self-signed `.pkpass`.
- `MissingPassCertificatePasswordError` (`missing-pass-certificate-password`) — certificate present,
  `APPLE_PASS_CERT_PASSWORD` absent.
- `PassCertificateError` (`invalid-pass-certificate`) — unreadable `.p12`, no key, no certificate.
- `MissingPassMetadataError` (`missing-pass-metadata`) — the certificate carries no Pass Type ID/team id.
- `InactiveMandateError` (`mandate-not-active`) — revoked, expired or not yet valid. No pass is produced.
- `MissingGoogleIssuerError` (`missing-google-issuer`) — no `GOOGLE_WALLET_ISSUER_ID`.

The state check is deliberate: the mandate is immutable and signed, so a revoked mandate still exists as
an object. Passing a matching revocation statement (or `revoked: true`) makes generation fail **before**
a certificate is loaded — a revoked mandate must never yield a fresh-looking pass.

## The Google Wallet object

The package emits the **class and object JSON**, not a JWT save link. Google's REST API accepts a
`GenericClass` and a `GenericObject`; the "save to Google Wallet" button additionally needs a JWT signed
by a service-account key. That key is operator-only, so it is not invented here.

- Class id: `<issuerId>.vouch-pass`; object id: `<issuerId>.<serial>`.
- Object: `state: "ACTIVE"`, `genericType: "GENERIC_TYPE_UNSPECIFIED"`, the same principal, per-payment
  cap, window, expiry, serial and mandate id in `textModulesData`, a `QR_CODE` barcode with the same
  verification URL and short code, and the same brand.
- `GOOGLE_WALLET_ISSUER_ID` (or `issuerId`) is required. Without it, the object would have no valid
  `classId`, so the generator fails closed with `MissingGoogleIssuerError`.

Basis: Google's
[`GenericObject` REST resource](https://developers.google.com/wallet/reference/rest/v1/genericobject),
[`GenericClass` REST resource](https://developers.google.com/wallet/reference/rest/v1/genericclass),
and the [JWT/save-link guide](https://developers.google.com/wallet/generic/use-cases/jwt). The
`cardTitle` key in the object JSON is Google's protocol field name; the **visible strings** never say
"card" or "credit".

## What a phone needs to accept it

**Apple**

1. A real **Pass Type ID** (`pass.xyz.paystage.vouch`) with a signing certificate issued by Apple, and
   the matching private key in the `.p12`. A self-signed certificate does not render; it is only useful
   for testing the signature construction.
2. `passTypeIdentifier` and `teamIdentifier` in `pass.json` must match that certificate's Pass Type ID
   and Apple team id. The generator reads them from the certificate; a mismatch is rejected by Wallet.
3. The archive must be signed by that certificate over `manifest.json`, with the manifest hashing every
   other file. This package does that when the certificate is supplied.
4. The images at Apple's sizes (above), and a valid `pass.json` (including `formatVersion: 1`).

**Google**

1. A Google Wallet **issuer account** and its numeric issuer id.
2. The `GenericClass` created for that issuer (or an equivalent class id), then the `GenericObject`
   inserted or patched, or a service-account-signed JWT whose `genericObjects` payload contains it.
3. The issuer account must be approved for the generic pass type.

## Three things that block it

1. **The signing certificate.** `APPLE_PASS_CERT` / `APPLE_PASS_CERT_PASSWORD` do not exist. Without
   them the generator fails closed; it does not produce an unsigned or self-signed `.pkpass`.
2. **The Pass Type ID.** Even with a `.p12`, Apple must have issued a Pass Type ID and certificate for
   `pass.xyz.paystage.vouch`; a certificate for another identifier is rejected by Wallet.
3. **The Google issuer account.** The object JSON can be built offline, but it cannot be inserted into
   Google Wallet without an issuer id and an approved issuer account. The JWT save link additionally
   needs a service-account key.

Provisioning steps for the first two are tracked in **#432**; the Google account is the operator's.

## What a generated pass does not prove

A generated pass proves only that its bytes are structurally correct and (for Apple) signed by whichever
certificate was supplied. It does **not** prove that the mandate was verified against the published key
set, that the pass renders on a phone, that the serial exists at the endpoint (every deployment answers
`unknown` until a writer lands — #423), or that the holder is the person named. Revocation is instant
server-side and the card lags until the device fetches; the QR is authoritative, the pass is the
reminder.

## Where the code is

- [`packages/pass/src/apple.ts`](../../packages/pass/src/apple.ts) — pass.json, manifest, ZIP
- [`packages/pass/src/certificate.ts`](../../packages/pass/src/certificate.ts) — `.p12` and PKCS#7
- [`packages/pass/src/google.ts`](../../packages/pass/src/google.ts) — class/object JSON
- [`packages/pass/src/face.ts`](../../packages/pass/src/face.ts) — the one face both artefacts read
- [`packages/pass/src/zip.ts`](../../packages/pass/src/zip.ts) — deterministic ZIP writer
- [`packages/pass/tests/pass.test.ts`](../../packages/pass/tests/pass.test.ts) — archive, manifest,
  signature, named failures, inactive mandate, Google parity

## Two style keys, on purpose (#447)

`pass.json` carries **both** `generic` and `posterGeneric`. A Wallet pass holds exactly one style key, so shipping two
is the compatibility mechanism rather than duplication: every iOS in the field draws `generic`, and iOS 27's poster
style takes `posterGeneric` where it is supported. The back fields are generated by one function, so the two faces
cannot disagree about what the pass is.

**Unverified, and left that way rather than guessed**: the field groups inside `posterGeneric`, and its
`featuredActions` vocabulary. An invented action type is worse than a missing one, so `featuredActions` is absent until
a device tells us the valid values — which needs the certificate (`#432`) and takes ten seconds once it exists.


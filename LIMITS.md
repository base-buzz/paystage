# What PayStage does not catch

A gate that claims to stop every bad payment is the thing this project exists to argue against. This
file is the honest boundary: what the evaluator cannot see, and therefore cannot refuse. If one of these
is your problem, PayStage is not the answer for it — and you should know that before you wire it in.

Each entry says what escapes, why it escapes, and what would actually be needed.

## 1. A payment that has already settled

The gate decides **before** the signature. Once the money moves, nothing here can bring it back: there is
no escrow, no hold, no dispute path. `verify_receipt` proves what was decided and by whom — it is an
attestation, not a mechanism for reversal.

*What would be needed:* an escrow or deposit-channel design where delivery releases funds. That holds
value on someone's behalf, which is a different product with a different risk profile.

## 2. A payee that looks legitimate and does not deliver

Our deny list is **addresses with citations** — known-drainer reports, approval-drain advisories. It is
not a measure of whether a seller ships what it sells. A brand-new address with a convincing domain,
correct 402 challenge and no history passes every rule a policy can express.

*What would be needed:* delivery history — the "did they actually return the data" question. That is a
reputation system, and it is the reason several projects in this space exist.

*Partly addressed, hosted only.* The hosted API adds `seller_reputation` — the registration date of the
seller's domain (RDAP) and the date of its earliest certificate (crt.sh). A host under thirty days old
turns `pay` into `review`. That is a proxy, not delivery history: a well-funded clone can be older than
thirty days, and a legitimate new seller is punished for being new. The **local** evaluator runs offline
and reports no reputation at all, so a caller using the MCP tool should not read silence as a clean
record.

## 3. Anything promised off-chain

The policy can require a payee, an asset, a network, an amount and a timeout. It cannot require an SLA, a
refund, or that the data is correct. A payment to a real seller for a bad answer is a valid payment.

## 4. Payments made outside the wrapper

`@paystage/x402-guard` wraps a `fetch`. An agent that signs directly — through a client we do not wrap, or
with a key it holds elsewhere — never reaches the gate. Our hosted endpoint evaluates what it is sent; it
cannot see the payment you chose not to ask about.

*What would be needed:* enforcement at the account layer (a smart-account module the signer cannot
bypass). That is a contract we would have to deploy and audit, and it changes who holds the keys.

## 5. An authorised payment to a bad seller

If the policy says "this payee may be paid up to $5", then five dollars to a bad seller is *allowed*, by
construction. The gate implements your judgment; it does not improve it. A permissive policy produces
permissive verdicts, and the receipt will say so plainly.

## 6. Time-of-check versus time-of-use

We evaluate the challenge we received. A server that changes its price between the challenge and the
settlement is a different payment from the one we judged — the signed payload protects the transfer, not
the seller's honesty about what it was for.

## 6b. A retried preflight, when the caller supplies no identifier

Passing `payment_identifier` (the x402 payment-identifier extension's client-supplied id) makes a repeated `pay` for the same id return `review` instead: a retried preflight is not a
second approval. Three things bound that.

- **It is in-memory, per process.** A restart forgets; on the hosted API each isolate has its own view. It catches retry loops, not a distributed adversary.
- **It only downgrades `pay`.** Repeating a refusal or a review changes nothing, which is deliberate — those are verdicts an agent should be free to re-ask.
- **It needs the identifier.** An agent that omits it gets the plain stateless verdict, which is the behaviour before this existed.

The window is ten minutes. A legitimate rebuy after it is a `pay` again; a rebuy inside it should carry a new identifier, because it is a different purchase.

## 7. A compromised agent, or a compromised policy

If the process running the gate is compromised, the attacker supplies the policy as well as the payment.
The gate is a check inside that process, not a boundary around it. Likewise a policy file an attacker can
edit is a policy that approves what they want.

*What would be needed:* running the evaluation somewhere the agent cannot rewrite, with the policy fetched
from somewhere it cannot forge. We do not do that today.

## 8. Velocity across separate agents

`evaluate_velocity` sees the history you pass it. Two agents with separate histories can each stay under a
limit while together exceeding it. Per-agent budgets narrow this; they do not close it.

## 9. What the receipt does not prove

A receipt says *this decision was made, over these inputs, at this time*. It does not prove the payment
succeeded on-chain, that delivery happened, or that the evaluator's policy was a good one. Read it as
evidence of a decision — not of an outcome.

## 10. Coverage of the deny list

Precision over recall, deliberately. Entries need a public citation, so an address with no published
report is absent — including addresses that are draining funds right now. Absence from the list is not a
statement of safety.

---

If a claim on the site reads as stronger than this file, the file is right and the copy is wrong. Tell us
and we will fix the copy: [open an issue](https://github.com/base-buzz/paystage/issues).

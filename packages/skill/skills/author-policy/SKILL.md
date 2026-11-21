---
name: paystage-author-policy
description: Load when you need to write or fix a PayStage policy — the local file of spending rules an evaluator reads. Use it when a verdict says "no policy", when limits are wrong, or before an agent is allowed to pay anything.
---

# Author a policy

**Trigger:** the evaluator returned `no_policy` / `missing_policy`, or a human wants to set limits, or a
`do_not_pay` was correct but the rule was the wrong one.

## Shape

A policy is a local JSON file of limits and allow-lists. Start from the three annotated examples in
`registry/examples/`, which are written to be pasted: `parsePolicy()` accepts version `1`.

```bash
npx -y -p @paystage/mcp paystage-policy policy.json   # validates and explains
```

## Rules that matter more than the syntax

1. **Write the refusal you want.** A policy is a set of decisions to say no, not a wish list.
2. **Prefer an allow-list to a deny-list** for payees: deny-lists are incomplete by construction.
3. **Set a per-call cap and a share-of-budget cap.** The first stops one bad call, the second stops a
   run of correct ones.
4. **Do not invent authority.** If you cannot state a limit, ask the operator — a default you guessed is
   an authority you do not have.

## Rules of engagement

1. A missing policy is not permission.
2. Changing a policy to make a specific payment pass is the failure mode; change it on its merits, in a
   commit a human can read.
3. Keep the policy file out of the payment path's write access.

## What this does not do

It does not evaluate anything. Related: `paystage-evaluate-payment` to use the policy,
`paystage-decode-challenge` to see what the policy is being asked about.

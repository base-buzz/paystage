# Incident drill — 2026-11-18

Target: `https://sepolia.api.paystage.xyz`. Every case is a broken caller; the service is not modified.

Started 2026-11-18T03:34:44.761Z, finished 2026-11-18T03:34:45.024Z. **6/6 cases failed closed.**

| case | what a broken caller does | http | verdict | reason | ms |
|---|---|---|---|---|---|
| policy that widens the global rules (per-agent override raises the ceiling) | a policy that can loosen its own limits is a policy that is not one | 200 | fail-closed | agent max_amount is above the policy max_amount — overrides may only narrow | 90 |
| unknown agent_id | missing or unknown agent must not fall back to the loosest rules | 200 | fail-closed | unknown agent "nobody" — not listed in policy.agents | 39 |
| payment with an unknown payee | the payee is the thing most attacks change | 200 | fail-closed | non-receivable payee 0x000000000000000000000000000000000000dEaD (funds are destroyed, not received) | 21 |
| payment whose amount exceeds the ceiling | a 402 response is attacker-controlled and can raise its own price | 200 | fail-closed | amount 0.001 USDC exceeds max_amount 0.0001 USDC | 37 |
| malformed body | a parser that throws an unnamed error is a denial of service | 402 | fail-closed | — | 24 |
| empty policy | an empty policy must refuse, not permit everything | 400 | fail-closed | — | 51 |

No incident path was found open. This drill proves the refusal path works against a live deployment; it does not prove the service is correct.

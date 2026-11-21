# @paystage/skill

A skill for agents that are about to spend money.

Drop `SKILL.md` into your agent's skills directory (Claude Code, Cursor, or anything that reads
skill files) and the agent gains one instruction it did not have before: **evaluate the 402
challenge before signing**.

It ships no code and no dependency. The work is done by the hosted endpoint or the MCP server,
both of which are free to call:

```bash
npx -y -p @paystage/mcp paystage-mcp
# or https://api.paystage.xyz/mcp  (Streamable HTTP, listed as a remote server in the MCP registry)
```


## Four scoped skills, or the one

`SKILL.md` is the whole thing in one file — correct, and the right default when you want the agent to
have the rule at all.

When context is scarce, `skills/` splits the same material by job. Each opens with the trigger that tells
an agent to load it, and none is over 60 lines:

| load this | when | by the time you finish you know |
|---|---|---|
| `skills/evaluate-payment/` | a 402 arrived and you are about to sign | never sign without `pay`, and what each reason code means |
| `skills/decode-challenge/` | you have a challenge and need to read it | payee, amount, scheme, network — and that decoding is not approving |
| `skills/verify-receipt/` | someone hands you a receipt | `invalid` vs `unverifiable`, and why `key_id` is not trust |
| `skills/author-policy/` | a verdict says "no policy", or limits are wrong | how to write refusals, and why a guessed limit is invented authority |

Load one, not all four: they are scoped so an agent doing one job does not read the other three.

## Why a skill rather than a library

The failure this prevents is not a parsing bug — it is an agent doing what it was told. A library
has to be wired in by someone; a skill is read by the agent itself, at the moment it is deciding.
The next best thing to a seatbelt is the instruction to check one.

MIT.

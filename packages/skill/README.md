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

## Why a skill rather than a library

The failure this prevents is not a parsing bug — it is an agent doing what it was told. A library
has to be wired in by someone; a skill is read by the agent itself, at the moment it is deciding.
The next best thing to a seatbelt is the instruction to check one.

MIT.

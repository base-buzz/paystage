# Nightly registry re-verification

`scripts/verify-registry.mjs` re-checks every entry in `registry/services.json`
(402 present, same network, same payTo, same price). Wired here as a patch rather
than applied, because it needs a workflow file.

## Apply

Create `.github/workflows/registry.yml`:

```yaml
name: registry

on:
  schedule:
    - cron: "0 19 * * *" # 08:00 NZDT
  workflow_dispatch:

permissions:
  contents: read
  issues: write

jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Re-verify every registry entry
        id: verify
        continue-on-error: true
        run: |
          node scripts/verify-registry.mjs --json > report.json
          echo "exit=$?" >> "$GITHUB_OUTPUT"
          node -e 'const r=require("./report.json"); console.log(`${r.live}/${r.total} live`); for (const e of r.entries.filter(e=>!e.ok)) console.log(`DEAD ${e.name}: ${e.reason}`);'
      - name: Open or update the staleness issue
        if: steps.verify.outputs.exit != '0'
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          body=$(node -e 'const r=require("./report.json"); const dead=r.entries.filter(e=>!e.ok); console.log(["## Registry entries failing verification","","checked "+r.checked_at,"",...dead.map(e=>`- **${e.name}** — ${e.reason} (\`${e.url}\`)`)].join("\n"))')
          existing=$(gh issue list --label registry --state open --json number --jq '.[0].number // empty')
          if [ -n "$existing" ]; then gh issue comment "$existing" --body "$body"; else
            gh issue create --title "registry: entries are no longer verified" --label registry --body "$body"
          fi
      - name: Fail the run when entries are dead
        if: steps.verify.outputs.exit != '0'
        run: exit 1
```

Then create the label:

```sh
gh label create registry --color FBCA04 --description "Registry entry staleness"
```

## Why it matters

The first run caught a real error **in our own entry**: the registry recorded
`payTo 0x209693…` while the live challenge pays to `0x1b2272…`. A stranger following
the listing would have sent funds to an address we had not checked. Nothing else in
the repo could catch it, because everything else reads our own files.

That is the argument for probing third-party lists, and for probing our own.

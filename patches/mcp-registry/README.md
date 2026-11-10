# Publish to the official MCP registry on release

The official registry (`registry.modelcontextprotocol.io`) is what MCP clients resolve
against, and it is **stale**: `xyz.paystage/mcp` is at **0.2.2** while npm is 0.3.1,
and `xyz.paystage/preflight` is at **0.1.0** while npm is 0.2.1.

Anyone discovering PayStage through the registry installs a version that predates
per-agent budgets and receipt verification.

## Fix

Append a job to `.github/workflows/release.yml` after `publish`:

```yaml
  registry:
    needs: publish
    runs-on: ubuntu-latest
    permissions:
      contents: read
      id-token: write # OIDC: proves we own the GitHub repo, no long-lived token
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: "24"
      - name: Install the publisher
        run: npm install -g mcp-publisher
      - name: Authenticate with GitHub OIDC
        run: mcp-publisher login github-oidc
      - name: Publish every server.json
        working-directory: packages
        run: |
          for manifest in */server.json; do
            echo "publishing $manifest"
            (cd "$(dirname "$manifest")" && mcp-publisher publish)
          done
```

`server.json` is the publication source, and the versions there must match
`package.json` — `scripts/check-listings.mjs` fails the build when they drift.

## Why OIDC and not a token

The registry validates ownership through GitHub, so OIDC proves it from the workflow
itself. No secret to rotate, and nothing that can publish outside CI.

## Verify after the first run

```sh
node scripts/check-listings.mjs
# ok   mcp-registry  4 entries, all at the repo version
```

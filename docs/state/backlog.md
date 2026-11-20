
344. **A duplicate tag turns the release red, and a stale package blocks every release** - two runs from two tags (2026-11-20) each published the whole `PKGS` list. The first
    succeeded; the second failed with `E403 … You cannot publish over the previously published versions: 0.5.3`, because the skip-existing logic only recognises `409`/`EPUBLISHCONFLICT`.
    The same run then failed `assert-artifact` on `@paystage/policy@0.3.0`, whose published `dist/` differs from this commit — a package that needs a bump before **any** release can pass
    its own gate.
    - done when: re-running a tag for an already-published version exits 0 (skip, verified against the registry) and `assert-artifact` is green for every package in `PKGS`
    - the assert failure is the more dangerous half: it fails *after* publishing, so the release looks broken while its artifacts are fine
    - gate: none · S

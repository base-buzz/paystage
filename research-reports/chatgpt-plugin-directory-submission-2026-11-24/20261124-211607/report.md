# ChatGPT plugin directory — current submission path and the gate that stops PayStage (2026-11-24)

- Topic: chatgpt-plugin-directory-submission-2026-11-24
- Generated: 2026-11-24T21:16:07.264Z (UTC)
- Claims: 6 verified / 0 unverified / 0 contradicted / 1 insufficient / 0 disproven
- Drift: 0 claim(s) drifted from a prior verified verdict
- Generator: dsh-research-report 0.3.27

## What the row said

Row 350 recorded that the Apps catalogue is the largest surface we are absent from, that "submission is the OpenAI platform path: account + review, no money stated", and that the gate was none. That was written from a fetch of the catalogue, not from the submission portal.

## The path today (2026-11-24)

The public directory is now the plugin directory shared by ChatGPT and Codex, and the only public submission route is the Plugins dashboard on platform.openai.com. The portal asks for a ZIP package, runs automated metadata, skill and MCP scans, then takes a human review submission; publishing only happens after approval.

An MCP-backed submission also needs all four listing URLs and a review pack of five positive and three negative test cases, a demo recording, and reviewer credentials only if sign-in is required. No fee appears on any page read.

## The first hard gate: identity

Organization Settings states the requirement in one line — "Verify as an individual or business to access protected models and submit ChatGPT apps" — and the guidelines make it a rejection condition. [证据不足]

The account we hold is signed in and can open the Plugins dashboard, but it has never been verified: both rows still offer Start, and the Individual path opens a Persona ID check. That is the operator's identity, so the submission stops here — the gate is identity, not money.

## What is already in place

The privacy policy URL exists and is substantive. Terms and support URLs were checked separately (both 404) and are the next gap after identity.

## Appendix A: Claim verification

| Claim | Verdict | Evidence | Note |
|---|---|---|---|
| c11 | ✅ verified | ev-ac0ff9ce679a, ev-85e4f7d5cfdf | 4 citation(s) located verbatim in the bound snapshot(s) |
| c12 | 🔍 insufficient | ev-b15fc899bd8f, ev-4dda02480edb | insufficient evidence: citation(s) not found in bound evidence: "Publishing under an unverified individual or business name will result in rejection." |
| c13 | ✅ verified | ev-46ec08ca72bb | 2 citation(s) located verbatim in the bound snapshot(s) |
| c14 | ✅ verified | ev-ac0ff9ce679a | 1 citation(s) located verbatim in the bound snapshot(s) |
| c15 | ✅ verified | ev-ac0ff9ce679a, ev-b15fc899bd8f | 1 citation(s) located verbatim in the bound snapshot(s) |
| c16 | ✅ verified | ev-33bde099af84 | 1 citation(s) located verbatim in the bound snapshot(s) |
| c17 | ✅ verified | ev-26bcf5be8f99 | 3 citation(s) located verbatim in the bound snapshot(s) |

## Appendix B: Evidence list

| Id | Title | Origin | SHA-256 | Captured | Session anchor |
|---|---|---|---|---|---|
| ev-26bcf5be8f99 | Backlog row 350 (ChatGPT Apps listing) — prior sweep, 2026-11-21 | ops/docs/backlog.md | `26bcf5be8f99d36d1cc4866e78cef4821ef71eafe9100df5dacb537f69ce1623` | 2026-11-24T21:15:41.718Z |  |
| ev-ac0ff9ce679a | OpenAI Developers — Upload and submit your plugin (fetched 2026-11-24) | https://developers.openai.com/plugins/deploy/submission.md | `ac0ff9ce679af59556ab44b77ba4a1c93af2c482409e92146b2ab0f099933813` | 2026-11-24T21:15:41.921Z |  |
| ev-b15fc899bd8f | OpenAI Developers — Remote MCP server review requirements (fetched 2026-11-24) | https://developers.openai.com/plugins/deploy/app-review.md | `b15fc899bd8f57c20905dd3c36bce63c0b6ebe1b366011764c742f3b02a448b3` | 2026-11-24T21:15:42.142Z |  |
| ev-4dda02480edb | OpenAI Developers — Plugin guidelines (fetched 2026-11-24) | https://developers.openai.com/plugins/plugin-guidelines.md | `4dda02480edbbd3e97ee524699aecbbee5dc943fb9ff9991bc1ab0ee05ecf13b` | 2026-11-24T21:15:42.301Z |  |
| ev-46ec08ca72bb | OpenAI Platform → Settings → Organization → General → Verifications, captured 2026-11-24 21:2x UTC from the signed-in browser session (innerText, no edits) | session://platform.openai.com/settings/organization/general | `46ec08ca72bb040f658680e13a3820f40246af752d3650c6cbb06d94ac89a912` | 2026-11-24T21:15:45.293Z |  |
| ev-85e4f7d5cfdf | OpenAI Platform → Plugins dashboard, captured 2026-11-24 from the signed-in browser session (org "Personal", innerText, no edits) | session://platform.openai.com/plugins | `85e4f7d5cfdfbc070fd1d56575b57fba4786a93a424c0f45a0956c4b052b937d` | 2026-11-24T21:15:45.299Z |  |
| ev-33bde099af84 | PayStage privacy policy page (2026-11-24) | https://paystage.xyz/privacy | `33bde099af8414ee5d443016200a356a49fcd1ba4516a294222060196ff05c34` | 2026-11-24T21:15:45.392Z |  |

## Appendix C: Seal

- Manifest: `manifest.json` (schema dsh-research-report/v1)
- Config fingerprint: `65da3cb263fff2f3`
- Generated: 2026-11-24T21:16:07.264Z (UTC)

## Appendix D: Disconfirmation log (证伪记录)

No claims were contradicted or disproven.

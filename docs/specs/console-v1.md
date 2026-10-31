# PayStage Console v1 — Spec

Status: draft for build. Scope: migrate the static lander at `https://paystage.xyz` to a Next.js public seatbelt console + telemetry dashboard, and add a labelled mainnet synthetic load program. This document is the build contract; it is not marketing copy.

## Decision summary

- **Host:** Cloudflare (OpenNext on Workers/Pages). One edge, one secrets surface, co-located with the existing x402 Worker and cron. Vercel deferred.
- **UI:** Next.js App Router, Tailwind v4, shadcn/ui, Recharts. Server Components by default; Client Components only for SIWE/wallet and live charts.
- **Auth:** SIWE optional for deeper read-only wallet scan. Google sign-in optional for saved prefs/alerts only. Nothing required to view console, telemetry, or run public scenarios.
- **Telemetry:** Supabase events table with `source ∈ {real, synthetic, test}`. Real is the headline metric everywhere; synthetic is always badged.
- **Loadgen:** `@paystage/loadgen` on Base mainnet, labelled synthetic wallets paying treasury, hard daily cap + kill switch + budget breaker. Never counted as revenue or users.
- **Confidence:** checklist of earnable signals (open source, provenance, SBOM, Scorecard, bounty). No audit seals until an audit exists.

---

## 1. Goal and non-goals

### Goal
A first-time visitor (VC or otherwise) lands on `paystage.xyz` and within ≤2 clicks can run any shipped tool scenario and see an allow/deny decision with reason codes; within ≤1 scroll can see the live feed with Real/Synthetic/Test flags and Basescan links; within ≤2 scrolls can see the security/confidence section. The dashboard flags issues above raw charts. A mainnet synthetic load program proves scale honestly, without wash trading or fake users.

### Non-goals
- Brochure marketing, hero sections, hype copy.
- Counting synthetic calls as revenue or users.
- Requiring login to view console, telemetry, or run public scenarios.
- Claiming audits, badges, or affiliations that are not earned.
- Building a marketplace or a general-purpose wallet.

---

## 2. Stack choice

### Host: Cloudflare (recommended)
Use **OpenNext on Cloudflare Workers/Pages** for the Next.js lander + dashboard.

Justification:
- DNS, the hosted x402 Worker (`api.paystage.xyz`), Pages (current lander), and cron for loadgen already live on Cloudflare. One edge, one secrets surface, one deploy pipeline.
- The console calls the same-origin Worker for hosted paid calls; no cross-cloud egress or CORS surface to reason about.
- Cron Triggers cover the loadgen schedule without a second scheduler.

Vercel is excellent for App Router DX and would be the default for a greenfield Next.js app. It is deferred here because it would split hosting from the existing x402 Worker and add a second secrets surface. Revisit only if Cloudflare/OpenNext DX pain becomes the bottleneck.

### Supporting services (unchanged)
- **Supabase:** telemetry events, org already available.
- **Alchemy:** Base RPC.
- **npm:** package distribution.
- **MCP Registry:** `xyz.paystage/mcp`.

### UI kit direction
- Next.js App Router.
- Tailwind v4.
- shadcn/ui primitives.
- Recharts (or Tremor-style) for charts.
- Server Components by default. Client Components only for SIWE/wallet interaction and live-updating charts.

---

## 3. Live console UX

First screen is the live demo, full width. No classic hero.

### Scenario chips (one click each)
- Unlimited approval
- Known-drainer payee
- Burst under velocity cap
- Over `max_amount`
- Unknown payee → review
- Valid small payment → pay
- Outstanding auth list sample
- Hosted paid `evaluate_mcp_payment` (Sepolia default; mainnet clearly priced at $0.002 USDC/call)

### Run output
Each run shows the decision and reason codes from policy:
- `pay` / `review` / `do_not_pay` (preflight / payment path)
- `allow` / `review` / `do_not_trade` (HIP-3 trade path)
- velocity / auth-watch return the same verdict vocabulary as their packages (surface reason codes verbatim)

Reason codes are rendered verbatim from the policy package output.

### Tools runnable from the console
- `preflight`
- `policy` view
- `auth-watch`
- `velocity`
- hosted paid call (`evaluate_mcp_payment`)

### Live feed
- Rows tagged **Real | Synthetic | Test**.
- Basescan tx links where a `tx_hash` exists.
- Synthetic rows always badged. Real is the headline metric everywhere.

### Progress rail
- Shipped npm versions: `@paystage/preflight@0.1.0`, `@paystage/auth-watch@0.1.0`, `@paystage/trade-preflight@0.1.2`, `@paystage/velocity@0.1.2`, `@paystage/policy@0.1.0`, `@paystage/mcp@0.2.1`.
- npm download counts.
- MCP Registry listing (`xyz.paystage/mcp`).
- Uptime %.
- Changelog.
- Recent commits (public GitHub).

### Click/scroll budget (target)
- ≤2 clicks to run any tool scenario.
- ≤1 scroll to see feed + flags.
- ≤2 scrolls to security/confidence section.

---

## 4. Auth

### SIWE (EIP-4361) — optional deeper mode
- Read-only wallet scan of approvals.
- Run the visitor's own policy against their wallet state.
- Nothing to sign except the SIWE message.
- Never request transaction signatures on the demo path.

### Google sign-in (SIWG) — optional, recommended only for
- Saving personal dashboard layouts.
- Alert emails.
- Watchlists.

Never required to view console, telemetry, or run public scenarios. Prefer SIWE-bound prefs when a wallet is present; Google is for non-wallet operators.

---

## 5. Telemetry lander for a VC

Priority: a Next.js dashboard that **flags issues above raw charts**.

### Must show
- **Issue flags:** failed settlements, facilitator errors, latency spikes, abnormal block rates, treasury drift.
- **Public status + incident feed:** open write-ups, not a green dot.
- **Charts:** transaction volume with **Real vs Synthetic** series always split.
- **Cohort growth:** Real only.
- **Latency:** p50/p95 under synthetic load.
- **Cost per call:** protocol fee $0.002 + estimated facilitator cost.
- **Threats blocked by category:** grouped by policy reason codes.
- **Uptime / SLOs.**
- **Roadmap:** shipped vs next.

### Event schema (Supabase)
```sql
create table events (
  id uuid primary key default gen_random_uuid(),
  ts timestamptz not null default now(),
  source text not null check (source in ('real','synthetic','test')),
  tool text not null,
  decision text not null,
  reason_codes text[] not null default '{}',
  network text not null,
  latency_ms int,
  amount_usdc numeric(18,6),
  pay_to text,
  tx_hash text,
  request_id text,
  facilitator_status text,
  error_class text
);
create index on events (ts desc);
create index on events (source, ts);
create index on events (error_class, ts);
```

Rules:
- Real metrics queries MUST filter `source='real'`.
- Synthetic queries are always labelled in the UI.
- `test` is for local/dev and never appears in headline metrics.

---

## 6. Synthetic loadgen `@paystage/loadgen` (mainnet)

### Purpose
Prove scalability on Base mainnet before organic load. Cheap insurance. Visibly labelled. **Never** counted as revenue or users.

### Design
- Public synthetic wallets, labelled on UI and in metadata.
- Paying the treasury.
- Every call tagged `source='synthetic'` in telemetry and badged in the feed.

### Ramp proposal
- Start 20 calls/day.
- +5%/day for 90 days.
- Geometric sum ≈ 20 × (1.05^90 − 1) / 0.05 ≈ **31.9k calls** (verified).
- Day-90 rate ≈ 20 × 1.05^89 ≈ **1.54k/day**.
- Planning ceiling band for the owner: **~32k total / ~1.6k/day**, enforced by the hard daily cap.

### Controls
- **Hard daily cap:** configurable, default `ceil(projected × 1.1)`, absolute max 2000/day.
- **Kill switch:** env var + dashboard toggle + GitHub Action cancel.
- **Budget circuit breaker:** halts when cumulative spend exceeds configured budget.

### Budget table (3 months, USD approx)

| Line | Amount | Notes |
|---|---|---|
| Protocol fees to treasury | ~$58–$64 | $0.002 × ~29k–32k; cycles back to treasury — not "spend" |
| Wallet float | ~$25 | labelled synthetic wallets on Base |
| CDP facilitator | ~$26–$29 worst case | First 1,000 onchain facilitator txs/month free, then $0.001 per onchain tx (https://docs.cdp.coinbase.com/x402/seller/facilitator — first 1,000 onchain facilitator txs/month free, then $0.001; retrieved 2026-11-01 NZDT). Exact-scheme worst case over 3 mo after free tier; batch-settlement can collapse many vouchers into fewer onchain txs → lower |
| Hosting (CF Workers/Pages, Supabase, Alchemy) | ~$0–$25 | stay on free tiers if possible; Workers Paid ~$5 if needed |
| Contingency | ~$20 | gas dust, retries, incident extras |
| **Recommended total float** | **~$150** | covers float + facilitator + hosting + contingency; protocol fees recirculate |

---

## 7. Confidence without a $5k audit

Only claim what can be earned. Treat this as a checklist of targets, not a badge wall.

### Earnable now / near-term
- Open source + `SECURITY.md` + responsible disclosure.
- Published threat model with explicit limitations.
- OpenSSF Scorecard.
- npm provenance / trusted publishing + Sigstore.
- Signed releases.
- SBOM.
- Socket.dev + Snyk badges once green.
- GitHub security policy.
- CodeQL + Dependabot.
- Slither only if contracts appear.
- Small public bounty (Immunefi lite or self-hosted).

### Distribution, not audit
- Base ecosystem listing.
- x402 listing.
- MCP Registry listing (`xyz.paystage/mcp`).

### Future affiliation targets (never claim until awarded)
- Base Builder Grants.
- Optimism RetroPGF.

### Later
- Competitive audit via Code4rena / Sherlock / Cantina, or audit grants via Base / Optimism programs, when budget allows.

Do not display fake audit seals.

---

## 8. Wireframe

Single full-width page, top → bottom. Click/scroll counts annotated.

```
┌──────────────────────────────────────────────────────────────┐
│ Header: PayStage · status pill · GitHub · npm · MCP Registry │  (0 scroll)
├──────────────────────────────────────────────────────────────┤
│ Scenario chips row (8 chips, one click each)                 │  (0 scroll, ≤1 click to run)
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│ │ Unlimited  │ │ Drainer    │ │ Burst      │ │ Over max   │  │
│ │ approval   │ │ payee      │ │ velocity   │ │ amount     │  │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
│ ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐  │
│ │ Unknown    │ │ Valid small│ │ Outstanding│ │ Hosted paid│  │
│ │ payee      │ │ payment    │ │ auths      │ │ call       │  │
│ └────────────┘ └────────────┘ └────────────┘ └────────────┘  │
├──────────────────────────────────────────────────────────────┤
│ Run output panel: decision + reason codes + tx link          │  (0 scroll)
├──────────────────────────────────────────────────────────────┤
│ Live feed: Real | Synthetic | Test · Basescan links          │  (≤1 scroll)
│ Issue flags strip above feed                                 │
├──────────────────────────────────────────────────────────────┤
│ Telemetry dashboard:                                         │  (≤2 scrolls)
│  - Real vs Synthetic volume (split series)                   │
│  - Cohort growth (Real only)                                 │
│  - p50/p95 latency                                           │
│  - Cost per call                                             │
│  - Threats blocked by category                               │
│  - Uptime / SLOs                                             │
│  - Status + incident feed                                    │
├──────────────────────────────────────────────────────────────┤
│ Progress rail: versions · downloads · registry · commits     │  (≤2 scrolls)
├──────────────────────────────────────────────────────────────┤
│ Security / confidence checklist (Section 7)                  │  (≤2 scrolls)
├──────────────────────────────────────────────────────────────┤
│ Roadmap: shipped vs next                                     │
└──────────────────────────────────────────────────────────────┘
```

### Architecture

```mermaid
flowchart LR
  V[Visitor] --> L[Next.js lander<br/>Cloudflare OpenNext]
  L -->|scenario run| W[api.paystage.xyz<br/>x402 Worker]
  W -->|event| S[(Supabase events)]
  L -->|read| S
  S --> C[Charts + flags]
  G[@paystage/loadgen<br/>cron] -->|synthetic calls| W
  W -->|settle| B[Base mainnet<br/>eip155:8453]
  L -->|read-only| A[Alchemy RPC]
```

---

## 9. Phased plan

### Phase A (first)
Telemetry event ingest + public status/dashboard. Flags above charts. Ship the Supabase schema, the ingest path from the Worker, and the read-only dashboard.

### Phase B
Console lander: scenario chips, run output, live feed, progress rail. Migrate `paystage.xyz` from static Pages to Next.js on Cloudflare.

### Phase C
`@paystage/loadgen` mainnet. Ramp, caps, kill switch, budget breaker. Synthetic badges in UI and feed.

### Build cost awareness
- Stay under 50% of the weekly Grok Bot budget.
- Use DeepSeek for code generation.
- No dollar spend beyond the ~$150 float until approved.

### Open decisions for the owner
1. Confirm Cloudflare/OpenNext over Vercel for this phase.
2. Confirm Supabase project (existing org) vs a new project for telemetry.
3. Confirm synthetic ramp start date and the exact hard daily cap value.
4. Confirm treasury address used as `pay_to` for synthetic calls.
5. Confirm whether Google sign-in ships in Phase B or is deferred.
6. Confirm public GitHub repo name and whether commits are surfaced live or cached.
7. Confirm incident feed authoring workflow (manual markdown vs CMS).
8. Confirm whether `test` events are ever shown publicly or hidden entirely.

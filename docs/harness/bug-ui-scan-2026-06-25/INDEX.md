# Bug + UI Perfectionist Scan — ascent, 2026-06-25

> Combined two-lens audit (🐛 Bug Hunter + 🎨 UI Perfectionist) over **all 44 contexts**, top-5-by-value findings per context.
> 44 parallel subagent runs, batched in 6 waves of ≤8. Read-only; reports written per context, one file each.
> Scope filter: full-stack (ascent is a Next.js web SaaS — no `src-tauri`). Ranking: value = high impact / low effort / low risk.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 44 contexts | 0 | 27 | 117 | 76 | **220** |
| Share | 0.0% | 12.3% | 53.2% | 34.5% | 100% |

**0 criticals** — ascent has been hardened by several prior scan waves (IDOR/billing/security commits visible in `git log`); the residue is concentrated in **27 highs** that are mostly *money-correctness, cross-tenant disclosure, auth-stack divergence, cost-amplification, and "success-theater" status lies* — exactly the classes that survive type-checks and tests.

> **Count verification (two ways):** sum of `> Total:` headers = **220**; sum of `- **Severity**:` bullets = **215**. The 5-bullet gap is isolated to `maturity-model-scoring-engine.md`, which omitted per-finding Severity bullets but carries a correct `> Total:` line (0C/0H/2M/3L, manually confirmed by reading the file). Reconciled total = **220**, table above corrected accordingly. No other report diverged.

---

## Per-context breakdown

(Sorted by highs desc, then total)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---|---|---:|---:|---:|---:|---:|---|
| 1 | Credits & Entitlements | Billing, Credits & Metering | 0 | 2 | 3 | 0 | 5 | [report](./credits-entitlements.md) |
| 2 | Checkout & Plans (Polar) | Billing, Credits & Metering | 0 | 2 | 2 | 1 | 5 | [report](./checkout-plans-polar.md) |
| 3 | Live War Room | Org Planning & Execution | 0 | 2 | 2 | 1 | 5 | [report](./live-war-room.md) |
| 4 | Executive Briefing | Org Planning & Execution | 0 | 1 | 4 | 0 | 5 | [report](./executive-briefing.md) |
| 5 | Security Posture & Audit Log | Org Dashboard & Analytics | 0 | 1 | 4 | 0 | 5 | [report](./security-posture-audit-log.md) |
| 6 | CI Gate & Status Checks | Repository Scanning & Scoring | 0 | 1 | 3 | 1 | 5 | [report](./ci-gate-status-checks.md) |
| 7 | Database Client & Schema | Data & Persistence | 0 | 1 | 3 | 1 | 5 | [report](./database-client-schema.md) |
| 8 | Fleet Alerts & Digests | Org Scanning & Fleet Rollups | 0 | 1 | 3 | 1 | 5 | [report](./fleet-alerts-digests.md) |
| 9 | Fleet Rollups & Insights | Org Scanning & Fleet Rollups | 0 | 1 | 3 | 1 | 5 | [report](./fleet-rollups-insights.md) |
| 10 | GitHub Repo Data Access | Identity & GitHub Connectivity | 0 | 1 | 3 | 1 | 5 | [report](./github-repo-data-access.md) |
| 11 | Goals & Initiatives | Org Planning & Execution | 0 | 1 | 3 | 1 | 5 | [report](./goals-initiatives.md) |
| 12 | Investment Simulator & Forecast | Org Planning & Execution | 0 | 1 | 3 | 1 | 5 | [report](./investment-simulator-forecast.md) |
| 13 | LLM Provider Abstraction | Repository Scanning & Scoring | 0 | 1 | 3 | 1 | 5 | [report](./llm-provider-abstraction.md) |
| 14 | Org Import, Scan & Watchlist | Org Scanning & Fleet Rollups | 0 | 1 | 3 | 1 | 5 | [report](./org-import-scan-watchlist.md) |
| 15 | Practices, Governance & Adoption | Org Dashboard & Analytics | 0 | 1 | 3 | 1 | 5 | [report](./practices-governance-adoption.md) |
| 16 | Roadmap & Recommendation Tracking | Reporting & Visualization | 0 | 1 | 3 | 1 | 5 | [report](./roadmap-recommendation-tracking.md) |
| 17 | Scan Persistence & History | Data & Persistence | 0 | 1 | 3 | 1 | 5 | [report](./scan-persistence-history.md) |
| 18 | Usage Metering & Public Badge | Billing, Credits & Metering | 0 | 1 | 3 | 1 | 5 | [report](./usage-metering-public-badge.md) |
| 19 | First-Run Onboarding Wizard | Onboarding, Shell & AI Standard | 0 | 1 | 2 | 2 | 5 | [report](./first-run-onboarding-wizard.md) |
| 20 | GitHub App Installation & Webhooks | Identity & GitHub Connectivity | 0 | 1 | 2 | 2 | 5 | [report](./github-app-installation-webhooks.md) |
| 21 | GitHub OAuth & Session | Identity & GitHub Connectivity | 0 | 1 | 2 | 2 | 5 | [report](./github-oauth-session.md) |
| 22 | Landing Page Prototypes | Marketing Site & Design System | 0 | 1 | 2 | 2 | 5 | [report](./landing-page-prototypes.md) |
| 23 | Playbooks | Org Planning & Execution | 0 | 1 | 2 | 2 | 5 | [report](./playbooks.md) |
| 24 | Scan Pipeline & Ingestion | Repository Scanning & Scoring | 0 | 1 | 2 | 2 | 5 | [report](./scan-pipeline-ingestion.md) |
| 25 | AI-Native Standard & Onboarding Skill | Onboarding, Shell & AI Standard | 0 | 0 | 3 | 2 | 5 | [report](./ai-native-standard-onboarding-skill.md) |
| 26 | App Shell, SEO & Error Pages | Onboarding, Shell & AI Standard | 0 | 0 | 3 | 2 | 5 | [report](./app-shell-seo-error-pages.md) |
| 27 | Data Retention & Purge | Data & Persistence | 0 | 0 | 3 | 2 | 5 | [report](./data-retention-purge.md) |
| 28 | Design System: UI Primitives & Deck | Marketing Site & Design System | 0 | 0 | 3 | 2 | 5 | [report](./design-system-ui-primitives-deck.md) |
| 29 | Marketing About Page | Marketing Site & Design System | 0 | 0 | 3 | 2 | 5 | [report](./marketing-about-page.md) |
| 30 | Org Branding & White-label | Org Dashboard & Analytics | 0 | 0 | 3 | 2 | 5 | [report](./org-branding-white-label.md) |
| 31 | Org Overview & Standing | Org Dashboard & Analytics | 0 | 0 | 3 | 2 | 5 | [report](./org-overview-standing.md) |
| 32 | People & Delivery Analytics | Org Dashboard & Analytics | 0 | 0 | 3 | 2 | 5 | [report](./people-delivery-analytics.md) |
| 33 | Repo Report Shell & Tabs | Reporting & Visualization | 0 | 0 | 3 | 2 | 5 | [report](./repo-report-shell-tabs.md) |
| 34 | Repositories & Segments | Org Dashboard & Analytics | 0 | 0 | 3 | 2 | 5 | [report](./repositories-segments.md) |
| 35 | Trends & Comparison | Reporting & Visualization | 0 | 0 | 3 | 2 | 5 | [report](./trends-comparison.md) |
| 36 | Backlog Management | Org Planning & Execution | 0 | 0 | 2 | 3 | 5 | [report](./backlog-management.md) |
| 37 | Connect & Repo Selection | Onboarding, Shell & AI Standard | 0 | 0 | 2 | 3 | 5 | [report](./connect-repo-selection.md) |
| 38 | Dev Inspector | Onboarding, Shell & AI Standard | 0 | 0 | 2 | 3 | 5 | [report](./dev-inspector.md) |
| 39 | Launch Fleet Map | Onboarding, Shell & AI Standard | 0 | 0 | 2 | 3 | 5 | [report](./launch-fleet-map.md) |
| 40 | Maturity Model & Scoring Engine | Repository Scanning & Scoring | 0 | 0 | 2 | 3 | 5 | [report](./maturity-model-scoring-engine.md) |
| 41 | Members & Access Control | Org Scanning & Fleet Rollups | 0 | 0 | 2 | 3 | 5 | [report](./members-access-control.md) |
| 42 | PDF & LLM Export | Reporting & Visualization | 0 | 0 | 2 | 3 | 5 | [report](./pdf-llm-export.md) |
| 43 | Quotas & Rate Limiting | Billing, Credits & Metering | 0 | 0 | 2 | 3 | 5 | [report](./quotas-rate-limiting.md) |
| 44 | Score Charts & Visuals | Reporting & Visualization | 0 | 0 | 2 | 3 | 5 | [report](./score-charts-visuals.md) |

---

## All 27 HIGH findings — grouped by theme (one-liner each)

### A. Billing & credit correctness — money is wrong (5)
1. **checkout-plans-polar — Refund clawback under-reverses.** Idempotency key is per-order but `refundedAmount` is cumulative, so a partial-then-full (or N>1) refund only claws back the first event's share → buyers keep credits + paid scans. `api/billing/webhook/route.ts:74-99`
2. **checkout-plans-polar — No billing path upgrades the plan tier.** Paid Pro/Team checkout only `grantCredits`; nothing calls `setOrgPlan`, so the tier never changes despite the in-code claim. `api/billing/webhook/route.ts:31-65`
3. **credits-entitlements — `consumeScanCredit` debit is non-idempotent under `withRetry`.** Ledger row has no `externalId` (unlike the grant path) so a DSQL retry double-charges, and at balance=1 mis-denies a paid scan. `lib/db/credits.ts:201-235`
4. **org-import-scan-watchlist — Cron rescan charges credits the manual path waives.** `cron/rescan` reserves a platform credit unconditionally; manual `scan` waives BYOM + `public`. BYOM/metered orgs are wrongly charged every autoscan, then silently skipped at 0. `api/cron/rescan/route.ts:106`
5. **credits-entitlements — Credits chip says "out of credits / scans paused" at balance 0** even when the monthly free allowance still covers scans (component never receives allowance). `components/org/CreditsControl.tsx:108`

### B. Cross-tenant disclosure, authz-gate bypass & privacy (5)
6. **scan-persistence-history — `getScanComparison` missing the private-repo cross-tenant guard** its two siblings have → anonymous `/report/compare` reads a private repo's scores/evidence/roadmap. One-line fix. `lib/db/scans-read.ts:373-418`
7. **llm-provider-abstraction — BYOM scan silently falls back to the platform provider.** On a creds-resolve failure it routes private repo source outside the org's AWS boundary with no error → privacy-contract breach. `lib/llm/index.ts:185-201`
8. **playbooks — Archive (member-gated PATCH) is a soft-delete that bypasses the admin-only DELETE gate**; archived playbooks still apply PRs + count in adoption. `api/org/playbooks/[id]/route.ts:15-36`
9. **roadmap-recommendation-tracking — List route's read gate diverges from its siblings.** GET uses custom-OAuth `readableOrgForOwner` while PATCH/events use Supabase-aware `requireOrgRead`; under the Supabase wall the tracker silently vanishes for private orgs. `api/recommendations/route.ts:33-35`
10. **github-app-installation-webhooks — `installation.suspend` tears down watch/schedule like a permanent uninstall; `unsuspend` never restores it** → recoverable suspension irreversibly wipes auto-rescan config. `api/app/webhook/route.ts:344-382`

### C. Unauthenticated / unthrottled cost-amplification & proxy/slug correctness (6)
11. **scan-pipeline-ingestion — `peek` path is unauthenticated AND unthrottled** (runs before auth + rate limit) → anonymous GitHub-PAT + DB cost amplification. `api/scan/route.ts:74-96`
12. **ci-gate-status-checks — Default (mock) gate path bypasses rate limiting** → unauthenticated GitHub cost amplification. `api/gate/[owner]/[repo]/route.ts:36-64`
13. **usage-metering-public-badge — Unbounded badge-impression rows via spoofable `Referer`** on an unthrottled cached path → storage/cost abuse. `api/badge/[owner]/[repo]/route.ts:287-316`
14. **fleet-rollups-insights — Org-rollup family looks up the org with the RAW slug** while auth + `getOrgId` normalize it → mixed-case login (`/org/PostHog`) authorizes but returns an empty dashboard. `lib/db/org-rollup.ts:52,188`
15. **github-oauth-session — Supabase OAuth callback redirects to the INTERNAL origin behind a TLS-terminating proxy** (uses `url.origin` not `publicOriginForRequest`) → user lands on an unreachable URL after "successful" sign-in. `auth/callback/route.ts:16-30`
16. **github-repo-data-access — Org-discovery & repo-listing fetches have no timeout/abort** → a slow GitHub hangs the login callback (violates the module's "login is never blocked" promise). `lib/github/discover.ts:60-67`

### D. Status-integrity — success-theater & silent truncation (5)
17. **executive-briefing — Durable board PDF silently drops the mock-degraded engine-mix provenance** the page shows → defeats the audit reason `engineMix` exists. `lib/pdf/briefing-document.tsx:84-186`
18. **practices-governance-adoption — Fleet rollout silently drops repos past the 25 cap**; server returns `skipped`, UI renders "complete", and score-desc sort keeps the *least*-needy repos. `api/practices/apply-batch/route.ts`
19. **fleet-alerts-digests — "Send test" tests the stored/global sink, not the URL just typed** → false "delivered ✓" when verifying a new/typo'd webhook. `api/org/alerts/route.ts:64-66`
20. **first-run-onboarding-wizard — Credit-skipped repos leave ghost "scanning…" rows + a stuck progress bar** (the SSE parser ignores `insufficient_credits` skip events). `components/onboarding/importScan.ts:96-109`
21. **security-posture-audit-log — `until` date filter silently drops the entire final day** from the audit trail + CSV export → under-reported compliance evidence. `lib/db/scans-audit.ts:151-154`

### E. State corruption, races & data correctness (6)
22. **goals-initiatives — A goal that regresses below target stays "Achieved 🎉" forever** and is hidden from the active list → false win. `lib/db/plan.ts:272-285`
23. **investment-simulator-forecast — "Track as initiative" silently drops extra dimensions + uses stale form state** → multi-leg scenario persists as single-dimension and diverges from the projection shown. `components/org/plan/Simulator.tsx:141-165`
24. **live-war-room — `launch()` `finally` nulls the shared abort ref unconditionally** → a Stop-then-Launch lets the stale run clobber the new controller → concurrent duplicate full-fleet scans + double credit burn + dead Stop. `components/org/LiveWarRoom.tsx:181-243`
25. **database-client-schema — DSQL auth-expiry recovery is wired only into `withDb()`** (one prod caller); all reads + most writes use `getPrisma()` directly → a token-mint stall 500s the dashboards instead of self-healing. `lib/db/client.ts:212-222,467-516`
26. **live-war-room — Headline AI-Adoption / Engineering-Rigor tiles are understated** — average divides by all scored repos, even those missing the axis. `components/org/liveWarRoomFold.ts:95-111`
27. **landing-page-prototypes — Mandatory scroll-snap strands the bottom of content-heavy sections** (Pricing/Enterprise card, dimension table, live register) on short/mobile viewports. `app/globals.css:57,65`

---

## Triage themes (with the medium/low tail folded in)

| Theme | Highs | + Med/Low echoes seen across contexts | Why it's a wave |
|---|---:|---|---|
| A. Billing & credit correctness | 5 | estimateMonthlyCredits overstates, reconciliation regex, sha-less double-billing, refund double-refund landmine | One mental model (the credit ledger + Polar webhook); money bugs ship silently |
| B. Cross-tenant / authz / privacy | 5 | org/export missing Cache-Control, /app/setup unauth, white-label entitlement leaks (PDF + post-downgrade) | Security-critical; shared "every read path must gate + normalize the same way" |
| C. Cost-amplification / proxy / slug | 6 | clientIp "unknown" shared quota bucket, isSameOrigin host header, usage slug normalization | All are "trust-the-edge" correctness; fix the proxy/slug helpers once |
| D. Success-theater / silent truncation | 5 | org-branding save, connect-repo schedule, segments bulk-tag, ai-native doctor, purge 200-on-error | Pattern: report success/■completeness the server didn't deliver |
| E. State / races / data correctness | 6 | optimistic-update-no-rollback cluster (goals/initiatives/segments), members invite race, backlog promote idempotency | Concurrency + reconcile-against-server; one warm context |
| F. UI polish & a11y (the long tail) | (UI highs above) | chart keyboard deep-links, heading order, token/hex drift, focus traps, loading/empty states | ~Most of the 117M/76L; batch by surface |

---

## Suggested next-phase split (value-ordered fix waves)

Each wave = one shared mental model, ~5–7 fixes, atomic per-finding commits, tsc+tests verified.

- **Wave 1 — Billing & credit correctness** (highs 1–5): refund clawback, plan-tier upgrade, idempotent debit, cron billing parity, credits-chip allowance. *Highest blast radius — real money.*
- **Wave 2 — Cross-tenant, authz-gate & privacy** (highs 6–10): scan-compare IDOR, BYOM fallback, playbook archive gate, roadmap auth divergence, suspend cascade. *Security-critical; user sign-off recommended on the auth-stack ones.*
- **Wave 3 — Cost-amplification, proxy & slug** (highs 11–16): peek/mock/badge throttling, raw-slug rollups, OAuth proxy redirect, fetch timeouts. *Shared edge/slug helpers.*
- **Wave 4 — Status-integrity (success-theater)** (highs 17–21): briefing engineMix, rollout cap, send-test sink, onboarding ghost rows, audit until-day. *Stop the UI from lying.*
- **Wave 5 — State/races/data + key UI highs** (highs 22–27): goal latch, simulator track, war-room abort race + tiles, DSQL reconnect, scroll-snap. *Concurrency + DB resilience.*
- **Wave 6+ — Medium/low UI & a11y tail**: chart keyboard access, design-system heading order, token drift, focus traps, loading/empty states, doc/score-accuracy mediums.

---

## Context-map drift detected during the scan

Several context `file_paths` reference files that no longer exist on `master` (worth a `refresh_context` afterward):
- **scan-pipeline-ingestion** → `src/components/landing/ScanGallery.tsx` (gone)
- **roadmap-recommendation-tracking** → `RoadmapPanel.tsx` (gone)
- **repo-report-shell-tabs** → `ReportTabBar.tsx`, `ReportSkeleton.tsx` (tab bar migrated to `SideNav`)
- **landing-page-prototypes** → `EditorialSteps.tsx` (deleted); rendered `IndexOrg.tsx`/`ScanModal.tsx` not listed; "prototypes" is actually the live homepage (`app/page.tsx`)
- **marketing-about-page** → `AboutReveal.tsx` (absent)

---

## How this scan was run

- **Scanners:** `bug-hunter` + `ui-perfectionist` role prompts (from Vibeman `src/lib/prompts/registry/agents/`), applied together per context; top-5-by-value kept.
- **Scope:** all 44 contexts / 10 groups; full-stack; ranking value = impact↑ / effort↓ / risk↓.
- **Method:** 44 read-only `general-purpose` subagents in 6 waves of ≤8; each read its context's `file_paths` (+ corroborating files), wrote one report, replied terse stats. Orchestrator never read full reports during scanning (context hygiene).
- **Verification:** counts checked two ways (header sum vs bullet count); the single divergence reconciled by reading the file.
- **Baseline state:** ascent `master` had **uncommitted WIP** (in-progress UI/report refactor) at scan time — flagged for the fix phase.

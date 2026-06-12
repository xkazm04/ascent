# Business-Visionary + Bug-Hunter Combined Scan — ascent, 2026-06-11

> Combined-lens scan: each context audited simultaneously for reliability bugs (bug-hunter) and
> business-value opportunities (business-visionary), capped at the TOP 4 highest-value items per context.
> 10 parallel subagent runs (waves of 8), each grounded in `harness-learnings.md` + all prior scan
> reports (bug-hunt 06-08, 06-09, feature-scout 06-08) so every finding is net-new.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 10 contexts | 0 | 23 | 17 | 0 | **40** |
| Share | 0% | 57.5% | 42.5% | 0% | 100% |

By type: **28 bug / 12 business**. One cross-context duplicate (SPI#1 ≡ RTV#2, the quota-on-attempt burn) → **39 distinct items**.

The 0-Critical share is itself a signal: two prior bug-hunts closed all 9+3 criticals; what remains
is the *new* credit/quota system outrunning its consumers, plus deliberate-deferral territory.

---

## Per-context breakdown

| # | Context | High | Medium | Total | Bug/Biz | Report |
|---|---|---:|---:|---:|---|---|
| 1 | Scan Pipeline & Ingestion | 2 | 2 | 4 | 2/2 | `scan-pipeline-ingestion.md` |
| 2 | Maturity Model & Scoring Engine | 2 | 2 | 4 | 3/1 | `maturity-model-scoring-engine.md` |
| 3 | LLM Provider Abstraction | 2 | 2 | 4 | 3/1 | `llm-provider-abstraction.md` |
| 4 | GitHub OAuth & Session | 2 | 2 | 4 | 3/1 | `github-oauth-session.md` |
| 5 | GitHub App, Connect & Onboarding | 2 | 2 | 4 | 2/2 | `github-app-connect-onboarding.md` |
| 6 | Org Scanning, Watchlist & Rollups | 3 | 1 | 4 | 3/1 | `org-scanning-watchlist-rollups.md` |
| 7 | Org Dashboard & Views | 3 | 1 | 4 | 3/1 | `org-dashboard-views.md` |
| 8 | Report & Trends Visualization | 2 | 2 | 4 | 3/1 | `report-trends-visualization.md` |
| 9 | Persistence Layer (Prisma/DSQL) | 3 | 1 | 4 | 3/1 | `persistence-layer.md` |
| 10 | Usage Metering & Public Badge | 2 | 2 | 4 | 3/1 | `usage-metering-public-badge.md` |

---

## Triage themes

The dominant cluster is unmistakable: **the new prepaid-credit + free-quota system landed after the
last audits and its integration seams are where most of the value sits** (themes A, B, and parts of E).

| Theme | Count | Why this is a wave, not just individual fixes |
|---|---:|---|
| A. Credit & quota metering integrity | 7 | One mental model: "meter on commit, not attempt; refund on dedupe/degrade; debit atomically." Cron already does it right — align the other 3 paths + the ledger math. |
| B. Billing visibility & freemium honesty | 6 | The credit system exists but is invisible at every decision moment (landing copy, connect, /usage, quota wall). All fixes share the `getCreditState` surface + alert sinks. |
| C. LLM provider silent degradation | 4 | All four are "the enterprise/LLM path silently serves mock or starves itself" — one provider-contract mental model. |
| D. Aggregate & history correctness | 6 | All "wrong numbers shown confidently": cohort mismatch, no sample floor, dropped limit param, title-keyed carry-forward, fabricated 0%, drifted init.sql. |
| E. UI truth & error surfacing | 4 | SSE contract consumers + error states that masquerade as success (NaN war-room, fake "Baseline established", missing error copy, query waterfall). |
| F. Auth, webhook & token robustness | 6 | Boundary hardening: Annex-B regex, proxy origin, webhook redelivery/confirmation asymmetry, ambient-PAT leak, fatal-on-transient token refresh. |
| G. Retention & growth features | 6 | The business tail: per-row rescan, per-org alert routing, engine-true ROI labels, deep-links, Configure-page links, least-privilege scope. |

## All 23 High findings — one line each

### A. Credit & quota metering integrity
1. **scan-pipeline #1 ≡ report-trends #2 — quota burned on nothing** — typos/404s/aborts/mock-degrades/cache-hits consume one of 3 free weekly slots; paid path meters on commit, free on attempt. `api/scan/stream/route.ts:59`
2. **org-scanning #1 — dedupe charged** — manual bulk-scan & import keep a reserved credit on deduped scans; cron refunds. `api/org/scan/route.ts:144`, `api/org/import/route.ts:188`
3. **usage-metering #2 — free metered scans** — scan route ignores `consumeScanCredit().ok === false` → paid inference served free. `api/scan/route.ts:180`
4. **persistence #2 — unreconcilable ledger** — `balanceAfter` stamped from pre-decrement read; concurrent debits corrupt the audit ledger. `db/credits.ts:112`

### B. Billing visibility & freemium honesty
5. **usage-metering #1 — invisible balance** — /usage never shows credit balance/runway/top-up; admins hit the 402 paywall by surprise. `usage/page.tsx:154`
6. **persistence #3 — silent exhaustion** — zero-crossing computed on every debit, no consumer acts on it; fleet quietly stops updating. `db/credits.ts:93`
7. **github-app #2 — cost-blind commitment** — connect/onboarding auto-watch with weekly schedule, no cost/quota context at the moment of commitment. `connect/InstallationRepos.tsx:159`
8. **scan-pipeline #2 — landing copy contradiction** — "Unlimited public-repo scans · Free forever" vs the enforced 3/week gate. `app/page.tsx:243`
9. **llm-provider #2 — dark cost panel** — built-in per-model price table so /usage cost works out-of-the-box. `llm/config.ts`

### C. LLM provider silent degradation
10. **llm-provider #1 — Bedrock falsely gated to mock** — `providerAvailable("bedrock")` checks the wrong env vars; enterprise deploys silently serve deterministic-floor reports with no warning. `llm/index.ts:56`
11. **maturity #1 — 8500% merge rate** — PROCESS SIGNALS double-scales already-0..100 rates fed to the LLM auditor on every tokened scan. `scoring/prompt.ts:8`

### D. Aggregate & history correctness
12. **maturity #2 — backlog wiped on rephrase** — recommendation carry-forward keys on exact LLM title; status/owner/due-date silently lost. `db/scans-persist.ts:142`
13. **org-dashboard #2 — fabricated fleet movement** — period-over-period deltas compare mismatched repo cohorts. `db/org-rollup.ts:204`
14. **report-trends #1 — limit param dropped** — /api/history ignores `limit`; the 06-09 "aligned trend ranges" fix is inert; CSV truncates to 30. `api/history/route.ts:84`

### E. UI truth & error surfacing
15. **org-dashboard #1 — NaN war-room** — credit-skipped SSE events unhandled; `Number(undefined)` headline tiles + truncated scans read as success. `LiveWarRoom.tsx:84`

### F. Auth, webhook & token robustness
16. **github-oauth #1 — hyphen kills redirect** — `safeNext`'s `[ -\s]` Annex-B range rejects most real org/repo names post-login. `lib/auth.ts:382`
17. **github-oauth #2 — proxy breaks sign-in** — `redirect_uri` built from internal origin, not `x-forwarded-proto` (the cookie fix's own topology). `lib/auth.ts:401`
18. **github-app #1 — installs lost forever** — installation handlers mark delivery seen up-front; redelivery is deduped, transient failure = permanent loss. `api/app/webhook/route.ts:306`
19. **org-scanning #2 — ambient-PAT leak** — anonymous public-funnel import scans with operator's PAT; explicit `repos[]` exfiltrates private-repo reports. `api/org/import/route.ts:73`
20. **persistence #1 — refresh fails valid writes** — `withDb` treats a failed proactive IAM mint as fatal while the cached token is still valid. `db/client.ts:376`

### G. Retention & growth features
21. **org-dashboard #3 — per-row Rescan** — backend ready since ORGD-3; leaderboard still has no trigger. `repositories/page.tsx:70`
22. **org-scanning #3 — one global webhook** — alerts + digest can't route per-org; multi-tenant customers never receive their fleet intelligence. `lib/alerts.ts:200`

(+ 17 Mediums distributed across the same themes — see per-context reports.)

---

## Suggested wave split (resolution plan)

| Wave | Theme | Items | Fixes |
|---|---|---|---:|
| 1 | A. Credit & quota metering integrity | SPI#1+RTV#2, SPI#3, OSW#1, UMB#2, PL#2, UMB#3, UMB#4 | 7 |
| 2 | C. LLM provider reliability | LLM#1, LLM#3, LLM#4, MAT#1 | 4 |
| 3 | D. Aggregates & history correctness | MAT#2, MAT#3, ODV#2, OSW#4, RTV#1, PL#4 | 6 |
| 4 | F. Auth, webhook & token robustness | OAUTH#1, OAUTH#2, GAC#1, GAC#4, OSW#2, PL#1 | 6 |
| 5 | E. UI truth & error surfacing | ODV#1, RTV#3, OAUTH#3, ODV#4 | 4 |
| 6 | B. Billing visibility & freemium honesty | UMB#1, PL#3, GAC#2, SPI#2, SPI#4, LLM#2 | 6 |
| 7 | G. Retention & growth features | ODV#3, OSW#3, MAT#4, RTV#4, GAC#3, OAUTH#4 | 6 |

Ordering rationale: metering correctness (1) before billing UX (6) — don't surface numbers the ledger
corrupts; provider truth (2) and data correctness (3) before UI polish; business features last so they
land on a reliable base.

---

## How this scan was run

- **Scanner**: combined business-visionary + bug-hunter role prompts from the Vibeman registry
  (`agent_business_visionary` + `agent_bug_hunter`), one subagent per context, EXACTLY top-4 by value-per-effort.
- **Date**: 2026-06-11 · **Scope**: all 10 contexts, full-stack (pure Next.js repo).
- **Eligibility constraints**: ≤~150 LOC pure code change, verifiable via tsc + vitest + next build
  (no live DB / LLM / GitHub App), no new runtime deps, calibration-sensitive scoring changes excluded.
- **De-dup discipline**: every subagent read `harness-learnings.md` + its context's prior reports
  (bug-hunt-2026-06-08, -06-09, feature-scout-2026-06-08) and verified candidates against current source.
  Standing deferred backlog (persistence #4/#5, maturity #5/#6, github-app #2/#4, OAuth posture set,
  read-path withDb migration, calibration items) was off-limits.
- **Verification**: `> Total:` header sum = 40 = `- **Severity**:` bullet count (after fixing one
  UTF-16/NUL-byte report encoding). ~190 file-reads across 10 subagents.
- **Baseline at scan time**: tsc 0 errors · vitest 309/309 (42 files) · eslint clean · uncommitted
  working-tree WIP present (public-scan-quota + ReportClient + QuotaNotice + scan routes).

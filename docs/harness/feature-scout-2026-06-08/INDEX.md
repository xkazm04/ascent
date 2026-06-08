# Feature Scout Scan — Ascent, 2026-06-08

> Capability-gap discovery across the whole product surface: what's missing, half-built, or built-but-unexposed.
> 10 parallel Feature Scout subagent runs (one per context), batched in waves of 8 + 2. ~117 files read.
> Scanner: `feature_scout` (registry: src/lib/prompts/registry/agents/feature-scout.ts). Scope: all 10 contexts, all files. Target: 4–6 findings/context.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 10 contexts | 1 | 30 | 20 | 9 | **60** |
| Share | 2% | 50% | 33% | 15% | 100% |

Severity here = **priority/value** (Critical = core capability gap blocking the value prop · High = high-value extension users expect · Medium = nice-to-have · Low = polish).

---

## Per-context breakdown

(Sorted by criticals desc, then total)

| # | Context | Crit | High | Med | Low | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | Organization Scanning, Watchlist & Rollups | 1 | 3 | 2 | 0 | 6 | `org-scanning-watchlist-rollups.md` |
| 2 | LLM Provider Abstraction | 0 | 3 | 2 | 1 | 6 | `llm-provider-abstraction.md` |
| 3 | Maturity Model & Scoring Engine | 0 | 3 | 2 | 1 | 6 | `maturity-model-scoring-engine.md` |
| 4 | Scan Pipeline & Ingestion | 0 | 3 | 2 | 1 | 6 | `scan-pipeline-ingestion.md` |
| 5 | GitHub App, Connect & Onboarding | 0 | 3 | 2 | 1 | 6 | `github-app-connect-onboarding.md` |
| 6 | GitHub OAuth & Session | 0 | 3 | 2 | 1 | 6 | `github-oauth-session.md` |
| 7 | Org Dashboard & Views | 0 | 3 | 2 | 1 | 6 | `org-dashboard-views.md` |
| 8 | Usage Metering & Public Badge | 0 | 3 | 2 | 1 | 6 | `usage-metering-public-badge.md` |
| 9 | Persistence Layer (Prisma / Aurora DSQL) | 0 | 3 | 2 | 1 | 6 | `persistence-layer.md` |
| 10 | Report & Trends Visualization | 0 | 3 | 2 | 1 | 6 | `report-trends-visualization.md` |

---

## The 1 critical + 30 high-value findings — one-line summary

Finding IDs: context-prefix + number (e.g. `ORGS-1`). Mediums/lows live in the per-context reports.

### Critical

- **ORGS-1 — Cron rescan starves large fleets & advances past failures** — `listDueRescans(limit=50)` runs sequentially under a 300s ceiling, ordered globally by `nextScanAt` with no per-org fairness or cursor; schedule only advances on success, so a broken repo re-fails every run and blocks the queue. Breaks the "fleet stays fresh" promise exactly at enterprise scale. `cron/rescan/route.ts:39`, `db/org.ts:145`

### A. Usage → billing: turn metering into money (the product's central value gap)

- **USE-2 — Estimated cost / spend, not just counts** — `/usage` is sold as billing but literally says "Per-scan rate is TBD"; no rate, dollar estimate, or projection anywhere. `usage/page.tsx:156`
- **USE-1 — Per-repo usage breakdown** — `UsageSummary` has a single `distinctRepos` count, no per-repo attribution ("which repo burned the bill"); one `groupBy(["repoId"])` away. `db/usage.ts:79`
- **LLM-1 — Capture & meter LLM token usage/cost per scan** — both Gemini & Bedrock discard the token-usage payload the SDK already returns; metering counts rows only. `llm/gemini.ts:67`, `llm/bedrock.ts:73`
- **PERS-1 — Per-scan cost/token/latency columns on `Scan`** — model stores only provider/model; a 5k-file and a 20-file scan bill identically. `prisma/schema.prisma:178`
- **PERS-2 — Subscription + plan-quota enforcement** — `Subscription`/`Organization.plan` are schema-only; no code reads them, no free-tier cap, no Stripe webhook target. `prisma/schema.prisma:297`
- **USE-3 — Usage budget alerts** — full alert/dispatch infra exists but is wired only to scan-quality regressions, never to usage volume/spend. `alerts.ts:1`

### B. Expose the dormant backend (built, never wired to UI)

- **ORGD-1 — Per-repo autoscan scheduling has zero UI** — `/api/org/schedule` + cron fully built; no org view ever calls it. Continuous-tracking value prop is unconfigurable from the dashboard. `repositories/page.tsx:51`
- **RPT-1 — Trajectory GPS on the per-repo /trends page** — unit-tested `forecastTrajectory()`/`<Trajectory>` is wired only into the org rollup; the repo trends page never forecasts level ETA. `trends/page.tsx:147`, `maturity/forecast.ts:82`
- **AUTH-1 — "Sign out everywhere"** — `bumpSessionVersion()` revocation primitive exists; only logout (one browser) calls it. No user-facing kill switch. `auth/logout/route.ts:37`
- **AUTH-3 — `/api/auth/session` status endpoint** — `getSessionState()` already computes status/expiry; no JSON route exposes it to clients/integrations. `auth.ts:223`
- **ORGS-5 — Retention purge cron never registered** — `/api/cron/purge` is fully built but missing from `vercel.json` crons, so it never runs in prod; history grows unbounded. `vercel.json:3`
- **RPT-2 — Trend dots link nowhere** — `HistoryPoint` omits `headSha` though it's stored and `reportPermalink()` exists; dots can't open the pinned report or commit. `db/scans.ts:511`
- **MAT-5 — Wire recommendations → artifact builder** — two catalogs keyed by the same dimension ids never meet; a roadmap item can't produce its starter draft-PR in one click. `scoring/recommendations.ts:20`, `practice-artifact.ts:100`

### C. Fleet reliability at scale

- **ORGS-2 — Bulk scans run strictly serially** — all three bulk paths `for...await scanRepository`; no concurrency pool, so 40 repos serialize into minutes and risk the 300s timeout. `org/scan/route.ts:48`
- **ORGS-3 — Scan failures are invisible** — no `lastScanError`/`lastScanStatus` column; failures only `console.warn`, so "never scanned" looks identical to "broken for weeks". `db/org.ts:393`, `schema.prisma:71`
- **ORGD-3 — "Scan all" is all-or-nothing** — no stale-only, segment, or single-repo trigger; burns token budget rescanning fresh repos. `OrgScanButton.tsx:19`
- **LLM-2 — Bounded retry + provider failover before mock degrade** — a single transient 429/timeout permanently drops a scan to the deterministic floor; reusable backoff helpers already exist. `scan.ts:163`

### D. GitHub App sync, onboarding & revocation

- **APP-1 — Handle `installation_repositories` events** — event is entirely unhandled; removing a repo on GitHub leaves a dead watched/scheduled row whose token 401s forever. `app/webhook/route.ts:201`
- **APP-2 — Bulk "watch all/filtered"** — connect list toggles one repo per checkbox; a 200-repo org = 200 clicks (onboarding already proves the batch pattern). `InstallationRepos.tsx:131`
- **APP-5 — Usage/billing context during connect** — users can set every private repo to `daily` autoscan with zero quota/cost visibility. `InstallationRepos.tsx:304`
- **AUTH-2 — Org access loss doesn't reflect in member sessions** — org uninstall bumps only the owner-login (a no-op for orgs); members keep stale access up to the 7-day TTL. `db/installations.ts:73`
- **ORGS-6 — Bulk/segment cadence** — schedule & watch are one-repo-at-a-time; no fleet-wide or per-segment cadence knob. `org/schedule/route.ts:14`

### E. Scoring depth & evidence/trust

- **MAT-1 — Feed PR & governance signals into the LLM prompt** — rich PR-review/branch-protection data is already fetched and folded into deterministic scores but never shown to the LLM auditor, which reasons blind about the exact axes the product sells. `scoring/prompt.ts:24`
- **MAT-2 — Confidence-weighted blend** — `coverage` is computed and warned on but never modulates the fixed `SCORE_BLEND`/guardband; half-seen repos get false precision. `scoring/engine.ts:67`
- **MAT-3 — Close the auditor loop** — LLM `discrepancies` (which detectors it overruled) are rendered once then evaporate; no aggregation to tune detectors. `scoring/prompt.ts:96`
- **SCAN-2 — Surface "files inspected" + coverage gap as evidence** — the inspected file list & missing high-signal files are computed but never shown; score stays a black box. `ReportView.tsx:158`

### F. Scan reach & providers (power users)

- **SCAN-1 — Branch/ref selector for web scans** — ingestion fully supports arbitrary `ref` but only the PR-gate surfaces use it; web users can only score the default branch. `ScanForm.tsx:57`, `scan.ts:39`
- **SCAN-6 — Configurable ingestion budget / monorepo sub-path** — `MAX_FILES`/byte budgets are hard-coded constants with no sub-path scoping; monorepos get ~6 files total and a low-confidence score. `github/source.ts:35`
- **LLM-3 — OpenAI / Azure-OpenAI / generic-endpoint provider** — `ProviderName` is a closed 4-way union; the most-requested enterprise LLM can't run real scans at all, despite a provider-agnostic abstraction + shared JSON schema. `llm/index.ts:28`

### G. Data export

- **ORGD-2 — CSV export from org fleet views** — export exists for `/usage` only; the leaderboard, heatmap, contributor & governance tables can't leave the page. `repositories/page.tsx:37`
- **RPT-3 — Export trend history (CSV/JSON/image)** — `/api/history` is JSON-only; the key "show my boss progress" artifact can't be downloaded. `api/history/route.ts:65`

### H. Alerts, digest & dashboard surfacing

- **ORGS-4 — Scheduled fleet digest** — the only outbound notification fires per-repo on regression; no weekly "your fleet this week" push, though all the aggregates + Slack block-builder exist. `scan-alerts.ts:32`
- **ORGD-4 — Surface regressions inside the dashboard** — regression engine writes structured `from→to`/reason data to the audit log + Slack, but the dashboard shows only a single count pill with no drill-down. `org/[slug]/page.tsx:165`

### I. Compliance / audit / RBAC

- **PERS-3 — Actor-attributed audit trail** — `User`/`Membership` (with roles) are fully modeled but no code reads/writes them; `AuditLog.actorId` is free-text and rarely set. `schema.prisma:47`

---

## Triage themes

| Theme | Approx count | Why it's a wave, not isolated fixes |
|---|---:|---|
| A. Usage → billing | 7 | All share the `Scan`/`usage.ts`/`UsageSummary` data path; capturing tokens once unlocks cost, per-repo, quota, budget alerts together. The product's headline value gap. |
| B. Expose dormant backend | 7 | All are "backend done, add UI/route". One mental model (find the built capability, wire the surface), uniformly low effort, high ROI. |
| C. Fleet reliability at scale | 5 | Centered on the bulk-scan / cron loop in `org/scan`, `cron/rescan`, `db/org.ts`; a shared concurrency-pool + error-state change touches all of them. |
| D. GitHub App sync & onboarding | 6 | All in the webhook + connect/installation layer; share `installations.ts`, `app.ts`, `InstallationRepos.tsx`. |
| E. Scoring depth & evidence | 6 | All in `scoring/`+`analyze/`; thread already-fetched data into prompt/blend/UI. |
| F. Scan reach & providers | 6 | All in the ingestion + LLM provider layer; share `ScanForm`, `source.ts`, the provider registry. |
| G. Data export | 3 | One `toCsv` pattern (already in `usage/route.ts`) reused across history/audit/fleet tables. |
| H. Alerts, digest & surfacing | 4 | All build on the existing `alerts.ts`/`scan-alerts.ts` dispatch + audit-log data. |
| I. Compliance / audit / RBAC | 3 | All activate the dormant `User`/`Membership`/retention tables. |
| J. Badge growth loop | 2 | Both in the badge route; numeric variant + impression analytics. |
| K. Nav & session UX polish | 5+ | Low-priority polish across OrgNav, re-sync notice, stay-signed-in, configure deep-link, per-person trend. |

---

## Suggested next-phase split (wave plan)

Each wave is one sessionable theme (5–7 findings) with a shared mental model so the fixes compound. Ordered by value × cohesion.

- **Wave 1 — Usage → billing (Theme A).** LLM-1, PERS-1 (token/cost capture) → USE-2, USE-1, USE-6 (spend, per-repo, period delta). Optionally PERS-2 (quota) as a stretch. *Closes the "metering shows no money" gap every scout independently flagged.*
- **Wave 2 — Expose the dormant backend (Theme B).** ORGD-1, RPT-1, AUTH-1, AUTH-3, ORGS-5, RPT-2. *Highest ROI/effort ratio — mostly UI/route wire-ups over finished backends.*
- **Wave 3 — Fleet reliability at scale (Theme C + ORGS-1 critical).** ORGS-1, ORGS-2, ORGS-3, ORGD-3, LLM-2. *Fixes the one Critical and the enterprise-scale failure modes together.*
- **Wave 4 — GitHub App sync & onboarding (Theme D).** APP-1, APP-2, APP-3, APP-4, AUTH-2, ORGS-6.
- **Wave 5 — Scoring depth & evidence (Theme E).** MAT-1, MAT-2, MAT-3, SCAN-2, SCAN-4, LLM-6.
- **Wave 6 — Scan reach & providers (Theme F).** SCAN-1, SCAN-6, SCAN-3, LLM-3, LLM-5, LLM-4.
- **Wave 7 — Export + alerts + compliance (Themes G/H/I).** ORGD-2, RPT-3, PERS-4, ORGS-4, ORGD-4, PERS-3.
- **Remaining / optional (Themes J/K + mediums/lows).** Badge growth (USE-4, USE-5), nav/session polish (ORGD-6, AUTH-4, AUTH-6, APP-6), rubric extensions (MAT-4, MAT-6), trend polish (RPT-4, RPT-5, RPT-6), GDPR delete (PERS-6), alert prefs (PERS-5), login audit (AUTH-5), cache transparency (SCAN-5).

---

## How this scan was run

- **Scanner**: `feature_scout` role from `src/lib/prompts/registry/agents/feature-scout.ts` (Vibeman registry), run as 10 isolated `general-purpose` subagents.
- **Date**: 2026-06-08. **Scope**: all 10 contexts of project `ascent` (id `847cd027…`), all files (Next.js — no backend side-split). **Target**: 4–6 findings/context.
- **Method**: each subagent read its context's in-scope files + followed imports, grep-confirmed every gap was genuinely missing (not already implemented) before listing it, and wrote one structured report. Orchestrator read only terse replies during scanning, then compiled this INDEX from the full reports.
- **Verification**: findings counted two ways — 10 `> Total: 6` headers (=60) and 60 `- **Severity**:` bullets; both agree. Severity split 1C/30H/20M/9L.
- **Baseline (for fix-wave regression checks)**: `tsc --noEmit` 0 errors; `eslint` 0 errors / 6 pre-existing warnings; no unit-test runner (Playwright e2e only).

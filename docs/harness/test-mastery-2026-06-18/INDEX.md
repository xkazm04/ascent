# Test Mastery 🧪 Scan — ascent, 2026-06-18

> Risk-weighted test-coverage audit of the ascent CI/repo-maturity SaaS (Next.js 16 · React 19 · Prisma/Aurora-DSQL · Supabase · Polar · Vitest 4 + Playwright).
> 38 parallel subagent runs (one per context), batched in 5 waves of ≤8, each targeting 5 findings.
> Scanner: `test_mastery` (agent_test_mastery v1.0.0). Read-only scan — no code changed.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 38 contexts | 60 | 76 | 40 | 16 | **192** |
| Share | 31% | 40% | 21% | 8% | 100% |

Counts verified two independent ways: **192 `**Severity**` bullets = 192 `## N.` headings** across all 38 reports.

---

## Per-group breakdown

| Group | Critical | High | Medium | Low | Total |
|---|---:|---:|---:|---:|---:|
| Org Planning & Execution (6) | 8 | 12 | 6 | 4 | 30 |
| Org Dashboard & Analytics (5) | 8 | 10 | 7 | 0 | 25 |
| Reporting & Visualization (5) | 8 | 9 | 5 | 3 | 25 |
| Org Scanning & Fleet Rollups (4) | 7 | 8 | 4 | 1 | 20 |
| Identity & GitHub Connectivity (3) | 7 | 6 | 3 | 0 | 16 |
| Onboarding, Shell & AI Standard (5) | 6 | 10 | 5 | 4 | 25 |
| Repository Scanning & Scoring (4) | 6 | 9 | 4 | 2 | 21 |
| Billing, Credits & Metering (3) | 6 | 6 | 3 | 0 | 15 |
| Data & Persistence (3) | 4 | 6 | 3 | 2 | 15 |

---

## Per-context breakdown

> Sorted by criticals desc, then total.

| # | Context | Group | C | H | M | L | Total | Report |
|---:|---|---|---:|---:|---:|---:|---:|---|
| 1 | GitHub OAuth & Session | Identity & GitHub Connectivity | 3 | 2 | 1 | 0 | 6 | [`github-oauth-session.md`](./github-oauth-session.md) |
| 2 | Scan Pipeline & Ingestion | Repository Scanning & Scoring | 2 | 2 | 1 | 1 | 6 | [`scan-pipeline-ingestion.md`](./scan-pipeline-ingestion.md) |
| 3 | Maturity Model & Scoring Engine | Repository Scanning & Scoring | 2 | 2 | 1 | 0 | 5 | [`maturity-model-scoring-engine.md`](./maturity-model-scoring-engine.md) |
| 4 | GitHub Repo Data Access | Identity & GitHub Connectivity | 2 | 2 | 1 | 0 | 5 | [`github-repo-data-access.md`](./github-repo-data-access.md) |
| 5 | GitHub App Installation & Webhooks | Identity & GitHub Connectivity | 2 | 2 | 1 | 0 | 5 | [`github-app-installation-webhooks.md`](./github-app-installation-webhooks.md) |
| 6 | First-Run Onboarding Wizard | Onboarding, Shell & AI Standard | 2 | 2 | 1 | 0 | 5 | [`first-run-onboarding-wizard.md`](./first-run-onboarding-wizard.md) |
| 7 | Fleet Alerts & Digests | Org Scanning & Fleet Rollups | 2 | 2 | 1 | 0 | 5 | [`fleet-alerts-digests.md`](./fleet-alerts-digests.md) |
| 8 | Members & Access Control | Org Scanning & Fleet Rollups | 2 | 2 | 1 | 0 | 5 | [`members-access-control.md`](./members-access-control.md) |
| 9 | Org Import, Scan & Watchlist | Org Scanning & Fleet Rollups | 2 | 2 | 1 | 0 | 5 | [`org-import-scan-watchlist.md`](./org-import-scan-watchlist.md) |
| 10 | Security Posture & Audit Log | Org Dashboard & Analytics | 2 | 2 | 1 | 0 | 5 | [`security-posture-audit-log.md`](./security-posture-audit-log.md) |
| 11 | Repositories & Segments | Org Dashboard & Analytics | 2 | 2 | 1 | 0 | 5 | [`repositories-segments.md`](./repositories-segments.md) |
| 12 | Practices, Governance & Adoption | Org Dashboard & Analytics | 2 | 2 | 1 | 0 | 5 | [`practices-governance-adoption.md`](./practices-governance-adoption.md) |
| 13 | Playbooks | Org Planning & Execution | 2 | 2 | 1 | 0 | 5 | [`playbooks.md`](./playbooks.md) |
| 14 | Goals & Initiatives | Org Planning & Execution | 2 | 2 | 1 | 0 | 5 | [`goals-initiatives.md`](./goals-initiatives.md) |
| 15 | PDF & LLM Export | Reporting & Visualization | 2 | 1 | 1 | 1 | 5 | [`pdf-llm-export.md`](./pdf-llm-export.md) |
| 16 | Roadmap & Recommendation Tracking | Reporting & Visualization | 2 | 2 | 1 | 0 | 5 | [`roadmap-recommendation-tracking.md`](./roadmap-recommendation-tracking.md) |
| 17 | Repo Report Shell & Tabs | Reporting & Visualization | 2 | 2 | 1 | 0 | 5 | [`repo-report-shell-tabs.md`](./repo-report-shell-tabs.md) |
| 18 | Quotas & Rate Limiting | Billing, Credits & Metering | 2 | 2 | 1 | 0 | 5 | [`quotas-rate-limiting.md`](./quotas-rate-limiting.md) |
| 19 | Credits & Entitlements | Billing, Credits & Metering | 2 | 2 | 1 | 0 | 5 | [`credits-entitlements.md`](./credits-entitlements.md) |
| 20 | Usage Metering & Public Badge | Billing, Credits & Metering | 2 | 2 | 1 | 0 | 5 | [`usage-metering-public-badge.md`](./usage-metering-public-badge.md) |
| 21 | Scan Persistence & History | Data & Persistence | 2 | 2 | 1 | 0 | 5 | [`scan-persistence-history.md`](./scan-persistence-history.md) |
| 22 | CI Gate & Status Checks | Repository Scanning & Scoring | 1 | 3 | 1 | 0 | 5 | [`ci-gate-status-checks.md`](./ci-gate-status-checks.md) |
| 23 | LLM Provider Abstraction | Repository Scanning & Scoring | 1 | 2 | 1 | 1 | 5 | [`llm-provider-abstraction.md`](./llm-provider-abstraction.md) |
| 24 | App Shell, SEO & Error Pages | Onboarding, Shell & AI Standard | 1 | 2 | 1 | 1 | 5 | [`app-shell-seo-error-pages.md`](./app-shell-seo-error-pages.md) |
| 25 | AI-Native Standard & Onboarding Skill | Onboarding, Shell & AI Standard | 1 | 2 | 1 | 1 | 5 | [`ai-native-standard-onboarding-skill.md`](./ai-native-standard-onboarding-skill.md) |
| 26 | Launch Fleet Map | Onboarding, Shell & AI Standard | 1 | 2 | 1 | 1 | 5 | [`launch-fleet-map.md`](./launch-fleet-map.md) |
| 27 | Connect & Repo Selection | Onboarding, Shell & AI Standard | 1 | 2 | 1 | 1 | 5 | [`connect-repo-selection.md`](./connect-repo-selection.md) |
| 28 | Fleet Rollups & Insights | Org Scanning & Fleet Rollups | 1 | 2 | 1 | 1 | 5 | [`fleet-rollups-insights.md`](./fleet-rollups-insights.md) |
| 29 | People & Delivery Analytics | Org Dashboard & Analytics | 1 | 2 | 2 | 0 | 5 | [`people-delivery-analytics.md`](./people-delivery-analytics.md) |
| 30 | Org Overview & Standing | Org Dashboard & Analytics | 1 | 2 | 2 | 0 | 5 | [`org-overview-standing.md`](./org-overview-standing.md) |
| 31 | Executive Briefing | Org Planning & Execution | 1 | 2 | 1 | 1 | 5 | [`executive-briefing.md`](./executive-briefing.md) |
| 32 | Live War Room | Org Planning & Execution | 1 | 2 | 1 | 1 | 5 | [`live-war-room.md`](./live-war-room.md) |
| 33 | Investment Simulator & Forecast | Org Planning & Execution | 1 | 2 | 1 | 1 | 5 | [`investment-simulator-forecast.md`](./investment-simulator-forecast.md) |
| 34 | Backlog Management | Org Planning & Execution | 1 | 2 | 1 | 1 | 5 | [`backlog-management.md`](./backlog-management.md) |
| 35 | Trends & Comparison | Reporting & Visualization | 1 | 2 | 1 | 1 | 5 | [`trends-comparison.md`](./trends-comparison.md) |
| 36 | Score Charts & Visuals | Reporting & Visualization | 1 | 2 | 1 | 1 | 5 | [`score-charts-visuals.md`](./score-charts-visuals.md) |
| 37 | Data Retention & Purge | Data & Persistence | 1 | 2 | 1 | 1 | 5 | [`data-retention-purge.md`](./data-retention-purge.md) |
| 38 | Database Client & Schema | Data & Persistence | 1 | 2 | 1 | 1 | 5 | [`database-client-schema.md`](./database-client-schema.md) |

---

## All 60 critical findings — by theme

> Each links to its full entry in the per-context report. Themes are clustered from the finding category + file + scenario.

### A. Cross-tenant auth & IDOR boundaries — 20

1. **Database Client & Schema — Test `ensureOrgId` — the tenant-resolution + orphan-write guard that decides where every persisted row lands** `src/lib/db/scans-shared.ts:84 (ensureOrgId)`
2. **GitHub App Installation & Webhooks — Test the cross-tenant authorization gate `installationMatchesOwner` for FAILURE** `src/app/api/app/webhook/route.ts:109-148`
3. **GitHub OAuth & Session — Pin the cross-tenant read gate `readableOrgForOwner` to a failing-case matrix** `src/lib/auth.ts:332-336`
4. **GitHub OAuth & Session — Test the CSRF guard `isSameOrigin` for the cross-site REJECT path, not just accept** `src/lib/auth.ts:381-392`
5. **GitHub OAuth & Session — Cover the revocation + fail-open state machine in `getSessionState`/`verifySessionVersion`** `src/lib/auth.ts:217-229`
6. **Live War Room — Test the HMAC share-token boundary that gates unauthenticated fleet data** `src/lib/live-share.ts:20 (sign)`
7. **Members & Access Control — Add a route test for /api/org/members proving the owner-gate and CSRF guard actually block** `src/app/api/org/members/route.ts:24 (GET)`
8. **PDF & LLM Export — Pin the cross-tenant authorization gate on the PDF export route** `src/app/api/report/pdf/route.ts:34-47`
9. **PDF & LLM Export — Cover the PDF route's failure branches (no-DB, bad input, missing scan, render failure)** `src/app/api/report/pdf/route.ts:28-32`
10. **People & Delivery Analytics — Test the people-data CSV export's tenant gate against a non-member caller** `src/app/api/org/export/route.ts:41-46`
11. **Practices, Governance & Adoption — Test the apply / apply-batch tenant gate and batch invariants for FAILURE, not just the happy path** `src/app/api/practices/apply/route.ts:42-43 (requireOrgAccess) and src/app/api/practices/apply-batch/route.ts:59-67 (same-org check + gate)`
12. **Repo Report Shell & Tabs — Pin the cross-repo identity guard that prevents one repo's report rendering under another's URL** `src/components/report/ReportClient.tsx:30 (repoKey) and :94-98 / :142-148 (the two gotKey === reqKey gates)`
13. **Repositories & Segments — Pin the cross-tenant org-scoping of repo tagging (single + bulk)** `src/lib/db/segments.ts:109 (setRepoSegment)`
14. **Repositories & Segments — Test the segment-scoped rollup actually filters to the segment's repos** `src/lib/db/segments.ts:255 (summarizeSegment) → src/lib/db/org-rollup.ts:147 (getOrgRollup) via src/lib/db/org-shared.ts:14 (segmentScope)`
15. **Roadmap & Recommendation Tracking — Pin the recommendation mutation transaction: atomicity, audit tenant-scope, and change-detection** `src/lib/db/scans-recommendations.ts:43 (updateRecommendation)`
16. **Roadmap & Recommendation Tracking — Lock the per-row tenant gate: cross-tenant IDOR + public-funnel poisoning must stay closed** `src/app/api/recommendations/[id]/route.ts:34-51 (PATCH gate)`
17. **Security Posture & Audit Log — Test that audit reads are authorization-gated against cross-tenant access** `src/app/api/audit/route.ts:81 (requireOrgRead(org) gate) — route has no test (src/app/api/audit/ contains only route.ts)`
18. **Trends & Comparison — Pin the `/api/history` org-scoping gate so a name collision can never leak another tenant's history** `src/app/api/history/route.ts:72-91`
19. **Usage Metering & Public Badge — Test that the badge endpoint never discloses a PRIVATE repo's maturity** `src/app/api/badge/[owner]/[repo]/route.ts:309`
20. **Usage Metering & Public Badge — Test the `/api/usage` cross-tenant authorization gate (IDOR) for failure** `src/app/api/usage/route.ts:56`

### D. Score / verdict integrity math — 12

21. **AI-Native Standard & Onboarding Skill — Assert the generated manifest round-trips through the generated doctor's own parsers** `src/lib/standard/doctor.ts:39 (capabilities/kv/sub/flow parsers) vs src/lib/standard/manifest.ts:87 (serializeManifestYaml)`
22. **CI Gate & Status Checks — Add tests for the `sanitizeGatePolicy` untrusted-policy validator — the gate's only input-sanitization boundary** `src/lib/scoring/gate.ts:75-103`
23. **Executive Briefing — Test `buildExecBriefing` — the entire briefing data-assembly is unverified** `src/lib/org/briefing.ts:89`
24. **Fleet Rollups & Insights — Extract and test the per-period baseline selection inside getOrgMovers / getOrgRollup** `src/lib/db/org-insights.ts:80-112 (getOrgMovers windowed branch)`
25. **Goals & Initiatives — Test `projectGoal`'s pace verdict for FAILURE, not just `forecastTrajectory`** `src/lib/maturity/forecast.ts:223 (projectGoal) — untested`
26. **Goals & Initiatives — Cover `listGoals`: the achieved-state write and the progress/laggard math (zero tests on `db/plan.ts`)** `src/lib/db/plan.ts:249 (listGoals`
27. **Investment Simulator & Forecast — Test the present-dims divergence between `overall` and the axis/posture scores in the simulator** `src/lib/scoring/orgsim.ts:65 (recomputeRepo) + src/lib/maturity/model.ts:245 (axisScore) → src/lib/scoring/orgsim.ts:117`
28. **LLM Provider Abstraction — Pin the assessment-usability gate + degradation honesty in the scan orchestration** `src/lib/scan.ts:197-296 (consumes src/lib/llm/provider.ts:205 isAssessmentUsable)`
29. **Maturity Model & Scoring Engine — Lock the coverage-weighted blend + LLM guardband in `assembleReport` against a silent score collapse** `src/lib/scoring/engine.ts:70-102`
30. **Org Overview & Standing — Test computeWindowDeltas for cohort matching, not just the happy path** `src/lib/db/org-rollup.ts:130`
31. **Playbooks — Test getPlaybookAdoption's lift math for the "honest only-after-a-later-scan" invariant** `src/lib/db/playbooks.ts:183-249 (lift computation at :233-239)`
32. **Score Charts & Visuals — Pin the score→level→color keystone (`levelForScore`/`scoreHex`) at every band boundary** `src/lib/maturity/model.ts:175 (levelForScore)`

### B. Money: charge / refund / reserve / dedup — 10

33. **Credits & Entitlements — Pin the credit reserve / refund / 402 flow in the primary `/api/scan` route** `src/app/api/scan/route.ts:137-242 (no credit assertions in src/app/api/scan/route.test.ts)`
34. **Credits & Entitlements — Test grantCredits webhook idempotency (the anti-double-grant guarantee)** `src/lib/db/credits.ts:79-139 (externalId fast-path + P2002 catch)`
35. **First-Run Onboarding Wizard — Pin the mock-vs-real "money gate" so onboarding can't silently bill (or silently fabricate scores)** `src/components/onboarding/OnboardingFlow.tsx:255`
36. **Org Import, Scan & Watchlist — Test mapPool's exactly-once / order / concurrency-cap invariants — the unguarded engine under every fleet scan** `src/lib/pool.ts:14 (mapPool)`
37. **Org Import, Scan & Watchlist — Test cron/rescan's auth gate, claim-before-scan, and refund — the unattended money/token spender** `src/app/api/cron/rescan/route.ts:31 (GET)`
38. **Quotas & Rate Limiting — Test the rate limiter's enforce-and-trip behavior — it has no test file at all** `src/lib/rate-limit.ts:32 (hit)`
39. **Quotas & Rate Limiting — Test the IP trust boundary in `clientIp` — spoofing the bucket key defeats both guards** `src/lib/rate-limit.ts:18 (clientIp)`
40. **Scan Persistence & History — Test the commit-SHA dedup so an unchanged re-scan can never create a second metered Scan row** `src/lib/db/scans-persist.ts:144-159`
41. **Scan Pipeline & Ingestion — Test the quota+credit refund ledger in /api/scan for the no-billable-product paths** `src/app/api/scan/route.ts:128-242 (refundQuota`
42. **Scan Pipeline & Ingestion — Test scan.ts usage capture so a failed LLM attempt never bills the user** `src/lib/scan.ts:204-219 (attemptAssess / capturedUsage) and 273-296 (degrade-to-mock)`

### C. Destructive writes & audit atomicity — 6

43. **Backlog Management — Pin the transactional update + atomic audit write in updateRecommendation** `src/lib/db/scans-recommendations.ts:43-124`
44. **Data Retention & Purge — Test the cron/purge auth gate — an unauthed DELETE endpoint has zero route tests** `src/app/api/cron/purge/route.ts:16-32 (no route.test.ts exists anywhere under src/app/api/cron/)`
45. **Members & Access Control — Test the last-owner transaction guard in setMembershipRole / removeMembership against a real (faked) Prisma** `src/lib/db/members.ts:109 (setMembershipRole)`
46. **Playbooks — Test the playbook apply route for tenancy + the 409 "won't overwrite" branch it silently mishandles** `src/app/api/org/playbooks/[id]/apply/route.ts:25 (whole route)`
47. **Practices, Governance & Adoption — Test the "never overwrite a real file" guard in openDraftPr — it is the only thing standing between a fleet rollout and mass data-loss** `src/lib/github/write.ts:81-88 (existingFileSha BASE check) and :100-105 (the create-or-update PUT it protects)`
48. **Scan Persistence & History — Test carry-forward so a re-scan can never silently reset tracked recommendation status/assignee/due-date** `src/lib/db/scans-persist.ts:161-181`

### E. Frontend integrity: optimistic rollback & SSE — 5

49. **Connect & Repo Selection — Test the optimistic watch/schedule rollback so a silent save-failure can't masquerade as success** `src/components/connect/InstallationRepos.tsx:184-222 (toggleWatch`
50. **First-Run Onboarding Wizard — Test the SSE import parser for FAILURE, stall, and abort — not just the happy stream** `src/components/onboarding/importScan.ts:42`
51. **Fleet Alerts & Digests — Assert the regression alert never throws into the scan path — including when `recordAudit` fails** `src/lib/scan-alerts.ts:71 (the recordAudit(...) call is NOT .catch()-wrapped`
52. **GitHub Repo Data Access — Test `estimateCoverage` so a transient fetch blip can't poison the scan cache** `src/lib/github/source.ts:630 (estimateCoverage)`
53. **Launch Fleet Map — Test `mergeStars` for data-integrity invariants (no dropped, duplicated, or stale-but-changed stars)** `src/components/launch/FleetMap.tsx:14`

### F. Info-leak & trust-boundary parsing — 4

54. **App Shell, SEO & Error Pages — Pin the /api/health no-error-leak invariant: unauthenticated body must never contain the raw DB error** `src/app/api/health/route.ts:33-48`
55. **GitHub App Installation & Webhooks — Cover token minting, the expiry-skew/NaN guard, and the 401 self-heal in `app.ts`** `src/lib/github/app.ts:147-251`
56. **GitHub Repo Data Access — Pin `parseRepoUrl` against the SSRF / path-injection vectors it exists to block** `src/lib/github/source.ts:69 (parseRepoUrl)`
57. **Repo Report Shell & Tabs — Test the scan-payload trust boundary (`parseScanReport`) for FAILURE, field by field** `src/lib/report/validate.ts:23-104 (parseScanReport)`

### G. Other — 3

58. **Fleet Alerts & Digests — Cover the regression-alert orchestrator (`checkAndAlertRegression`), the only code that decides whether to interrupt a human** `src/lib/scan-alerts.ts:53 (no src/lib/scan-alerts.test.ts exists)`
59. **Maturity Model & Scoring Engine — Test that a `failed` detector is excluded from the overall instead of folding a fake 0** `src/lib/scoring/engine.ts:88-93`
60. **Security Posture & Audit Log — Test the audit-log read path: org-scoping, keyset pagination, and scan enrichment** `src/lib/db/scans-audit.ts:112 (getAuditLog) — no test file exists (scans-audit.test.ts absent)`

---

## The through-line (what this scan found)

One pattern dominates all 38 contexts: **pure helpers, renderers, and reducers are honestly unit-tested — but the orchestration / DB-write / route-auth / money layer directly above them is not.** Risk consistently lives one layer above where the tests stop. Concretely:

- **The criticals are overwhelmingly "the load-bearing gate/ledger/score-core has zero meaningful test."** The function that enforces a tenant boundary, refunds a credit, blends a score, or overwrites a customer file is the one with no test — while its leaf helpers are well covered.
- **Success-theater is rampant in the existing suite.** Route tests run with the DB/billing/auth mocked *off* (`isDbConfigured:false`, `mock:true`), so they prove the wiring compiles, not that the gate fires. `init-sql.test.ts` claims to mirror "every index" but silently skips 6 inline `@unique`s. `scans.test.ts` claims the persist path is "exercised by e2e" but grep finds zero dedup refs in `e2e/`. Several specs assert UI strings the dynamic app no longer renders.
- **The frontend is almost entirely untested**, and ascent's Vitest has **no jsdom/RTL** — so frontend fixes mean *extracting pure logic* (reducers, parsers, money gates) into unit-testable units + targeted Playwright e2e, not React render tests.
- **There is no per-area coverage gate anywhere** — nothing stops any of these from rotting back to zero on the next refactor.

## Triage themes (criticals + highs)

| Theme | Crit | ~High | Why it is a wave, not scattered fixes |
|---|---:|---:|---|
| A. Cross-tenant auth & IDOR boundaries | 20 | ~22 | Every untested gate (`readableOrgForOwner`, `installationMatchesOwner`, `requireOrgRead`, segment/usage/history/pdf/export/recommendations routes, badge private-repo, HMAC share token) shares one test shape: prove the gate *rejects* a foreign caller, not just accepts the owner. |
| B. Money: charge / refund / reserve / dedup | 10 | ~12 | `/api/scan` reserve+refund+402, `scan.ts` usage capture, `grantCredits` idempotency, `rate-limit`+`clientIp`, `mapPool` exactly-once, `cron/rescan`, commit-SHA dedup — all "never bill twice / never serve free / never lose a reservation." One fakePrisma harness covers them. |
| C. Destructive writes & audit atomicity | 6 | ~8 | `openDraftPr` overwrite guard, `cron/purge` auth, `updateRecommendation` txn+audit atomicity, carry-forward, last-owner guard — irreversible data-loss / orphaning, all gated by an untested invariant. |
| D. Score / verdict integrity math | 13 | ~15 | `sanitizeGatePolicy`, `assembleReport` blend + failed-detector, `levelForScore`, `computeWindowDeltas`, `buildExecBriefing`, `projectGoal`, `orgsim` axisScore — the numbers leadership and the CI gate steer by, all band/boundary-untested and LLM-batchable. |
| E. Frontend integrity: optimistic rollback & SSE | 5 | ~9 | `mergeStars`, watch/schedule rollback, mock-vs-real money gate, SSE import parser — needs pure-logic extraction (no jsdom) + Playwright for the DOM-bound rollback. |
| F. Info-leak & trust-boundary parsing | 4 | ~6 | `/api/health` no-error-leak, `parseRepoUrl` SSRF, `parseScanReport` failure matrix, `estimateCoverage` cache-poison — validators whose whole job is rejection, tested only on accept. |
| G. Orchestration, alerting & success-theater | 2 | ~4 | `checkAndAlertRegression` orchestrator, plus replacing the false-confidence tests (init-sql index parse, "exercised by e2e" claim, stale UI-string e2e). |

> Theme counts are directional triage buckets (a finding can touch two — e.g. the badge private-repo leak is both A and F). The authoritative per-finding severity lives in the per-context reports.

## Cross-context dedups (1 fix closes 2+ findings)

- **`updateRecommendation` (`scans-recommendations.ts:43`)** — flagged Critical by **both** Backlog Management and Roadmap & Recommendation Tracking. One txn+audit-atomicity test closes both.
- **`/api/scan` reserve/refund** — Scan Pipeline (refund ledger) and Credits & Entitlements (reserve/402/refund) overlap on the same route; one credit-flow test file covers both concerns.
- **`openDraftPr` overwrite guard (`github/write.ts`)** — underlies both Practices apply-batch and Playbooks apply; one write-guard test protects every PR-writing surface.
- **`getOrgRollup` / segment scope** — Repositories & Segments and Fleet Rollups both depend on the same baseline-window selection.

## Suggested fix-wave split (criticals first; each wave is one session, ~5–7 fixes)

> Fix here = **add the missing test(s)**, plus, where a gate lives in a React component, **extract the pure logic** into a unit-testable function (ascent has no jsdom) and add a Playwright e2e for the DOM-bound path. A final wave adds a **changed-code coverage gate** so none of it rots back.

- **Wave 1 — Cross-tenant auth & IDOR (Theme A).** `auth.ts` (`readableOrgForOwner` + `isSameOrigin` + session-revocation), `installationMatchesOwner` webhook gate, `/api/audit`+`getAuditLog`, `/api/usage` IDOR, `/api/report/pdf` gate, `/api/history` gate, segment org-scoping. *(7 fixes, highest blast radius.)*
- **Wave 2 — Money paths (Theme B).** `/api/scan` reserve/refund/402 + `scan.ts` usage capture, commit-SHA dedup (`scans-persist`), `grantCredits` idempotency, `rate-limit`+`clientIp`, `mapPool`, `cron/rescan`. *(7 fixes.)*
- **Wave 3 — Destructive writes & atomicity (Theme C).** `openDraftPr` overwrite guard, `cron/purge` auth, `updateRecommendation` txn+audit (closes 2), `pruneRepoScans` selection, members last-owner guard. *(5–6 fixes.)*
- **Wave 4 — Score/verdict integrity (Theme D).** `sanitizeGatePolicy`, `assembleReport` blend + failed-detector, `levelForScore` band boundaries, `computeWindowDeltas`, `buildExecBriefing`, `projectGoal`, `orgsim` axisScore. *(7 fixes, all pure/LLM-batchable, lowest risk.)*
- **Wave 5 — Frontend integrity + trust-boundary parsing (Themes E + F).** `/api/health` leak, `parseRepoUrl` SSRF, `parseScanReport` matrix, repo-report cross-repo identity, `mergeStars`, watch/schedule rollback, mock-vs-real gate. *(6–7 fixes; involves source extraction.)*
- **Wave 6 — Coverage ratchet + success-theater cleanup (Theme G + gate).** Add a per-area / changed-code coverage gate to CI; fix `init-sql.test.ts` inline-`@unique` parse; repair the stale "exercised by e2e" and removed-UI-string assertions; `checkAndAlertRegression` orchestrator test.
- **Waves 7–9 — High tier (76 Highs).** Same themes, second pass: token-mint/expiry-skew, error-branch coverage, CSV formula-injection / filename-injection, baseline-window math, etc.

## How this scan was run

- **Scanner:** `test_mastery` (`agent_test_mastery` v1.0.0) — risk-weighted coverage, suite-honesty, LLM-generatable batches, business quality gates.
- **Scope:** all 38 contexts across 9 groups (full-stack; ascent has no `src-tauri`). Target 5 findings/context.
- **Method:** 38 `general-purpose` subagents, one per context, batched in 5 waves of ≤8. Each read its context's files (+ sibling `.test.ts`) read-only and wrote one structured report. Orchestrator read only the terse replies, never the reports, during scanning.
- **Files read by scan subagents:** ~430 (avg ~11/context).
- **Baseline (pre-scan, unchanged by scan):** `tsc` 0 source errors (1 stale `.next/dev` artifact ignored); **509/509 tests passing** across 57 files.
- **Verification:** counts confirmed two ways — **192 `**Severity**` bullets = 192 `## N.` headings**; severity tally 60 C / 76 H / 40 M / 16 L = 192.
- **Pre-existing uncommitted work** (a `dev-inspector` feature: `README.md`, `next.config.ts`, `package.json`, `layout.tsx`, `src/app/_dev-inspector/`) was left untouched; any fix wave branches off `master` and commits only its own files.

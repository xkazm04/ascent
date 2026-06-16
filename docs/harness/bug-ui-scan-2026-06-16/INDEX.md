# Bug-Hunter + UI-Perfectionist Scan — ascent, 2026-06-16

> Combined reliability + UI/design audit of the entire ascent context map.
> 38 parallel subagent runs (one per context, carrying **both** lenses), batched in 5 waves of ≤8.
> Each context targeted ~5 combined findings, weighted to what the files actually are
> (backend/API contexts skew bug-hunter; component/page contexts skew ui-perfectionist).

Baseline at scan time: **`tsc` 0 errors · 465/465 tests pass · 55 test files.** A pristine
codebase — every finding below is a latent gap, not a present breakage.

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 38 contexts | 7 | 71 | 86 | 27 | **191** |
| Share | 3.7% | 37.2% | 45.0% | 14.1% | 100% |

Lens split: **130 bug-hunter / 61 ui-perfectionist.**
Counts verified two ways: sum of `> Total:` headers (191) == count of `- **Severity**:` bullets (191). ✓

---

## The 7 criticals — one line each

1. **Members & Access Control — Supabase-wall mode grants every signed-in viewer OWNER on every org.** In the documented production auth config (Supabase login on, custom GitHub OAuth dormant), `requireOrgRole` short-circuits to `return null` on `!isAuthConfigured()`, so any free-tier account gets owner-level member-admin on *every* tenant. Full cross-tenant takeover. `src/lib/authz.ts:132`
2. **Practices Apply — generated "starter" PR silently overwrites a repo's existing real file.** `openDraftPr` blind-`PUT`s a TODO scaffold over an existing `SECURITY.md` / `ci.yml` / `AGENTS.md`; merging the draft deletes the customer's real content, and a 25-repo batch fans it out fleet-wide from one click. `src/lib/github/write.ts:86-90`
3. **Data Retention & Purge — purge orphans `RecommendationEvent` rows forever.** `pruneRepoScans` never deletes the 3rd table in the Scan graph; under `relationMode="prisma"` (no DB cascade) every purge leaks permanent orphans, defeating the module's entire purpose. `src/lib/db/retention.ts:137-142`
4. **Scan Persistence — concurrent same-commit persist double-inserts.** Dedup is a non-atomic read-then-insert and `Scan` has only a plain index, no unique constraint — the cross-instance loser gets no `P2002` to recover from, so both rows commit (double dedup + double bill). `src/lib/db/scans-persist.ts:123-141`
5. **Database Client — DSQL-only cold start builds a Prisma client with no datasource URL.** The synchronous seed client is dead until the async IAM-token mint lands, so the first query on every freshly-thawed instance 500s. `src/lib/db/client.ts:296-327`
6. **Quotas — refund drops the *newest* hit, not the one this request charged.** Two concurrent refunds on a coalesced/degraded scan double-refund the same IP bucket, under-counting it and bypassing the free-scan budget. `src/lib/public-scan-quota.ts:259`
7. **CI Gate — default mock gate can return a stochastic LLM verdict from cache.** A gate meant to be deterministic reads the LLM cache entry first (`cacheGet(llmKey) ?? cacheGet(mockKey)`), so identical code can flip pass↔fail — a flaky merge gate. `src/app/api/gate/[owner]/[repo]/route.ts:55`

---

## Per-context breakdown

(Sorted by criticals desc, then total. C/H/M/L = Critical/High/Medium/Low.)

| # | Context | Group | C | H | M | L | Total | Report |
|---|---------|-------|--:|--:|--:|--:|------:|--------|
| 1 | CI Gate & Status Checks | Repository Scanning & Scoring | 1 | 3 | 1 | 0 | **5** | [ci-gate.md](ci-gate.md) |
| 2 | Data Retention & Purge | Data & Persistence | 1 | 2 | 2 | 0 | **5** | [data-retention-purge.md](data-retention-purge.md) |
| 3 | Database Client & Schema | Data & Persistence | 1 | 2 | 2 | 0 | **5** | [database-client-schema.md](database-client-schema.md) |
| 4 | Members & Access Control | Org Scanning & Fleet Rollups | 1 | 1 | 2 | 1 | **5** | [members-access-control.md](members-access-control.md) |
| 5 | Practices, Governance & Adoption | Org Dashboard & Analytics | 1 | 1 | 2 | 1 | **5** | [practices-governance-adoption.md](practices-governance-adoption.md) |
| 6 | Quotas & Rate Limiting | Billing, Credits & Metering | 1 | 2 | 1 | 1 | **5** | [quotas-rate-limiting.md](quotas-rate-limiting.md) |
| 7 | Scan Persistence & History | Data & Persistence | 1 | 3 | 1 | 0 | **5** | [scan-persistence-history.md](scan-persistence-history.md) |
| 8 | Security Posture & Audit Log | Org Dashboard & Analytics | 0 | 3 | 2 | 1 | **6** | [security-posture-audit.md](security-posture-audit.md) |
| 9 | AI-Native Standard & Onboarding Skill | Onboarding, Shell & AI Standard | 0 | 2 | 2 | 1 | **5** | [ai-standard-skill.md](ai-standard-skill.md) |
| 10 | App Shell, SEO & Error Pages | Onboarding, Shell & AI Standard | 0 | 1 | 2 | 2 | **5** | [app-shell-seo.md](app-shell-seo.md) |
| 11 | Backlog Management | Org Planning & Execution | 0 | 1 | 3 | 1 | **5** | [backlog-management.md](backlog-management.md) |
| 12 | Connect & Repo Selection | Onboarding, Shell & AI Standard | 0 | 2 | 2 | 1 | **5** | [connect-repo-selection.md](connect-repo-selection.md) |
| 13 | Credits & Entitlements | Billing, Credits & Metering | 0 | 3 | 1 | 1 | **5** | [credits-entitlements.md](credits-entitlements.md) |
| 14 | Executive Briefing | Org Planning & Execution | 0 | 2 | 2 | 1 | **5** | [executive-briefing.md](executive-briefing.md) |
| 15 | First-Run Onboarding Wizard | Onboarding, Shell & AI Standard | 0 | 2 | 2 | 1 | **5** | [onboarding-wizard.md](onboarding-wizard.md) |
| 16 | Fleet Alerts & Digests | Org Scanning & Fleet Rollups | 0 | 2 | 3 | 0 | **5** | [fleet-alerts-digests.md](fleet-alerts-digests.md) |
| 17 | Fleet Rollups & Insights | Org Scanning & Fleet Rollups | 0 | 2 | 3 | 0 | **5** | [fleet-rollups-insights.md](fleet-rollups-insights.md) |
| 18 | GitHub App Installation & Webhooks | Identity & GitHub Connectivity | 0 | 1 | 3 | 1 | **5** | [github-app-webhooks.md](github-app-webhooks.md) |
| 19 | GitHub OAuth & Session | Identity & GitHub Connectivity | 0 | 2 | 2 | 1 | **5** | [github-oauth-session.md](github-oauth-session.md) |
| 20 | GitHub Repo Data Access | Identity & GitHub Connectivity | 0 | 3 | 2 | 0 | **5** | [github-repo-data.md](github-repo-data.md) |
| 21 | Goals & Initiatives | Org Planning & Execution | 0 | 2 | 2 | 1 | **5** | [goals-initiatives.md](goals-initiatives.md) |
| 22 | Investment Simulator & Forecast | Org Planning & Execution | 0 | 2 | 2 | 1 | **5** | [investment-simulator.md](investment-simulator.md) |
| 23 | LLM Provider Abstraction | Repository Scanning & Scoring | 0 | 2 | 3 | 0 | **5** | [llm-provider.md](llm-provider.md) |
| 24 | Launch Fleet Map | Onboarding, Shell & AI Standard | 0 | 1 | 2 | 2 | **5** | [launch-fleet-map.md](launch-fleet-map.md) |
| 25 | Live War Room | Org Planning & Execution | 0 | 2 | 2 | 1 | **5** | [live-war-room.md](live-war-room.md) |
| 26 | Maturity Model & Scoring Engine | Repository Scanning & Scoring | 0 | 2 | 3 | 0 | **5** | [maturity-scoring.md](maturity-scoring.md) |
| 27 | Org Import, Scan & Watchlist | Org Scanning & Fleet Rollups | 0 | 2 | 3 | 0 | **5** | [org-import-scan-watchlist.md](org-import-scan-watchlist.md) |
| 28 | Org Overview & Standing | Org Dashboard & Analytics | 0 | 1 | 3 | 1 | **5** | [org-overview-standing.md](org-overview-standing.md) |
| 29 | PDF & LLM Export | Reporting & Visualization | 0 | 2 | 2 | 1 | **5** | [pdf-llm-export.md](pdf-llm-export.md) |
| 30 | People & Delivery Analytics | Org Dashboard & Analytics | 0 | 2 | 3 | 0 | **5** | [people-delivery-analytics.md](people-delivery-analytics.md) |
| 31 | Playbooks | Org Planning & Execution | 0 | 1 | 3 | 1 | **5** | [playbooks.md](playbooks.md) |
| 32 | Repo Report Shell & Tabs | Reporting & Visualization | 0 | 2 | 2 | 1 | **5** | [repo-report-shell.md](repo-report-shell.md) |
| 33 | Repositories & Segments | Org Dashboard & Analytics | 0 | 2 | 3 | 0 | **5** | [repositories-segments.md](repositories-segments.md) |
| 34 | Roadmap & Recommendation Tracking | Reporting & Visualization | 0 | 1 | 3 | 1 | **5** | [roadmap-recommendation.md](roadmap-recommendation.md) |
| 35 | Scan Pipeline & Ingestion | Repository Scanning & Scoring | 0 | 2 | 3 | 0 | **5** | [scan-pipeline.md](scan-pipeline.md) |
| 36 | Score Charts & Visuals | Reporting & Visualization | 0 | 2 | 2 | 1 | **5** | [score-charts-visuals.md](score-charts-visuals.md) |
| 37 | Trends & Comparison | Reporting & Visualization | 0 | 1 | 3 | 1 | **5** | [trends-comparison.md](trends-comparison.md) |
| 38 | Usage Metering & Public Badge | Billing, Credits & Metering | 0 | 2 | 2 | 1 | **5** | [usage-metering-badge.md](usage-metering-badge.md) |

---

## Triage themes

Clustered from the `Category` + title/scenario across all 191 findings. These are the mental models that make each one a *wave* rather than a pile of unrelated fixes.

| Theme | ~Count | C/H | Why it's a wave |
|---|---:|---|---|
| **A. Tenant isolation & authz** | ~14 | 1C / 5H | Org slug trusted from client; auth-config branches that fail *open*; public-org write exemption; phantom-org upserts. One mental model: every write must resolve org from the row and canonicalize the slug. |
| **B. Revenue integrity (credit/quota races)** | ~12 | 1C / 6H | Pay-then-debit, refund-newest-hit, no scan claim-lock, in-memory limiter resets. Reserve-then-refund + atomic ledger is the shared fix shape. |
| **C. Data integrity & concurrency** | ~10 | 2C / 4H | Read-then-insert dedup with no unique constraint, head-pointer-before-dedup, webhook replay, DSQL cold-start. DB-level constraints + transactions. |
| **D. Destructive ops (purge / PR-write)** | ~7 | 2C / 3H | Purge orphans + non-transactional delete loop; "apply" overwrites real files; 25-PR batch with no confirm. Highest blast radius. |
| **E. Silent failure / success-theater** | ~16 | 0C / 8H | Swallowed audit writes, mock-scored-as-real, "Now watching N" on all-failed, optimistic updates with no rollback. Surface the failure; don't lie. |
| **F. Scoring & gate correctness** | ~10 | 1C / 5H | Cross-mode cache read, NaN dimensions slip the floor, total-detector-failure → silent L1, simulator NaN no-op. Numeric trust boundaries in the math. |
| **G. Date / timezone / window math** | ~9 | 0C / 3H | UTC-offset vs local-midnight baselines, DST drift, overdue computed-once, digest window unreachable, range doesn't carry across tabs. One canonical window helper. |
| **H. PDF / SVG / file-gen robustness + injection** | ~11 | 0C / 6H | Unguarded `renderToBuffer`, `data:svg` badge XSS, Content-Disposition injection, SKILL.md fence collision. Escape + guard the generators. |
| **I. GitHub API resilience** | ~7 | 0C / 3H | No pagination/`Link` handling, 403/429 masked as "not found", PR page short-circuit. Rate-limit + pagination layer. |
| **J. Accessibility (a11y)** | ~16 | 0C / 4H | `role="img"` swallowing interactive subtrees, charts with no SR fallback, hue-only encoding, unlabeled controls, missing focus management. |
| **K. Missing UI states / consistency** | ~14 | 0C / 4H | Loading→loaded layout shift, empty-state dead-ends, projection scaling, no aria-live on async actions, cross-page inconsistency. |

(Themes A–F are bug-hunter-led; H–K are ui-perfectionist-led; G straddles both. Counts approximate — a few findings touch two themes.)

---

## Suggested next-phase split

Ordered by **risk × blast radius**, criticals first. Each wave is one sessionable mental model (~5–7 fixes). Waves 1–4 are the security/integrity core (all 7 criticals land here); 5–8 are correctness; 9–11 are UX/a11y polish.

**Wave 1 — Tenant isolation & auth (theme A)** — `members C` + `members slug-trust H` + `roadmap public-org PATCH H` + `oauth ASCENT_AUTH_BYPASS H` + `members last-owner race M` + `members phantom-user upsert M`. *The cross-tenant takeover headline.*

**Wave 2 — Revenue integrity (theme B)** — `quotas double-refund C` + `scan-pipeline coalesced double-refund H` + `credits pay-then-debit H` + `org-scan no-claim-lock H` + `credits negative-grant ledger H` + `rate-limit XFF spoof / in-memory reset H`.

**Wave 3 — Data integrity & concurrency (theme C)** — `scan-persistence double-insert C` + `db DSQL cold-start C` + `scan-persistence head-pointer-before-dedup H` + `webhooks replay/process-local dedup H` + `db findScanByScannedAt dup M` + `db missing rollup index H`.

**Wave 4 — Destructive ops (theme D)** — `practices overwrite C` + `retention orphans C` + `retention non-transactional delete H` + `retention trusts scannedAt H` + `practices reused-branch ignores base H` + `practices 25-PR batch no-confirm M`.

**Wave 5 — Silent failure / success-theater (theme E)** — `audit-write dropped H` + `llm mock-as-real H` + `maturity total-failure→L1 H` + `connect bulk all-failed H` + `playbooks optimistic-swallow H` + `onboarding error-stranded H` + `health DB-error leak H`.

**Wave 6 — Scoring & gate correctness (theme F)** — `ci-gate cross-mode cache C` + `ci-gate min_security-disables-floor H` + `ci-gate NaN-slips-floor H` + `ci-gate no-gaps crash H` + `maturity dimension-vanishes-from-mean H` + `simulator NaN no-op H`.

**Wave 7 — Date / timezone / window math (theme G)** — `fleet-rollups UTC-vs-local windows H` + `fleet-rollups movers-degrade H` + `fleet-alerts digest-window-unreachable H` + `org-overview range-doesnt-carry H` + `fleet-rollups boundary-double-count M` + `backlog overdue-frozen M`.

**Wave 8 — File-gen robustness + injection (theme H)** — `badge data:svg XSS H` + `badge public-cache-on-error H` + `pdf renderToBuffer-unguarded H` + `pdf Content-Disposition-inject H` + `executive PDF-500 H` + `skill fence-collision H` + `skill Content-Disposition H`.

**Wave 9 — GitHub API resilience (theme I)** — `repo-data org-under-returns/no-pagination H` + `repo-data non-404-masks-ratelimit H` + `repo-data governance-vanishes-on-429 H` + `repo-data PR-page-short-circuit M` + `security dependabot-capped-100 M` + `webhooks body-size-guard M`.

**Wave 10 — Accessibility (theme J)** — `launch role=img-swallows-links H` + `charts PostureQuadrant no-SR H` + `charts RadarChart hue-only H` + `people-delivery tables-no-a11y H` + `repo-report dangling-aria-controls M` + a batch of unlabeled-control lows.

**Wave 11 — UI states & consistency (theme K)** — `live-war-room projection-scaling H` + `live-war-room posture-bar-misscale H` + `connect empty-filter-dead-end M` + `repo-report skeleton-layout-shift M` + `people-delivery uneven-empty-states M` + remaining UX mediums.

After Wave 4 the product is materially safer (no cross-tenant takeover, no silent overbilling, no data corruption, no destructive overwrites). Waves 5–8 remove the "looks fine but lies" class. Waves 9–11 are quality/polish and can be deferred or compressed.

---

## How this scan was run

- **Scanners:** `bug-hunter` (🐛 elite systems-failure analyst) + `ui-perfectionist` (🎨 design/component reviewer), from `vibeman/src/lib/prompts/registry/agents/`. Both lenses carried by a *single* subagent per context (combined output), weighted to the context's actual file mix.
- **Scope:** all 38 contexts of the ascent context map (345 referenced files). Next.js project → client + API routes scanned together (no `src-tauri/`).
- **Method:** 38 read-only `general-purpose` subagents in 5 waves of ≤8. Each read its context's source files under `C:/Users/kazda/kiro/ascent`, wrote one structured report here, and replied with terse stats only — the orchestrator never read the full reports during scanning (keeps 38 scans in one session).
- **Target per context:** ~5 combined findings (4–6 allowed), no padding — several subagents explicitly documented well-hardened areas they *didn't* flag (webhook signature verification, forecast edge-guards, custom-OAuth CSRF, chart NaN guards).
- **Files read by scan:** ~360 (≈9–10 per subagent including cross-reference reads).
- **Verification:** finding count confirmed two ways — Σ `> Total:` headers (191) == Σ `- **Severity**:` bullets (191). ✓
- **Baseline:** `tsc` 0 errors, 465/465 tests, 55 files — captured before any fix wave for the regression gate.

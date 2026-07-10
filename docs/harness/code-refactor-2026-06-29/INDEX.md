# Code Refactor Scan — ascent, 2026-06-29

> Cleanup / dead-code / duplication / structure audit across all 44 contexts.
> 44 parallel subagent runs, batched in 6 waves of ≤8. Read-only scan on an isolated
> worktree (`vibeman/code-refactor-2026-06-29`) branched off HEAD `c8e04c3`, so master's
> uncommitted WIP was untouched. Scanner: `code_refactor` (agent_code_refactor).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 44 contexts | 0 | 35 | 98 | 70 | **203** |
| Share | 0% | 17% | 48% | 35% | 100% |

Verified two ways (header sum == severity-bullet count == 203, 0 mismatches).

### Category distribution

| Category | Count | Share |
|---|---:|---:|
| duplication | 152 | 75% |
| dead-code | 19 | 9% |
| structure | 18 | 9% |
| cleanup | 8 | 4% |
| naming | 6 | 3% |

**This scan is duplication-dominated.** The single highest-leverage move is to extract a
small set of shared helpers and adopt them across the many copy-paste sites — most Highs
and Mediums collapse into ~10 consolidation waves.

---

## Per-context breakdown

(Sorted by High desc, then total desc.)

| Context | C | H | M | L | Total |
|---|--:|--:|--:|--:|--:|
| Design System: UI Primitives & Deck | 0 | 2 | 1 | 2 | 5 |
| Executive Briefing | 0 | 2 | 2 | 1 | 5 |
| Org Import, Scan & Watchlist | 0 | 2 | 2 | 1 | 5 |
| Repositories & Segments | 0 | 2 | 2 | 1 | 5 |
| Database Client & Schema | 0 | 2 | 1 | 1 | 4 |
| Security Posture & Audit Log | 0 | 2 | 1 | 1 | 4 |
| Backlog Management | 0 | 1 | 2 | 2 | 5 |
| Fleet Alerts & Digests | 0 | 1 | 2 | 2 | 5 |
| Fleet Rollups & Insights | 0 | 1 | 3 | 1 | 5 |
| GitHub App Installation & Webhooks | 0 | 1 | 3 | 1 | 5 |
| GitHub Repo Data Access | 0 | 1 | 2 | 2 | 5 |
| Goals & Initiatives | 0 | 1 | 3 | 1 | 5 |
| LLM Provider Abstraction | 0 | 1 | 2 | 2 | 5 |
| Members & Access Control | 0 | 1 | 3 | 1 | 5 |
| Practices, Governance & Adoption | 0 | 1 | 2 | 2 | 5 |
| Quotas & Rate Limiting | 0 | 1 | 3 | 1 | 5 |
| Repo Report Shell & Tabs | 0 | 1 | 2 | 2 | 5 |
| Scan Pipeline & Ingestion | 0 | 1 | 4 | 0 | 5 |
| Score Charts & Visuals | 0 | 1 | 2 | 2 | 5 |
| CI Gate & Status Checks | 0 | 1 | 2 | 1 | 4 |
| Investment Simulator & Forecast | 0 | 1 | 2 | 1 | 4 |
| Live War Room | 0 | 1 | 2 | 1 | 4 |
| Marketing About Page | 0 | 1 | 2 | 1 | 4 |
| Maturity Model & Scoring Engine | 0 | 1 | 2 | 1 | 4 |
| Org Branding & White-label | 0 | 1 | 1 | 2 | 4 |
| PDF & LLM Export | 0 | 1 | 2 | 1 | 4 |
| Playbooks | 0 | 1 | 2 | 1 | 4 |
| Scan Persistence & History | 0 | 1 | 2 | 1 | 4 |
| Data Retention & Purge | 0 | 1 | 1 | 1 | 3 |
| AI-Native Standard & Onboarding Skill | 0 | 0 | 2 | 3 | 5 |
| App Shell, SEO & Error Pages | 0 | 0 | 3 | 2 | 5 |
| Checkout & Plans (Polar) | 0 | 0 | 3 | 2 | 5 |
| Connect & Repo Selection | 0 | 0 | 2 | 3 | 5 |
| Credits & Entitlements | 0 | 0 | 3 | 2 | 5 |
| First-Run Onboarding Wizard | 0 | 0 | 3 | 2 | 5 |
| Landing Page Prototypes | 0 | 0 | 2 | 3 | 5 |
| Org Overview & Standing | 0 | 0 | 4 | 1 | 5 |
| Roadmap & Recommendation Tracking | 0 | 0 | 3 | 2 | 5 |
| Trends & Comparison | 0 | 0 | 2 | 3 | 5 |
| Usage Metering & Public Badge | 0 | 0 | 3 | 2 | 5 |
| Dev Inspector | 0 | 0 | 1 | 3 | 4 |
| GitHub OAuth & Session | 0 | 0 | 3 | 1 | 4 |
| Launch Fleet Map | 0 | 0 | 3 | 1 | 4 |
| People & Delivery Analytics | 0 | 0 | 1 | 3 | 4 |

---

## All 35 High findings — grouped by theme

### A. Cross-cutting route-guard duplication (security-sensitive)
1. **CRON_SECRET fail-closed gate triplicated** across `cron/purge`, `cron/digest`, `cron/rescan` — identical ~12-line block (+ comment); already fail-opened once historically. `cron/purge/route.ts:17-28` (data-retention #1, fleet-alerts #1, org-import #2)
2. **`isSameOrigin` CSRF guard reimplemented locally** in `/api/org/active` instead of importing canonical `lib/auth.ts:385`; the copy already drifted. `org/active/route.ts:19-31` (org-import #1)
3. **Owner-gated same-origin POST preamble copy-pasted across ~8 org routes** (same-origin → body → org → `requireOrgRole(owner)`). `org/branding/route.ts:15-21` (org-branding #1)
4. **PR-write auth/install/token preamble + catch-block mapping duplicated across 4 "open a draft PR" routes** (practices apply, apply-batch, playbooks apply, passport/pr); already drifting (playbooks omits the 409 branch). (playbooks #1, practices #1)
5. **`recordOrgAudit` "resolve orgId then audit" tail re-rolled in ~13 routes** while only 3 use the helper; invite routes hand-roll it. `scans-audit.ts:57-65` canonical (security-audit #2, members #1)
6. **Four goals/initiatives CRUD route handlers re-state the same preamble** (503 db-guard ×4, GET-list shape ×2, targetDate ISO-validation ×2, already drifted off initiatives). (goals #1)

### B. Org-id resolution duplication (db layer)
7. **Org-slug→id resolution duplicated ~35× across the db layer** — 3 private `resolveOrgId` copies (segments/plan/scans-shared) + ~30 inline `organization.findUnique({where:{slug}})`, despite canonical `getOrgId` (`org-rollup.ts:34`); copies drift on normalization + db-guard. (database #1)
8. **Rollup family bypasses the canonical resolver** across org-rollup/insights/signals/contributors/teams. (fleet-rollups #1)
9. **`resolveOrgId` re-implemented in `segments.ts`** (6 call sites) + inlined in `tech-groups.ts`. (repositories-segments #2)
10. **Org-resolve → repo-findUnique → null-guard (tenant-scope) boilerplate repeated across 6 read fns** in `scans-read.ts` → extract `resolveScopedRepo`. (scan-persistence #1)

### C. PDF document theme triplication
11/12/13. **PDF scaffolding (palette, `scoreColor`, base StyleSheet, `Stat`, footer) triplicated across all three `lib/pdf/*-document.tsx`** (~70–80 lines) → `src/lib/pdf/theme.ts`. Confirmed by 3 independent contexts. (executive #1, pdf-export #1, security-audit #1)

### D. Signed share-token (HMAC) duplication
14/15. **HMAC sign/verify share-token flow near-duplicated** between `briefing-share.ts` and `live-share.ts` (identical `sign()`, env-fallback secret, timing-safe verify, base64url) → shared `signed-share` codec. (executive #2, live-war-room #1)

### E. SSE parse/consume fragmentation
16/17. **SSE consumption fragmented across 4 implementations** — two `parseSSE` (the "shared" `lib/sse.ts` copy corrupts multi-line JSON; the `ReportClientStatus` copy is correct) + three reader/drain loops (`sse.readSSE`, `useReportScan`, `importScan`). Consolidate onto a fixed `lib/sse.ts`. (scan-pipeline #1, repo-report-shell #1)

### F. GitHub I/O duplication
18. **Four divergent "GET JSON from GitHub" helpers**; two (`discover`, `list`) bypass `fetchWithTimeout`. → one `ghGetJson`. (github-repo-data #1)
19. **Local `publicBase()` duplicates & lags canonical `publicBaseUrl()`** (`@/lib/site`) — twins in webhook route + scan-alerts + digest route, missing the Vercel fallback. (github-app #1; also fleet-alerts M)

### G. Scoring / single-source-of-truth drift
20. **`recomputeRepo` re-implements the headline `overallScoreFor`** inline → simulator can silently diverge from the live engine. (investment-simulator #1)
21. **AI tool-name vocabulary duplicated & drifting across 3 files** (`pulls.ts`, `analyze/index.ts`, `passport.ts`). (maturity-model #1)
22. **`GatePolicy` representation projected by 4 hand-synced functions, already drifted** (`policyBits`/`policyText`/`gateQuery`/`ciWith`) — PR-comment footer omits the D9 floor the gate enforces. (ci-gate #1; practices governance M)

### H. Shared UI component duplication
23. **Canonical `Stat` atom re-implemented inline ×5** (usage, BacklogSummary, FleetMapChrome, LiveWarRoomStat, AboutHero). (design-system #2)
24. **Canonical `DeltaTag` signed-delta vocabulary reimplemented inline** in DimensionCard/chartHover/ScoreWaterfall. (score-charts #1)
25. **Recommendation-status edit UI + plumbing duplicated** between Backlog components and `RecommendationTracker` → `StatusSelect` + `useSavingIds` hook. (backlog #1)
26. **A-vs-B comparison UI cloned wholesale** between Segments and Tech-stacks pages (~55-line block + `MetricRow`/`first()`). (repositories-segments #1)
27. **Deck-section shell + container className copy-pasted across ~11 files** (5 About + ~6 landing-prototype) despite `components/deck/` → extract `DeckSection`. (marketing-about #1; landing-prototypes M)

### I. LLM provider epilogue
28. **"empty-check → parse → validate → meter usage" epilogue repeated across every provider** (gemini/openai/bedrock/claude-cli) → one `finalizeAssessment` helper. (llm-provider #1)

### J. Dead exported surface
29. **`toneFor` is fully dead** — defined in `format.ts`, re-exported twice, zero call sites. (design-system #1)
30. **`db/index.ts` barrel re-exports ~78 of 252 symbols** that nothing imports via the barrel (retention 8/9, sessions 2/2, client 6/11 — consumed only via direct paths). (database #2)

---

## Triage themes

| # | Theme | Approx items (H+M+L) | Why this is a wave |
|---|---|---:|---|
| A | Cross-cutting route guards (cron-auth, CSRF/owner POST, PR-write, audit, CRUD preamble) | ~16 | One mental model (shared route helpers); security-sensitive; kills drift |
| B | Org-id resolution + tenant-scope helpers (`getOrgId`, `resolveScopedRepo`) | ~12 | ~35 copy sites collapse to one resolver; touches the whole db layer |
| C | PDF theme module (`lib/pdf/theme.ts`) + PDF route preamble | ~6 | 3 docs share ~80 lines; one extraction |
| D | Signed share-token codec (briefing/live HMAC) | ~4 | Security-sensitive crypto in two files |
| E | SSE parse/consume consolidation onto `lib/sse.ts` | ~4 | Correctness-relevant (the shared copy is the buggy one) |
| F | GitHub I/O (`ghGetJson`, `publicBaseUrl`, path encoder) | ~8 | One canonical HTTP helper family in `lib/github` |
| G | Scoring single-source (`overallScoreFor`, AI-vocab, GatePolicy) | ~6 | Prevents headline/score divergence |
| H | Shared UI primitives (`Stat`, `DeltaTag`, `StatusSelect`/`useSavingIds`, `DeckSection`, comparison view, MeterRow, ScopeFilterBar adoption) | ~30 | The biggest bucket; mechanical adoption of existing atoms |
| I | Dead code & barrel prune (`toneFor`, db barrel, dead fields/exports, unreachable branches) | ~19 | Pure deletion; lowest risk |
| J | Small dups & cleanup (date formatters, magic constants, stale comments, naming) | ~20 | Quick mop-up |

(Counts include the Medium/Low tail that shares each theme; exact membership resolved per wave.)

---

## Suggested fix-wave split

Each wave = one mental model, ~5–7 findings, atomic commits + tsc/vitest verification.

- **Wave 1 — Route guards (Theme A).** `requireCronAuth` (cron ×3), adopt canonical `isSameOrigin`, `requireOwnerOrgPost`, `requirePrWriteContext`+`mapPrWriteError`. *(security-sensitive — highest value)*
- **Wave 2 — Org-id resolution (Theme B).** Adopt `getOrgId`; remove the 3 private `resolveOrgId` + hottest inline lookups; `resolveScopedRepo`; `recordOrgAudit` adoption. *(large — may split into 2 sub-waves)*
- **Wave 3 — PDF theme + share-token (C+D).** `lib/pdf/theme.ts`, PDF route preamble, shared `signed-share` codec.
- **Wave 4 — SSE + GitHub I/O (E+F).** Fix `lib/sse.ts` parseSSE & collapse the consumers; `ghGetJson`; `publicBaseUrl` adoption; path-segment encoder.
- **Wave 5 — Scoring single-source (G).** `overallScoreFor`, AI-vocab, `GatePolicy` representation.
- **Wave 6 — Shared UI primitives (H).** `Stat`/`DeltaTag`/`StatusSelect`+`useSavingIds`/`DeckSection`/comparison-view adoption.
- **Wave 7 — Dead code & barrel prune (I).** `toneFor`, db barrel, dead exports/fields, unreachable branches.
- **Waves 8+ — Medium/Low tail (J + remaining per-theme Mediums).** Mop-up by area.

---

## Context-map drift discovered during the scan

Several files listed in the context map no longer exist on disk (note for a `refresh_context` pass):
- `src/components/landing/ScanGallery.tsx` (Scan Pipeline) — landing gallery is `IndexGallery.tsx`
- `src/components/landing/prototypes/index/EditorialSteps.tsx` (Landing Prototypes) — absent
- `src/components/report/RoadmapPanel.tsx` (Roadmap) — actual is `roadmapPieces.tsx`
- `src/components/report/ReportTabBar.tsx`, `src/components/report/ReportSkeleton.tsx` (Repo Report Shell) — tab switcher migrated to `SideNav`

---

## How this scan was run

- **Scanner**: `code_refactor` (agent_code_refactor) from Vibeman's prompt registry; per-context subagents prompted to flag only dead-code / duplication / structure / cleanup / naming, with a hard "grep the whole repo before declaring anything dead" certainty rule.
- **Scope**: all 44 contexts (460 file refs), full-stack TS (ascent has no `src-tauri/`); target ~5 findings/context.
- **Isolation**: worktree `C:/Users/kazda/kiro/ascent-cr-2026-06-29` off HEAD `c8e04c3`, branch `vibeman/code-refactor-2026-06-29`; `node_modules` junctioned for tsc/vitest. Master's WIP untouched.
- **Baseline**: tsc 0 errors · vitest 2630/2630 passing (170 files).
- **Method**: 6 waves of ≤8 parallel subagents; orchestrator read only terse replies. Each report at `docs/harness/code-refactor-2026-06-29/<slug>.md`.
- **Verification**: findings counted two ways (header `> Total:` sum == `- **Severity**:` bullet count == 203, 0 discrepancies).
- **Prior run**: the 2026-06-23 `code_refactor` run (155/159 closed) is already merged to master; subagents confirmed prior findings fixed and surfaced fresh ones.

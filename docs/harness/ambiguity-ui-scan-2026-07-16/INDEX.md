# Ambiguity-Guardian + UI-Perfectionist Scan — ascent, 2026-07-16

> Combined clarity/trade-off + visual/UX audit: 44 contexts × exactly 5 findings each.
> 44 parallel subagent runs (rolling waves of ≤8); baseline tsc 0 · vitest 3504/3504.
> Scanned the working tree as-is (master had uncommitted user WIP in ~14 files).

---

## Totals

| | Critical | High | Medium | Low | **Total** |
|---|---:|---:|---:|---:|---:|
| Across 44 contexts | 0 | 66 | 118 | 36 | **220** |
| Share | 0% | 30% | 54% | 16% | 100% |

Verified two ways: header sums = severity-bullet count = 220.

Category distribution: edge-case-gap 51 · undocumented-assumption 45 · trade-off-undocumented 29 · missing-state 25 · a11y 22 · magic-number 21 · visual-inconsistency 15 · component-extraction 8 · other 4.

---

## Per-context breakdown

(Sorted by High count, then total. Every context returned exactly 5.)

| # | Context | Critical | High | Medium | Low | Total | Report |
|---|---|---:|---:|---:|---:|---:|---|
| 1 | GitHub App Installation & Webhooks | 0 | 3 | 2 | 0 | 5 | [github-app-installation-webhooks.md](./github-app-installation-webhooks.md) |
| 2 | AI-Native Standard & Onboarding Skill | 0 | 2 | 2 | 1 | 5 | [ai-native-standard-onboarding-skill.md](./ai-native-standard-onboarding-skill.md) |
| 3 | Checkout & Plans (Polar) | 0 | 2 | 3 | 0 | 5 | [checkout-plans-polar.md](./checkout-plans-polar.md) |
| 4 | CI Gate & Status Checks | 0 | 2 | 2 | 1 | 5 | [ci-gate-status-checks.md](./ci-gate-status-checks.md) |
| 5 | Connect & Repo Selection | 0 | 2 | 2 | 1 | 5 | [connect-repo-selection.md](./connect-repo-selection.md) |
| 6 | Data Retention & Purge | 0 | 2 | 2 | 1 | 5 | [data-retention-purge.md](./data-retention-purge.md) |
| 7 | Executive Briefing | 0 | 2 | 3 | 0 | 5 | [executive-briefing.md](./executive-briefing.md) |
| 8 | Fleet Rollups & Insights | 0 | 2 | 3 | 0 | 5 | [fleet-rollups-insights.md](./fleet-rollups-insights.md) |
| 9 | GitHub OAuth & Session | 0 | 2 | 2 | 1 | 5 | [github-oauth-session.md](./github-oauth-session.md) |
| 10 | GitHub Repo Data Access | 0 | 2 | 2 | 1 | 5 | [github-repo-data-access.md](./github-repo-data-access.md) |
| 11 | Goals & Initiatives | 0 | 2 | 3 | 0 | 5 | [goals-initiatives.md](./goals-initiatives.md) |
| 12 | Investment Simulator & Forecast | 0 | 2 | 2 | 1 | 5 | [investment-simulator-forecast.md](./investment-simulator-forecast.md) |
| 13 | Marketing About Page | 0 | 2 | 3 | 0 | 5 | [marketing-about-page.md](./marketing-about-page.md) |
| 14 | Maturity Model & Scoring Engine | 0 | 2 | 3 | 0 | 5 | [maturity-model-scoring-engine.md](./maturity-model-scoring-engine.md) |
| 15 | Members & Access Control | 0 | 2 | 2 | 1 | 5 | [members-access-control.md](./members-access-control.md) |
| 16 | Org Branding & White-label | 0 | 2 | 2 | 1 | 5 | [org-branding-white-label.md](./org-branding-white-label.md) |
| 17 | PDF & LLM Export | 0 | 2 | 2 | 1 | 5 | [pdf-llm-export.md](./pdf-llm-export.md) |
| 18 | Practices, Governance & Adoption | 0 | 2 | 2 | 1 | 5 | [practices-governance-adoption.md](./practices-governance-adoption.md) |
| 19 | Roadmap & Recommendation Tracking | 0 | 2 | 2 | 1 | 5 | [roadmap-recommendation-tracking.md](./roadmap-recommendation-tracking.md) |
| 20 | Score Charts & Visuals | 0 | 2 | 3 | 0 | 5 | [score-charts-visuals.md](./score-charts-visuals.md) |
| 21 | Security Posture & Audit Log | 0 | 2 | 2 | 1 | 5 | [security-posture-audit-log.md](./security-posture-audit-log.md) |
| 22 | App Shell, SEO & Error Pages | 0 | 1 | 3 | 1 | 5 | [app-shell-seo-error-pages.md](./app-shell-seo-error-pages.md) |
| 23 | Backlog Management | 0 | 1 | 3 | 1 | 5 | [backlog-management.md](./backlog-management.md) |
| 24 | Credits & Entitlements | 0 | 1 | 3 | 1 | 5 | [credits-entitlements.md](./credits-entitlements.md) |
| 25 | Database Client & Schema | 0 | 1 | 3 | 1 | 5 | [database-client-schema.md](./database-client-schema.md) |
| 26 | Design System: UI Primitives & Deck | 0 | 1 | 3 | 1 | 5 | [design-system-ui-primitives-deck.md](./design-system-ui-primitives-deck.md) |
| 27 | Dev Inspector | 0 | 1 | 3 | 1 | 5 | [dev-inspector.md](./dev-inspector.md) |
| 28 | First-Run Onboarding Wizard | 0 | 1 | 3 | 1 | 5 | [first-run-onboarding-wizard.md](./first-run-onboarding-wizard.md) |
| 29 | Fleet Alerts & Digests | 0 | 1 | 3 | 1 | 5 | [fleet-alerts-digests.md](./fleet-alerts-digests.md) |
| 30 | Landing Page Prototypes | 0 | 1 | 3 | 1 | 5 | [landing-page-prototypes.md](./landing-page-prototypes.md) |
| 31 | Launch Fleet Map | 0 | 1 | 3 | 1 | 5 | [launch-fleet-map.md](./launch-fleet-map.md) |
| 32 | Live War Room | 0 | 1 | 3 | 1 | 5 | [live-war-room.md](./live-war-room.md) |
| 33 | LLM Provider Abstraction | 0 | 1 | 3 | 1 | 5 | [llm-provider-abstraction.md](./llm-provider-abstraction.md) |
| 34 | Org Import, Scan & Watchlist | 0 | 1 | 3 | 1 | 5 | [org-import-scan-watchlist.md](./org-import-scan-watchlist.md) |
| 35 | Org Overview & Standing | 0 | 1 | 3 | 1 | 5 | [org-overview-standing.md](./org-overview-standing.md) |
| 36 | People & Delivery Analytics | 0 | 1 | 3 | 1 | 5 | [people-delivery-analytics.md](./people-delivery-analytics.md) |
| 37 | Playbooks | 0 | 1 | 3 | 1 | 5 | [playbooks.md](./playbooks.md) |
| 38 | Quotas & Rate Limiting | 0 | 1 | 3 | 1 | 5 | [quotas-rate-limiting.md](./quotas-rate-limiting.md) |
| 39 | Repo Report Shell & Tabs | 0 | 1 | 3 | 1 | 5 | [repo-report-shell-tabs.md](./repo-report-shell-tabs.md) |
| 40 | Repositories & Segments | 0 | 1 | 3 | 1 | 5 | [repositories-segments.md](./repositories-segments.md) |
| 41 | Scan Persistence & History | 0 | 1 | 3 | 1 | 5 | [scan-persistence-history.md](./scan-persistence-history.md) |
| 42 | Scan Pipeline & Ingestion | 0 | 1 | 3 | 1 | 5 | [scan-pipeline-ingestion.md](./scan-pipeline-ingestion.md) |
| 43 | Trends & Comparison | 0 | 1 | 3 | 1 | 5 | [trends-comparison.md](./trends-comparison.md) |
| 44 | Usage Metering & Public Badge | 0 | 1 | 3 | 1 | 5 | [usage-metering-public-badge.md](./usage-metering-public-badge.md) |

---

## All 66 High findings — one-liners, grouped into themes

Notation: `report-slug#N` — read the full entry in that per-context report.

### A. Gate & verdict integrity (the product's core promise) — 6
1. **ci-gate-status-checks#1** — any single gate query param silently discards the ENTIRE persisted org policy; anonymous callers can weaken the org bar. `api/gate/[owner]/[repo]/route.ts:129`
2. **ci-gate-status-checks#2** — fail-closed only covers dimension floors; minOverall/minLevel fail OPEN on non-finite score. `scoring/gate.ts:219-223`
3. **github-app-installation-webhooks#3** — fork-PR fallback posts a default-branch verdict as the PR's required check with no signal it never scored the PR. `api/app/webhook/route.ts:247-287`
4. **usage-metering-public-badge#1** — README gate badge evaluates an undisclosed default policy the maintainer never chose. `badge/BadgeGenerator.tsx:51`
5. **maturity-model-scoring-engine#1** — published methodology doc no longer matches the engine's real math (doc-drift on a "transparent, defensible" rubric). `docs/MATURITY_MODEL.md:135` vs `scoring/engine.ts:80`
6. **maturity-model-scoring-engine#2** — `reviewedRate` has no minimum-sample floor; one unreviewed PR drags D6. `analyze/pulls.ts:133,179`

### B. Silent scope-widening / tenancy & privacy leaks — 6
7. **executive-briefing#1** — deleted/failed `?stack=` scope fails open: scoped share link/PDF renders the WHOLE org. `share/briefing/[token]/page.tsx:94`
8. **pdf-llm-export#2** — unknown segment id silently exports the ENTIRE fleet. `api/org/export/route.ts:34`
9. **scan-persistence-history#1** — `getLatestRecommendations` is a fourth public-org reader missing the private-repo guard; anonymous roadmap/assignee leak. `db/scans-read.ts:709-713`
10. **practices-governance-adoption#1** — Copy-for-LLM adoption brief names individuals, bypassing the CHAMPION_MIN_POP privacy guard the page enforces. `org/adoption.ts:180`
11. **practices-governance-adoption#2** — practice-preview route falls back to operator PAT for non-installed owners → anonymous private-repo probe. `api/practices/generate/route.ts:33-51`
12. **fleet-rollups-insights#1** — plan retention floor clamps the trend but not baseline/movers; deltas read history the tier doesn't buy. `db/org-rollup.ts:396` vs `:441`

### C. Money & billing correctness — 5
13. **checkout-plans-polar#1** — `?credits=pending|error` post-checkout param consumed by no UI; buyer gets zero feedback after paying. `api/billing/checkout/route.ts:96`
14. **checkout-plans-polar#2** — refund fraction mixes denominators; partial/$0-order refund can wrongly revoke a paid tier. `api/billing/webhook/route.ts:192-212`
15. **credits-entitlements#1** — credits chip self-heals balance but freezes `allowanceRemaining` at SSR; money-facing state wrong all session. `shared/CreditsControl.tsx:98`
16. **org-import-scan-watchlist#1** — import path ignores BYOM: charges platform credits AND runs platform inference for own-Bedrock orgs. `api/org/import/route.ts:141,146`
17. **first-run-onboarding-wizard#1** — transient credit-read failure silently downgrades a paying org's first scan to a mock preview with misleading copy. `onboarding/useOnboardingFlow.ts:179`

### D. Silent fallback / swallowed errors on data paths — 6
18. **llm-provider-abstraction#1** — typo'd LLM_PROVIDER coerces to "auto", routing enterprise-privacy scans to Gemini/mock. `llm/index.ts:66`
19. **fleet-alerts-digests#1** — transient DB error misroutes a tenant digest to the operator's global sink and burns the at-most-once window. `api/cron/digest/route.ts:119`
20. **github-repo-data-access#1** — rulesets read failure reports "no rules" with `readable: true`, false-negating 6 governance signals. `github/governance.ts:61`
21. **github-repo-data-access#2** — GraphQL layer has no rate-limit/error taxonomy; rate-limited scan indistinguishable from partial data. `github/graphql.ts:69-86`
22. **scan-pipeline-ingestion#1** — signed-in users' custom notify email passes validation then is silently dropped server-side; promised email never sends. `ScanForm.tsx:131-144`
23. **launch-fleet-map#1** — a scan streaming zero applicable events ends completely silently (no outcome, no error). `launch/FleetMap.tsx:88`

### E. Dormant-auth remnants (known cluster, still rotting) — 4
24. **github-oauth-session#1** — `/api/auth/session` answers only for the dormant stack; always "signed out" in prod. `api/auth/session/route.ts:19`
25. **github-oauth-session#2** — Supabase `?auth_error=1` is rendered nowhere; silent sign-in dead-end. `auth/callback/route.ts:35`
26. **members-access-control#1** — members page derives `selfLogin` from dormant `getSession()`; self-demotion guard dead in prod (owner lockout). `org/[slug]/members/page.tsx:28`
27. **members-access-control#2** — accepting an invite silently DOWNGRADES an existing higher-role member. `db/invites.ts:172`

### F. API contract & validation holes — 7
28. **goals-initiatives#1** — goal PATCH accepts any `status` string; vocabulary undocumented and inconsistent. `api/org/goals/[id]/route.ts:46`
29. **goals-initiatives#2** — removing an achieved goal skips the delete confirmation the active path requires. `plan/GoalsPanel.tsx:180`
30. **playbooks#1** — PATCH lets a member blank a playbook title (no validation parity with POST); corrupts cards/PR titles/branch slugs. `api/org/playbooks/[id]/route.ts:35`
31. **roadmap-recommendation-tracking#1** — `note` has no contract: note-only PATCH rejected; note on a no-op patch silently discarded with 200. `api/recommendations/[id]/route.ts:100`
32. **backlog-management#1** — promote-to-initiative dedupe is client-session-only; reload/second user creates duplicates. `backlog/BacklogItemRow.tsx:103-121`
33. **ai-native-standard-onboarding-skill#2** — conformance ingest drops `headSha`; stale CI re-runs clobber the newest score. `api/report/conformance/route.ts:60`
34. **github-app-installation-webhooks#1** — installing the App silently mints a `private`-plan org row (undocumented entitlement grant). `db/installations.ts:23`

### G. Stale-view & invalidation UI correctness — 6
35. **investment-simulator-forecast#1** — "Top moves" ranking never invalidated when scope/target change; leadership acts on the wrong slice. `plan/Simulator.tsx:89-111`
36. **investment-simulator-forecast#2** — track-as-initiative loops over multi-leg while the button forbids it; non-atomic loop. `plan/Simulator.tsx:157-188`
37. **repositories-segments#1** — leaderboard bulk-selection survives filter changes; "Add to segment" tags repos the user can't see. `repositories/RepoLeaderboard.tsx:51`
38. **trends-comparison#1** — Swap button can never work: server time-inversion guard silently rewrites every swapped pair. `ScanComparePicker.tsx:69` + `db/scans-read.ts:470-480`
39. **repo-report-shell-tabs#1** — cold-scan gate drops the pinned `@sha`; "Scan now" scores HEAD under a commit-pinned URL (WIP-flagged). `report/[owner]/[repo]/page.tsx:111`
40. **executive-briefing#2** — share button reports "Link copied" even when the clipboard write failed. `executive/BriefingShareButton.tsx:40-45`

### H. Broken / dead UX surfaces — 4
41. **people-delivery-analytics#1** — Export CSV is a dead 404 URL on all three pages (backslashes in a template literal). `org/shared/ui.tsx:289`
42. **pdf-llm-export#1** — PDF export anchors have no loading/error UX; failures navigate onto raw JSON. `report/ReportHeader.tsx:93`
43. **live-war-room#1** — the headline "real-time leaderboard" is unreachable on the main wall and kiosk; PostureMix is dead code. `org/live/LiveWarRoom.tsx:102`
44. **roadmap-recommendation-tracking#2** — enabling persistence silently destroys the roadmap's prioritization and quick-win signaling. `report/ReportPanels.tsx:89-92`

### I. Accessibility & interaction reach — 7
45. **org-overview-standing#1** — FilterMenu declares listbox ARIA without keyboard model or focus management. `overview/FilterMenu.tsx:59-95`
46. **score-charts-visuals#1** — radar dimension picker is pointer-only (no keyboard, touch no-ops). `report/RadarChart.tsx:102-109`
47. **score-charts-visuals#2** — PostureQuadrant hardcodes an off-system palette and 10px labels failing the documented contrast bar. `report/PostureQuadrant.tsx:10-21,119-141`
48. **landing-page-prototypes#1** — dimension matrix's horizontal-scroll region unreachable by keyboard (WCAG 2.1.1). `index/DimensionMatrix.tsx:52`
49. **marketing-about-page#1** — Remotion diagrams expose unlabeled mid-animation DOM to screen readers ("Gate Fail" with no context). `about/RemotionStage.tsx:69`
50. **marketing-about-page#2** — fixed mobile deck bar overlaps the CTA footer and every section's bottom edge below `lg`. `deck/DeckNav.tsx:74`
51. **app-shell-seo-error-pages#1** — EmptyState CTA links lack the shared `.focus-ring` token; button-style drift vs RouteError/not-found. `EmptyState.tsx:72-84`

(+ **design-system-ui-primitives-deck#1** — same DeckNav occlusion root cause as #50, plus iOS safe-area inset. `deck/DeckNav.tsx:73-105`) — counted here: **8 in theme I**

### J. Honest disclosures, docs & ops contracts — 14
52. **connect-repo-selection#1** — privacy notice claims "≤32 files" but real ingest budget is MAX_FILES=50 + workflow overflow. `PrivacyNotice.tsx:39`
53. **connect-repo-selection#2** — "Watch all" acts on the FILTERED set, "Schedule watched" on the whole org (billable scope mismatch). `InstallationRepos.BulkActionsBar.tsx:33-48`
54. **security-posture-audit-log#1** — auditor-facing PDF titled "Supply-chain & security posture" contains zero supply-chain data and no degraded warning. `pdf/security-document.tsx:28`
55. **security-posture-audit-log#2** — supply-chain `repos` silently capped at the 10 worst; consumers treat it as a complete map. `security/supply-chain.ts:189`
56. **org-branding-white-label#1** — white-label reaches only the PDF; on-screen briefing and the anonymous share page still show Ascent branding. `executive/page.tsx:58`
57. **org-branding-white-label#2** — accent colour can never be un-set; the picker default is silently persisted on first save. `executive/BrandingSettings.tsx:44`
58. **data-retention-purge#1** — 250s budget vs route maxDuration=300 are uncoupled magic numbers; on lower plan caps runs get hard-killed mid-delete. `db/retention.ts:41`
59. **data-retention-purge#2** — destructive per-org overrides have no floor/dry-run/confirmation (`retentionMaxScans=1` wipes history). `db/retention.ts:81-90`
60. **database-client-schema#1** — client-retirement grace transiently doubles connections, undermining DB_CONNECTION_LIMIT sizing guidance. `db/client.ts:400`
61. **quotas-rate-limiting#1** — client-IP trust model assumes exactly one well-behaved proxy; quota spoofable or collapsed on other deploy shapes. `rate-limit.ts:17`
62. **dev-inspector#1** — LIBRARY_SEGMENTS substring heuristic silently redirects the default copy target for feature-local hooks/utils/ui folders. `_dev-inspector/devLocate.ts:24`
63. **ai-native-standard-onboarding-skill#1** — the standard's `verified` flag is promised as doctor-writable in three places but nothing ever writes it back. `standard/doctor.ts:15`
64. **github-app-installation-webhooks#2** — org rename/installation transfer splits one installation across two org rows (login-as-PK trade-off unrecorded). `db/installations.ts:15`
65. **fleet-rollups-insights#2** — Teams tab is the only fleet surface ignoring the period selector; "since last scan" masquerades as the window. `db/org-teams.ts:326`
66. **credits… → counted in C.** (theme J totals 14 with #52–65 + design overlap adjustments)

---

## Triage themes

| Theme | High | Why this is a wave, not individual fixes |
|---|---:|---|
| A. Gate & verdict integrity | 6 | One mental model: what may override a persisted policy, and what happens on malformed input. The product's core trust artifact. |
| B. Scope-widening / tenancy & privacy | 6 | All are "fail-open on missing/unknown filter" or "reader missing the guard its twins have" — one defensive pattern to apply. |
| C. Money & billing | 5 | Credits/refunds/BYOM share the entitlement seam; fixes need the same test harness. |
| D. Silent fallback on data paths | 6 | `.catch(() => null)` / silent coercion / dropped fields — same fail-loud remedy everywhere. |
| E. Dormant-auth remnants | 4 | Known historic cluster (`getSession()` vs Supabase); sweep the remaining call sites in one pass. |
| F. API contract & validation | 7 | Route-level input validation parity (PATCH vs POST, status whitelists, idempotency). |
| G. Stale-view & invalidation | 6 | Client state not invalidated on dependency change; same React pattern per fix. |
| H. Broken/dead UX surfaces | 4 | Small, high-visibility repairs (dead CSV link is a one-liner with big payoff). |
| I. A11y & interaction reach | 8 | Keyboard/SR/touch reach + DeckNav occlusion; one accessibility review mindset. |
| J. Honest disclosures & ops contracts | 14 | Mostly copy/doc/constant alignment — several are doc-only or constant-only fixes; cheap batch. |

Medium (118) and Low (36) tails cluster along the same themes; work them after the High waves or fold same-file Mediums into each wave opportunistically.

---

## Suggested next-phase split (fix waves)

All fixes on an **isolated worktree off HEAD** (master has uncommitted user WIP). One themed wave per session, atomic commit per finding, full tsc+vitest after each wave.

| Wave | Theme | Findings | Notes |
|---|---|---:|---|
| 1 | A. Gate & verdict integrity | 6 | Includes the anonymous policy-override — highest-trust surface. |
| 2 | B. Tenancy & privacy fail-opens | 6 | Behavior changes (fail-closed) — flag for sign-off. |
| 3 | C. Money & billing | 5 | Refund denominator + BYOM need care; reuse entitlement tests. |
| 4 | D. Silent fallback / fail-loud | 6 | |
| 5 | E. Dormant-auth sweep + F. contract holes | 4+7 | E is small; F is mechanical validation parity. |
| 6 | G. Stale-view invalidation + H. dead surfaces | 6+4 | H first (quick wins), then G. |
| 7 | I. A11y & interaction | 8 | |
| 8 | J. Disclosures & ops contracts | 14 | Many doc/copy/constant one-liners. |
| 9+ | Medium/Low tail by theme | 154 | Optional follow-on waves. |

---

## Cross-cutting observation: context-map drift (again)

At least 8 contexts had stale file paths (files moved/renamed/deleted since mapping): Live War Room, Backlog Management, Org Overview, Playbooks, Roadmap, Repo Report Shell, Landing Page Prototypes, Scan Pipeline (ScanGallery), Fleet Rollups (champions.ts), Practices (PlaybookCard). Agents audited the current equivalents and noted drift per-report. Recommend a context-map refresh before the next scan.

---

## How this scan was run

- Scanner roles: `ambiguity-guardian` + `ui-perfectionist` (Vibeman prompt registry), merged into one combined per-context subagent prompt; exactly 5 findings per context (user-set cap).
- Scope: all 44 contexts, both lenses weighted per context nature; working tree as-is (user WIP present in ~14 files; WIP-dependent findings flagged in-report).
- Method: 44 read-only subagents in rolling waves of ≤8; orchestrator read only terse replies. One session-limit interruption (4 agents re-dispatched after reset; 2 had already written complete reports).
- Verification: header totals vs severity-bullet counts both = 220; every report exactly 5 findings.
- Baseline for the fix phase: tsc 0 errors · vitest 3504/3504 (256 files) — captured on master WITH user WIP.
- ~500 file-reads across subagents (approx from replies).

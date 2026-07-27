# Backlog  (☐ todo · ◐ in progress · ☑ done · ✕ cut)  — numbering append-only, never renumber

_Seeded from the BOOT audit (2026-07-05): gate + 6 lenses (functional, tests, security, UX, architecture, value)._

## Gate-green — ☑ Milestone 2 COMPLETE (2026-07-05); gate GREEN
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 1 | ☑ | 3-Test | S | Fixed: added `persistTeamStandings: vi.fn(async () => false)` to the `@/lib/db` mock in org/scan + org/import route tests. |
| 2 | ☑ | 3-Test | S | Fixed: the 2 import credit-cap failures cascaded from #1 (SSE errored before `send("result")`); resolved by the mock fix. |
| 3 | ☑ | 5-Bill | S | Fixed: AllotmentPanel.test aligned to `included`=5 (per D3 decision — 5/mo matches committed intent); code unchanged. |
| 4 | ☑ | 1-Build | M | Fixed: 22 lint errors → 0. Hoisted `Th` to module scope (PassportTable+SecurityRiskRegister, 12); Modal ref→post-commit effect (real); 6 justified scoped disables (mount-gate×2, fetch-on-open, focus→scroll, draft-sync, Date.now in async handler); let→const; 2 no-explicit-any on prisma test doubles. |

## Money-in test holes (highest blast radius)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 5 | ☑ | 3-Test | M | DONE (M4): webhook/route.test.ts (14 tests) — onOrderPaid (pack/plan/both/neither, metadata-org bind, throw-on-no-org, throw-on-setOrgPlan-false, throw-on-grant-null) + onOrderRefunded (non-pack skip, full/partial proportional clawback, totalAmount fallback, no-org no-throw) + 503 fail-closed when secret unset. Captures the Webhooks() config to invoke handlers. |
| 6 | ☑ | 3-Test | M | DONE (M4): +9 clawbackOrderRefund tests in credits.test.ts — full/partial, cumulative sequential partials, partial-then-full, per-event redelivery no-op, zero-clamp, marginal≤0 no-op, unknown-org null, no-DB null. |
| 7 | ☑ | 3-Test | S | DONE (M4): checkout/route.test.ts (9 tests) — 503 unconfigured, 204 prefetch, 403 cross-origin, 400 missing-org, 400 unknown-product, 404 uniform unknown-org (no oracle), 303 happy-path (org bound via externalCustomerId+metadata, lowercased), plan-tier accept, 303 error-url on Polar failure. |
| 8 | ☑ | 3-Test | M | DONE (M5): integrations.test.ts (11) — recordUsage (no-DB/unknown-org, skip-malformed, replace-idempotent, add-increments-but-seats-replace, negative/NaN→0 + round) + getOrgUsageRollup (null gates, empty-present, measured case-folded peak-seats, allocated org totals, trailing window). One in-memory aiUsageRecord store tests write+read end-to-end. |
| 9 | ☑ | 3-Test | S | DONE (M5): ingest/route.test.ts (6) — GET health probe, 401 pre-DB, 202 persist w/ stored count, toRecord drops bad scope/fidelity/date/source, non-JSON 202 not-persisted, record-less 202 not-persisted. |
| 10 | ☑ | 3-Test | S | DONE (M5): team-standings.test.ts (10) — persist (no-DB/unknown-org/<2-teams guard → no write; valid → write+true; best-effort false on throw) + provenance (null gates, no-snapshot, latest-row mapping w/ spread coercion, null on throw). |
| 11 | ☐ | 8-Ops | M | [M] Wire mock-LLM Playwright suite into CI (e2e never runs in CI: ci.yml = vitest+coverage+build only). |

## Functional / product-integrity (newest WIP seam: Integrations → AI-delivery)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 12 | ☑ | 2-Func | S | DONE (M3): $-tiles (AI spend/mo, Cost/AI-PR, Idle, Ungoverned) now render a locked "connect a provider" placeholder when `fidelity==="simulated"`; verdict line drops fabricated $ and links to Integrations. AiRoiLedger.tsx. |
| 13 | ☑ | 2-Func | S | DONE (M3): per-row tool/seats/$/mo/$AI-PR dash to "—" when simulated (AiRoiLedger); quadrant gets a "sample spend" watermark + $/seats stripped from tooltip/hover/action-rail (AiRoiQuadrant). |
| 14 | ☑ | 2-Func | S | DONE (M3): ClaudeCodeSetup Test now hits `…/v1/metrics` (the real receiver) + accurate success copy (was "persistence ships next"); base ingest route docstring/note corrected to point at the persisting /v1/metrics sub-route. |
| 15 | ✕ | 8-Ops | S | CUT (2026-07-27 resume): premise wrong — `src/app/api/dev/seed-ai-usage/route.ts` exists (as item 40 recorded); context-map staleness handled under 20. |
| 16 | ☐ | 2-Func | M | integrations/v1/logs accepts-and-drops (v1/logs/route.ts:18, persisted:false). Implement or remove. |
| 17 | ☐ | 2-Func | S | Gate API product defaults to deterministic rubric not LLM (gate route:38 `mock` defaults true). Document/surface the choice (ties to #28). |

## Architecture / tech-debt
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 18 | ☑ | 7-UX | L | DONE (M7): all 11 extracted via pure relocation (11 parallel agents) → zero .tsx >300 LOC (PowerShell-verified). New LOC: InstallationRepos 136, OnboardingFlow 132, Simulator 293, usage/page 143, RepoSegmentsPanel 285, FleetMap 232, ReportView 223, ScanModal 252, SkillsPanel 236, BacklogItemRow 292, TrendChart 240. ~30 co-located files created; exports + eslint-disables preserved; gate green. AGENTS.md invariant restored. |
| 19 | ☑ | 1-Build | S | DONE (M12, 009b514): tour widget renamed OnboardingChecklist → TourChecklist (file + export + the single import site in org/[slug]/layout.tsx). |
| 20 | ☑ | 8-Ops | S→L | DONE (M12, 64a1212): full map reconciliation — 548 unmapped attached, 93 ghosts (84 path-fixed, 9 removed), 4 new contexts (Org Memory, Skills Registry & API Tokens, AI-Native Passports, Portfolio & Leaderboard); drift script now 0/0. |
| 21 | ☐ | 1-Build | L | Split 3 large .ts modules into themed sub-modules + barrel (org-insights 937, scans-read 913, analyze/index 883). |
| 22 | ◐ | 1-Build | S | provider.ts docstring FIXED since (lists ClaudeCli+OpenAI, verified 2026-07-27). Remaining: tour steps.ts/types.ts stale variant references — re-verify. |

## UX polish
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 23 | ◐ | 7-UX | M | M6: DRY'd root+org error.tsx → shared RouteError; added loading.tsx streaming shells to usage, report/[owner]/[repo], report/compare, portfolio, leaderboard (+shared PageSkeleton). REMAINING (lower value): the UX-lens "~31 segments" over-counted — org sub-segments are already caught in-shell by org/[slug]/error.tsx and top-level pages by root error.tsx; optional refinements = per-public-segment error.tsx (pricing/report/compare) for page-specific copy + loading.tsx on the remaining public pages. |
| 24 | ☑ | 7-UX | S | DONE (M8): ConstellationField SVG `<title>` now a single concatenated `{`${r.fullName}${detail}`}` child (was mixed {name}{detail} → React-19 hydration drop). |
| 25 | ◐ | 7-UX | S | M8: aria-labels on NewPracticeModal title/dimension/summary/steps fields; aria-live span on ClaudeCodeSetup CopyButton (Copy→Copied announced). REMAINING (deferred, larger): keyboard access to SVG scatter points (UX lens: acceptable as-is, note for future data-tables-behind-charts). |

## Security hardening (low)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 26 | ☐ | 6-Sec | S | ingest-token: refuse the hardcoded dev-default HMAC secret in prod (ingest-token.ts:15) — mirror authBypass prod hard-off. |
| 27 | ☐ | 6-Sec | S | Wrap untrusted repo file/commit content in explicit "data, not instructions" delimiters (prompt.ts:157,187). |

## Value & market — PRODUCT DECISIONS (dimension 9) — ☑ DECIDED at CP1 (2026-07-05; see decisions.md + docs/VALUE-CASE.md)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 28 | ☑ | 9-Value | L | DECIDED **two-tier**: free deterministic "AI-native Scorecard" gate + paid "AI-native readiness briefing". → derived work 33,34. |
| 29 | ☑ | 9-Value | M | DECIDED **gate-only reproducible**: gate stays deterministic; narrative disclaimed as AI estimate. Do NOT pursue temp-0 scored path. → derived work 35. |
| 30 | ☑ | 9-Value | M | DECIDED **validate now, broaden next**: re-scan biased cohort to prove golang-floor fix, then reduce GH-native weighting. → derived work 36,37. |
| 31 | ☑ | 9-Value | L | DECIDED **buyer = platform/eng-effectiveness leader**: briefing = leadership dashboard + gate; move pricing toward team/seat. → derived work 38. |
| 32 | ☑ | 9-Value | S | DECIDED (principle): no synthetic/unvalidated number in a customer-facing headline w/o real-data path + fidelity marker. → elevates 12,13,14 to trust-priority. |

## Derived from CP1 strategy (new work; execute per severity under continuous cadence)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 33 | ☐ | 2-Func | M | Two-tier copy/IA: label the gate "AI-native Scorecard" (free, deterministic) and the report "AI-native readiness briefing" (paid) across pricing, gate PR comment, report headers. |
| 34 | ☐ | 5-Bill | L | Packaging: gate free / briefing paid; reconcile with Polar plans + the 5/mo public gate allowance. (pairs w/ 38 pricing) |
| 35 | ☐ | 7-UX | S | Disclaim narrative variance: visible "AI estimate — may vary between runs" marker on the scored briefing (implements D29). |
| 36 | ◐ | 9-Value | M | M9: added a DETERMINISTIC rollup-level regression test (signals.test.ts "golang-floor regression") — a golang/go-style off-GitHub repo now credits D3 (was ~1), un-flooring lifts the overall, and its GitHub-Actions twin scores within 8 pts (was the 20-vs-74 chasm). This is the reproducible stand-in for a live re-scan (fits D29). REMAINING: the actual live 10-org re-scan + reference-data/ refresh is a USER task (needs LLM+GH infra; PGlite persist caveat). |
| 37 | ☑ | 1-Build | L | ALREADY DONE (discovered M9 via investigation — backlog was stale): the audit's P0/P1 broadening all landed + is tested. D3 detects Gerrit/bors/Buildkite/generic off-GitHub CI + inline guardrails (analyze/index.ts:313-357, 527-531); D6 off-platform review from trailers (:500-505); D9 GitHub-native checks return null-not-0 (security/checks.ts); D4 org-level dep-bot fallback; P1-1 guardband widen. Locked by signals.test.ts (P0-1/P0-2/P0-4) + checks.test.ts (P0-3). No further code needed. |
| 38 | ☐ | 5-Bill | L | Reprice for platform/eng-leader buyer: team/seat tiers, briefing-as-leadership-dashboard; away from $10 self-serve. (product/pricing — likely its own checkpoint) |

## Discovered during M3 (2026-07-05)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 39 | ☐ | 2-Func | M | Deeper than M3: in `simulated` fidelity the VERDICT taxonomy itself is partly fabricated — `idle` (spend≥$500) and `shadow` (`planned` flag) in aiDeliveryModel.ts `classify()` derive from hash-synthesized spend/plan, so the verdict chips + action-rail cohorts read as detected when they're placeholder. M3 dashed the $ numbers; this needs the verdict/cohort layer to suppress or relabel spend-derived verdicts when simulated (or lead with adoption/governance only). |
| 40 | ☑ | 8-Ops | S | RESOLVED 2026-07-27: route re-verified present; item 15 cut; residual map drift tracked under 20. |

## Discovered at 2026-07-27 resume (gate re-cert after the 74-commit gap)
| # | S | Dim | Size | Item |
|---|---|-----|------|------|
| 41 | ☑ | 1-Build | S | ESLint scans `.claude/worktrees/**` (stale agent worktrees → 12 of 13 gate errors + ~200 dup warnings). Fix = add to `globalIgnores` in eslint.config.mjs. WAS APPLIED at M11 then LOST to the concurrent report-shell integration — re-apply once the tree settles. | DONE 2026-07-27: worktrees removed after merging, AND `.claude/worktrees/**` added to globalIgnores so the next agent run cannot re-break the gate. |
| 42 | ✕ | 1-Build | S | BadgeGenerator.tsx preview-loading `setState` synchronously in effect (lint error). Fix = React render-time reset (prev-URL compare). WAS APPLIED at M11 then LOST with the integration's BadgeGenerator rewrite — re-check the NEW version (previewState may not even exist there) before re-applying. | CUT 2026-07-27: re-checked on the integrated tree — the current BadgeGenerator has no synchronous setState in an effect and lint reports 0 errors. The finding did not survive the rewrite. |
| 43 | ☐ | 3-Test | S | auth.test.ts "readableOrgForOwner — cross-tenant read gate" flaked once under full-suite + concurrent-lint contention (1/3579; green twice re-run, green isolated). Root-cause order/timing dependence; meanwhile: never run lint concurrently with vitest. |
| 44 | ☑ | 7-UX | M | DONE (M12, bc77e50): all 7 extracted via pure relocation (7 parallel agents) — Simulator 293, LiveWarRoomHeader 295, PracticeApply 271, CreditsControl 246, AlertsControl 270, RepoSegmentsPanel 264, ui 220; 8 co-located files created. ZERO .tsx >300 (PowerShell-verified). |
| 45 | ☐ | 3-Test | S | `src/lib/pdf/report-document.test.ts` ("empty scannedAt") times out at 5s under FULL-suite load; passes 22/22 run alone. Reproduced across three independent sessions on 2026-07-27, and present before the personas-ports work — a `renderToBuffer` contention flake, not a regression. Fix = raise that file's timeout or serialize the pdf suite. |
| 46 | ☐ | 1-Build | S | `npm run build` is NOT in the standard gate, yet it is the ONLY check that catches a client/server boundary break: on 2026-07-27 tsc + 4240 tests were green while the build could not resolve dns/fs/net/tls (a "use client" panel imported a runtime `@/lib/db` symbol). Fix = add build to the gate, or an import-boundary lint rule so the failure lands at the edit instead of at release. |

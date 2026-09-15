# Ship Loop — state (ascent)

## Context refresher
- App: **ascent** — an "engineering maturity" scanner. Scans GitHub orgs/repos, scores maturity across dimensions (D1..D9, incl. D9 Security) via an LLM, and renders org dashboards (delivery / security / teams / practices), report permalinks, an onboarding tour, and a **maturity-gate** API product (`/api/gate/:repo` → CI pass/fail). Monetized via Polar (monthly subscription + 5-scan/month public allowance).
- Stack: Next **16.3.0-preview.5** (App Router; breaking vs training data — read node_modules/next/dist/docs before writing code) · React 19.2 · Prisma 6 + Postgres (local **PGlite** / pg / AWS DSQL) · **Supabase** GitHub OAuth auth · Polar billing · LLM provider (claude-cli / Bedrock / @google/genai) · vitest · Playwright · Tailwind 4 · framer-motion · recharts · remotion/react-pdf.
- Repo: ascent, branch **master**. Working tree: large uncommitted WIP (~40 modified + many new files) — auditing AS-IS.
- Ship bar: **DEFERRED** (CP0 pending — ask at first checkpoint). Cadence: Milestone (provisional default). UAT depth: deferred.
- Conventions: max 300 LOC per .tsx (currently zero over — keep it); large .ts → thin re-export barrels; context-map.json maps files→features (read before editing).

## Scorecard (post-BOOT gate + 6-lens audit, 2026-07-05)
| # | Dimension | Score | Evidence | Top gaps (backlog #) |
|---|-----------|-------|----------|----------|
| 1 | Build & types | 🟢 | tsc ✓ 0 · eslint ✓ 0 err · next build ✓; **M7: 300-LOC invariant restored (18 ☑) — zero .tsx >300** | 13 benign lint warnings; large .ts barrels (21), name collision (19), context-map drift (20) remain |
| 2 | Functional completeness | 🟡 | core scan/scoring/gate all real; **M3: AI-delivery synthetic $ now gated/dashed/watermarked behind real fidelity + connector copy fixed (12,13,14 ☑)** | verdict taxonomy still spend-derived in simulated mode (39); logs stub (16); seed-ai-usage context-map drift (40) |
| 3 | Tests | 🟢 | **gate GREEN**: 2940/2940 (+59 across M4+M5); money-in (5,6,7 ☑) + integrations recordUsage/ingest/team-standings (8,9,10 ☑) now covered | remaining: e2e not in CI (11) |
| 4 | Simulated UAT (e2e) | 🟡 | 9 Playwright specs exist (scan-flow, org-suite, connect) | NOT run this boot; NOT in CI (11) |
| 5 | Billing / value capture | 🟡 | Polar webhook + idempotent grants + refund clawback + checkout guards now **tested** (M4, [C/C/H] closed); allowance aligned to 5/mo (M3-adjacent) | repricing for platform-eng buyer (38); integrations $ ROI untested (8) |
| 6 | Auth & security | 🟢 | no cross-tenant IDOR (layout canReadOrg gates 21 pages via real Membership); all 64 routes gated; SSRF/cmd-inj/bypass closed; webhook+crons fail-closed; secrets clean | 3 low hardening only (26,27); public-scan quota fails-open by design |
| 7 | UX/UI polish | 🟢 | exemplary scan UX; M6 shared RouteError + 5 loading shells (23◐); **M7 300-LOC extraction (18 ☑)**; **M8 SVG-title hydration fix (24 ☑) + a11y labels/aria-live (25◐)** | scatter keyboard-access (25, deferred); remaining loading/error refinements (23) |
| 8 | Ops readiness | 🟡 | CI runs vitest+coverage+build; 2 new prisma migrations consistent w/ schema | e2e not in CI (11); context-map drift 7 files (20); seed-ai-usage route deleted-but-referenced (15) |
| 9 | Value & market reality | 🟡 | narrative moat; decisions D28-32 locked (M1); **M9: GH-native bias fix confirmed ALREADY SHIPPED+TESTED (37 ☑) + deterministic golang-floor regression added (36◐) — twin gap 54pt→≤8pt** | live 10-org re-scan = user task (36); repricing needs pricing decisions (38); reproducibility marketing (29) pending |

**Headline:** Build/Security/UX are 🟢 and genuinely strong. The only RED is **Tests (gate is failing on 4 WIP-integration breaks + 22 lint errors)** — mechanical to green. Deeper themes: untested money-in path, an AI-delivery seam that shows synthetic dollars to users, and a cluster of strategic value/positioning decisions (dim 9).

## Milestones
- **M1 "strategy" ☑ COMPLETE** (2026-07-05): dim-9 decisions D28-D32 made at CP1 (two-tier / gate-only-reproducible / validate-then-broaden / platform-eng-leader buyer). Brief: docs/VALUE-CASE.md. Derived work filed (33-38). No code changed (strategy milestone).
- **M2 "green the gate" ☑ COMPLETE** (2026-07-05): items 1,2,3,4 done. 4 failing tests fixed (persistTeamStandings mock + allowance→5) → 2881/2881; 22 lint errors → 0 (Th hoisted to module scope ×2, Modal ref→effect, 6 justified scoped disables, mechanical). Gate GREEN (tsc✓ lint✓ tests✓ build✓). Changes uncommitted (mixed into pre-existing WIP).
- **M3 "AI-delivery synthetic-$ disclosure" ☑ COMPLETE** (2026-07-05): items 12,13,14 done. Gate GREEN. Follow-up 39 filed (verdict taxonomy).
- **M4 "money-in test holes" ☑ COMPLETE** (2026-07-05): items 5,6,7 done. +32 tests (webhook 14, clawback 9, checkout 9). Gate GREEN. Revenue path was ZERO-tested; now covered.
- **M5 "integrations tests" ☑ COMPLETE** (2026-07-05): items 8,9,10 done. +27 tests (integrations 11, ingest 6, team-standings 10). Gate GREEN.
- **M6 "boundaries" ☑ COMPLETE** (2026-07-05): item 23 (slice) — shared RouteError (DRY'd root+org error.tsx) + PageSkeleton + 5 loading shells. Gate GREEN.
- **M7 "300-LOC extraction" ☑ COMPLETE** (2026-07-05): item 18 — all 11 files ≤300 via parallel pure-relocation agents; ~30 co-located files; gate green; AGENTS.md invariant restored.
- **M8 "quick UX" ☑ COMPLETE** (2026-07-05): item 24 done + item 25 (a11y labels/aria-live) mostly; gate green.
- **M9 "value execution" ☑ COMPLETE** (2026-07-05): item 37 confirmed already-shipped+tested; item 36 validated deterministically (golang-floor regression test); item 38 deferred (pricing decisions). Gate green.
- **M10 candidates**: context-map refresh (20, quite stale after M7's ~30 files); OR large-.ts barrel splits (21) + name collision (19); OR e2e-in-CI (11); OR functional (16 logs-stub, 39 verdict-taxonomy); OR security hardening (26 ingest-token dev-secret, 27 prompt delimiters).

## Backlog status (as of 2026-07-27 resume)
DONE: 1-10,12,13,14,18,24,37,40 · 28-32 decided (M1). CUT: 15. PARTIAL: 20,22,23,25,36. OPEN: 11,16,17,19,21,26,27,33,34,35,38,39 + new 41,42,43,44 (41/42 were fixed at M11 then lost — see below).

## Resume 2026-07-27 (skill adopted + gate re-certified)
- The loop's procedure is now codified: `.claude/skills/ship-loop/SKILL.md` (adopted from personas). State stays here.
- 74 commits landed during the 22-day pause (M2-M9 WIP committed; scan-pipeline feature run). Tree again carries a large uncommitted WIP (badge generator + org briefing + scan UX + uat/ artifacts) — NOT the loop's; audit AS-IS, stage only loop paths.
- **M10 "context-map refresh" ☑ (retro)**: the 7 boot-named unmapped files are all in context-map.json now; residual drift (ScanModal, ColdScanGate) tracked under 20 ◐.
- **M11 "re-green the gate" ✕ EXECUTED-THEN-LOST (2026-07-27)**: items 41+42 were fixed and the gate went GREEN (lint ✓0 err · vitest ✓3579/3579 · build ✓ · tsc ✓0, 13:40) — then a CONCURRENT SESSION integrated/committed the tree mid-run (HEAD c3fe9ab→2bb5e90 "report-shell"; theirs.tmp + integration-personas-ports worktree). Both fixes reverted; 41/42 reopened in backlog. Gate results for the PRE-integration tree; the post-integration tree is UNCERTIFIED.
- Gate methodology addendum: do NOT run lint concurrently with the vitest suite — 1 contention flake in auth.test.ts (item 43).
- **300-LOC invariant re-broken** (item 44): PracticeApply 326 · RepoSegmentsPanel 317 · Simulator 312 (two are regrowth of M7 extractions).

## Resume 2026-07-27b (tree settled — collision resolved, gate GREEN)
- The blocking collision is over. Local master (18 commits: report-shell round 3, .ai/ standard, harness + uat artifacts) was reconciled with origin/master's 224 commits (PRs #9 + #10); 7 conflicts resolved by keeping both sides' intent. The personas-ports work (5 tracks) merged on top. All 6 agent worktrees and branches removed.
- **M11 items closed**: 41 ☑ (worktrees gone AND `.claude/worktrees/**` now in eslint globalIgnores — the durable fix, so the next agent run can't re-break the gate); 42 ✕ CUT (the finding did not survive the BadgeGenerator rewrite; lint is 0 errors on the integrated tree).
- **Gate re-certified on the INTEGRATED tree** (sequential, per the addendum): lint ✓ 0 errors · vitest ✓ 4240/4240 · tsc ✓ 0 · build ✓. `report-document.test.ts` times out under full-suite load and passes 22/22 alone — pre-existing flake, new item 45.
- Lesson worth keeping: tsc + 4240 unit tests were ALL GREEN while `npm run build` could not resolve dns/fs/net/tls — a client component had imported a runtime `@/lib/db` symbol. Only the build catches the client/server boundary; it belongs in the gate, not after it.

## M12 "invariant repair" ☑ COMPLETE (2026-07-27, CP2 user pick = A)
- 19 ☑ (009b514 TourChecklist rename) · 44 ☑ (bc77e50, 7 parallel extractions, ZERO .tsx >300) · 20 ☑ (64a1212, full context-map reconciliation: 548 attached / 93 ghosts fixed / 4 new contexts, drift 0/0).
- GATE GREEN (sequential): lint ✓ 0 err (27 warn) · vitest ✓ 4240/4240 (item-45 flake passed this run) · build ✓ · tsc ✓ 0. Three atomic commits, tree clean.

## M13 "two-tier copy" ☑ COMPLETE (2026-07-27, CP3 pick = B; wording user-approved)
- 33+35+17 ☑ in f7610d4: report kicker "AI-native readiness briefing" + variance chip; gate PR comment "Ascent AI-native Scorecard" (check-run name pinned) + reproducible-by-design mock footer; badge GateSection + pricing sub-headline carry both tier names. Entitlements untouched.
- GATE GREEN (sequential): lint ✓ 0 err · vitest ✓ 4240/4240 · build ✓ · tsc ✓ 0.
- Scorecard moves: dim 2 gap 17 closed; dim 9 strategy execution now only lacks packaging/pricing (34/38) + live re-scan (36).

## NEXT ACTION — CP4 (awaiting user)
M14 candidates by severity under continuous cadence:
- **C. e2e in CI (11)** — wire mock-LLM Playwright into ci.yml. (recommended — dim 4's only structural gap)
- **D. Sec hardening (26 + 27)** — prod hard-off for the dev ingest secret; untrusted-data delimiters in the scoring prompt.
- **E. Func/debt (16 logs-stub, 39 verdict taxonomy, 21 barrel splits)** · flakes (43 auth.test, 45 report-document.test).
- **F. Pricing/packaging checkpoint (34 + 38)** — needs dedicated user decisions (team/seat tiers, gate-free vs briefing-paid packaging).

## Checkpoint history
- CP0 (2026-07-05): ship bar="just keep improving"; cadence=continuous; allowance=5/mo; M1=strategy-first.
- CP1 (2026-07-05): M1 strategy decisions D28-D32 (see decisions.md). → M2 = green the gate.
- M2 (2026-07-05): gate GREEN. → M3 = AI-delivery synthetic-$ disclosure (continuous; no checkpoint).
- CP2 (2026-07-27): pending — M12 pick (A/B/C/D above).
- CP3 (2026-07-27): pending — M13 pick (B/C/D/E above).
- CP4 (2026-07-27): pending — M14 pick (C/D/E/F above).

## Gate re-certified 2026-08-28 on the LOOP-ERA tree (branch `ship/ascent-stabilize`)

The last certification was M13 (2026-07-27, 4240 tests) and it predates the entire loop /
cockpit / observatory era — design-record gap #13. Re-run here in the overlay's declared
order, sequentially (never lint concurrently with vitest, per the M11 addendum), on
`ship/ascent-stabilize` @ 459bd8b1 — 19 commits stacked on the loop + marketing work, tree
otherwise clean.

| # | step | command | result |
|---|------|---------|--------|
| 1 | lint | `npm run lint` | ✓ **0 errors**, 36 warnings |
| 2 | unit | `npx vitest run` | ✓ **8037 / 8037** across 599 files (36.8s) |
| 3 | build | `npx next build --webpack` | ✓ exit 0 |
| 4 | typecheck | `npx tsc --noEmit` (after the build) | ✓ **0 errors** |
| 5 | loc 300 | AGENTS.md `.tsx` > 300 check | ✓ zero rows |
| 5b | loc 200 | AGENTS.md `src/features/**` > 200 check | ✓ zero rows |
| 6 | e2e (loop) | `npm run test:e2e:loop` | ✓ **5 / 5** (3.7m) |
| 6b | e2e (funnel) | `npx playwright test --grep-invert @livescan e2e/scan.spec.ts e2e/connect` | ✓ 3 passed, 1 skipped (21.4s) |

**Unit tests 4240 → 8037** (+3797 since M13).

**Deviation, webpack not turbopack — this certification does not cover the shipped build
path.** `npm run build` is `next build`, which is turbopack on Next 16, and turbopack refuses
this checkout (`node_modules` is a junction in the worktree). Step 3 therefore ran as
`npx next build --webpack`. CI runs the plain `npm run build` on a real checkout and remains
the only authority on the turbopack path. For the same reason the funnel e2e ran against a
hand-started `next dev --webpack -p 3100` with `E2E_BASE_URL` pointed at it, reproducing the
env `playwright.config.ts` declares (PORT, `LLM_PROVIDER=mock`, a configured-but-unreachable
`DATABASE_URL`) rather than letting its `webServer` run `npm run dev`. The loop suite needs no
such workaround — `playwright.loop.config.ts` already commands `next dev --webpack`.

**Ordering caveat, stated rather than papered over.** Steps 1-4 ran on the tree as it stood at
f02f84aa. Three files changed after that (`.github/workflows/ci.yml`, `e2e/scan.spec.ts`,
`context-map.json`) and lint + tsc + both e2e suites were re-run on the final tree; vitest and
the build were not. Neither reads any of the three — vitest's include is `src/**/*.test.{ts,tsx}`,
`next build` does not compile `e2e/`, and `context-map.json` is imported by nothing (passport.ts
only tests for its existence).

**Flakes 43 and 45: both green.** Item 43 (`auth.test.ts` contention) held with lint and vitest
run sequentially. Item 45 (`report-document.test.ts` 5s timeout under full-suite load) passed —
note the premise has moved: `vitest.config.js` now sets `testTimeout: 15_000` suite-wide, which
is one of the two fixes that item proposed, so it is closer to closed than the backlog says.

**One real red, found and fixed by wiring e2e into CI (item 11).** The `@smoke` assertion at
`e2e/scan.spec.ts:22` had been failing since 7deeaa84 (2026-08-14) moved "Plans & credits" from
the pricing h1 to the metadata title. It ran only in smoke.yml's post-deploy job, so no PR had
ever seen it. Fixed in 557b06ce. This is the argument for the job in one line: the suite was
green everywhere it was allowed to run and red the moment it ran.

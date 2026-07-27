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

## NEXT ACTION — CP3 (awaiting user)
M13 candidates by severity under continuous cadence:
- **B. Two-tier execution (33 + 35 + 17)** — the decided-but-unshipped D28/D29 copy: "AI-native Scorecard"/"readiness briefing" labels + "AI estimate — may vary" disclaimer + gate-default surfacing. Product-visible copy; user may want wording review. (recommended — last decided-but-unexecuted strategy work)
- **C. e2e in CI (11)** — wire mock-LLM Playwright into ci.yml.
- **D. Sec hardening (26 + 27)** — prod hard-off for the dev ingest secret; untrusted-data delimiters in the scoring prompt.
- **E. Func/debt (16 logs-stub, 39 verdict taxonomy, 21 barrel splits)** · flakes (43 auth.test, 45 report-document.test).
- Pricing/packaging (34/38) still needs its own user checkpoint.

## Checkpoint history
- CP0 (2026-07-05): ship bar="just keep improving"; cadence=continuous; allowance=5/mo; M1=strategy-first.
- CP1 (2026-07-05): M1 strategy decisions D28-D32 (see decisions.md). → M2 = green the gate.
- M2 (2026-07-05): gate GREEN. → M3 = AI-delivery synthetic-$ disclosure (continuous; no checkpoint).
- CP2 (2026-07-27): pending — M12 pick (A/B/C/D above).
- CP3 (2026-07-27): pending — M13 pick (B/C/D/E above).

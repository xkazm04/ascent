---
name: ship-loop
description: Milestone-driven ship-readiness loop for ascent. Maintains a 9-dimension scorecard + append-only backlog, batches items into user-gated milestones (CP checkpoints), executes with atomic commits, and certifies each milestone with the full verification gate (lint/tests/build, then tsc sequentially). Resumable across sessions — all state lives in `.claude/ship-loop/` at the repo root. Invoke with `/ship-loop` (resumes) or `/ship-loop boot` (fresh loop after archiving prior state).
---

# Ship Loop — milestone-driven ship readiness (ascent)

A permanent loop that moves the app toward a user-defined **ship bar** through scored audits, user-gated milestone picks, and hard verification gates. Any session can resume it: the state files are the single source of truth, and this file is the procedure.

> Origin note: adopted from the personas repo's ship-loop skill on 2026-07-27. Ascent already ran Boot→M9 of this loop during 2026-07-05 with no skill definition; this SKILL.md codifies the procedure, adapted to ascent's stack and the harness learnings recorded in `state.md`/`decisions.md`.

## State files (in `.claude/ship-loop/`, repo root — NOT next to this skill)

| File | Contract |
|---|---|
| `state.md` | Current truth: ship bar, scorecard, milestone status, harness notes. Rewrite freely; keep it one screen of load-bearing facts. |
| `backlog.md` | Item table `# / status / dimension / size / description`. **Numbering append-only — never renumber.** Statuses: ☐ todo · ◐ in progress · ☑ done · ✕ cut. |
| `journal.md` | Append-only, one line per event (item done w/ commit SHA, CP resolution, gate result, root-caused saga). Never edit past lines. |
| `decisions.md` | CP answers from the user + auto-decisions taken while AFK (each marked "pending user review at CPn"). |
| `value-case.md` | Dimension-9 (value & market) synthesis — ascent keeps this in `docs/VALUE-CASE.md`; the state file may just point there. Written once by the value lens, corrected only with code-verified evidence. |
| `archive-*/` | Frozen state of previous loops (different app or restarted loop). Read-only. |

## The 9 scorecard dimensions (ascent flavor)

1-Build & types · 2-Func(tional completeness) · 3-Tests · 4-Simulated UAT (Playwright e2e + `uat/` journeys) · 5-Billing & value capture (Polar) · 6-Auth & security (Supabase wall, route gating) · 7-UX/UI polish · 8-Ops (CI/migrations/context-map hygiene) · 9-Value & market. Each is 🔴/🟡/🟢 on the scorecard in `state.md`. Dimensions 4 and 9 are run as **lenses** (audit passes that emit backlog items), not fixed at boot.

## Phases

### Boot (`/ship-loop boot` — only for a fresh loop)
1. Archive any existing `.claude/ship-loop/` contents to `.claude/ship-loop/archive-<slug>/`.
2. Run the audit lenses (build health, functionality honesty vs docs, test coverage of load-bearing paths, security posture, ops/CI path) → seed `backlog.md` + initial scorecard in `state.md`.
3. **CP0**: present scorecard + backlog to the user; ask for the ship bar, cadence, and first milestone scope. If AFK, record provisional picks in `decisions.md` and proceed on the least-destructive batch.

### Resume (default)
1. Read `state.md`, then `backlog.md` and the tail of `journal.md`. Do NOT re-audit what the scorecard already scores — but if many commits have landed since the last journal entry, re-run the gate and premise-check open items before trusting the scorecard.
2. Scan `git status` for foreign in-flight WIP (ascent's tree often carries large uncommitted WIP that is not the loop's).
3. Continue: an in-flight milestone → keep executing; a completed one → run/finish its gate; gate green → next checkpoint.

### Checkpoint (CPn — before each milestone)
- Present: scorecard delta, recommended next milestone (a coherent batch of backlog items, usually 3-8 by theme), and any product decisions the work needs. One question at a time, single-keystroke answerable.
- **AFK protocol**: ask twice ~60s apart; if silent, record a provisional pick in `decisions.md` (least-destructive option, marked for re-ask), avoid product-call edits while AFK, and never commit destructive changes on a provisional.
- Under **continuous cadence** (if the user picked it at CP0), proceed down the backlog by severity without a CP ask; stop only for blockers or product decisions.

### Execute (milestone)
- One backlog item = one atomic commit, referenced by SHA in `journal.md`. Fan out parallel subagents only for disjoint paths.
- **Never bundle the loop's changes with pre-existing uncommitted WIP.** If the tree is a WIP soup, stage only your paths (one `git reset -q && git add <paths>` invocation) — or defer the commit decision to the user and record it.
- Defer any item whose files are another session's hot area — mark it in `backlog.md` with the reason, don't fight over files.
- Premise-check before executing: audits overstate and backlogs go stale (item 37 was already shipped; item 15 was context-map drift, not a deleted route) — verify the claim against current code first; correct the backlog item if the premise moved.
- Respect repo conventions: max 300 LOC per `.tsx` (extract before committing an over-limit file); read `context-map.json` before editing and keep it accurate; read `node_modules/next/dist/docs/` before writing Next-specific code (16.3 preview, breaking vs training data).

### Gate (after every milestone — certifies it)
1. `npm run lint` (0 errors) · `npx vitest run` · `npm run build`.
2. **Then** `npx tsc --noEmit` — SEQUENTIALLY, after the build completes, never concurrently: `next build` rewrites `.next/types/validator.ts` mid-flight, so a concurrent tsc reads an inconsistent tree and reports spurious "does not satisfy AppRouteHandlerRoutes" errors (bitten at boot + M2; a clean `rm -rf .next && npm run build` then tsc disproved them). Test-only diffs may skip the build (tsc still runs against the last build's types).
3. `.tsx` touched → run the AGENTS.md 300-LOC check (PowerShell one-liner, `-LiteralPath` for bracket dirs); must return zero rows.
4. UI touched → Playwright mock-LLM e2e (`npx playwright test`) when feasible; journeys in `uat/` are the deeper UAT lens. Test-only diffs may justified-skip — record the justification.
5. Record the gate line in `journal.md`; flip milestone ☑ in `state.md`; update the scorecard.

### Wrap (session end)
Update `state.md` + journal entry (commit SHAs), leave no uncommitted loop work (or an explicit journaled deferral of the commit decision). The next session resumes from files alone.

## Invariants

- **User owns product calls.** Ship bar, scope narrowing, feature hide/delete, pricing/positioning (dim 9), security trade-offs are CP questions — never auto-decided, only provisionally deferred.
- **Honesty over green.** A gate that passes while the claim is unverified is not done — distinguish "code-verified" from "subagent-claimed" in every journal line.
- **Lenses emit items, items get numbers, numbers never change.**
- **The gate is the build gate, not the product's `/api/gate`** — `npm run gate` is a product feature, excluded from verification.

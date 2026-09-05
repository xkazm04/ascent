# Decisions log (ascent ship-loop)

## Boot decisions (2026-07-05)
- USER: Fresh boot on ascent (not resume ai-bookkeeper). Archived prior foreign state → archive-ai-bookkeeper/.
- USER: Full boot (gate + full multi-lens audit), token-heavy accepted.

## Auto-decided (pending user review at next CP)
- 2026-07-05 — Build gate defined as tsc --noEmit + eslint + vitest run + next build (ascent has no `typecheck` script; `next build` also type-checks). `npm run gate` is a product feature, excluded from the build gate.
- 2026-07-05 — Auditing the working tree AS-IS (large uncommitted WIP) rather than HEAD, since the WIP is the live surface.
- 2026-07-05 — GATE METHODOLOGY: run `tsc --noEmit` AFTER `next build` completes (sequentially), never concurrently. `next build` rewrites `.next/types/validator.ts` mid-flight, so a concurrent tsc reads an inconsistent tree and reports spurious "does not satisfy AppRouteHandlerRoutes" errors (seen at boot; disproven by a clean sequential run).
- 2026-07-05 — NOT auto-committing M2. The working tree mixes my M2 fixes into a large pre-existing uncommitted WIP; a commit would bundle both. Deferring the commit + staging decision to the user.

## CP0 — boot checkpoint (2026-07-05) — USER PRESENT
- Ship bar: **"Just keep improving"** — no fixed launch; severity order correctness > money-in > polish > strategy.
- Milestone 1: **"Strategy first"** — work the dim-9 value/positioning decisions (items 28-32) before more code; produce a decision brief (docs/VALUE-CASE.md) + drive the calls with the user.
- Cadence: **Continuous** — proceed down the backlog by severity; stop only for blockers or product decisions.
- Item 3 allowance: **5/mo** (match committed intent) — when item 3 is worked, align the test down to 5; keep code constant = 5.

## CP1 — Milestone 1 "strategy" decisions (2026-07-05) — USER PRESENT
Brief: docs/VALUE-CASE.md. Verified in code first (engine.ts guardband + D9-deterministic; gate/route.ts:38 deterministic-by-default; providers temp 0.2 env-settable, claude-cli no knob).
- **D28 Positioning = TWO-TIER**: free deterministic "AI-native Scorecard" gate (the wedge) + paid "AI-native readiness briefing" (the narrative/self-audit engine, the moat). Lead with the briefing; number supports, doesn't carry.
- **D29 Reproducibility = GATE-ONLY**: keep the gate deterministic (already is); the narrative score stays stochastic but must be clearly disclaimed as an AI estimate (may vary run-to-run). No temp-0 default needed → do NOT pursue full scored-path determinism now.
- **D30 GH-native bias = VALIDATE NOW, BROADEN NEXT**: re-scan the biased cohort (golang etc.) to prove the P0 floor-fix landed before any external claim; then reduce GitHub-native signal weighting. Scope external claims to GH-Actions shops until validated.
- **D31 Buyer = PLATFORM / ENG-EFFECTIVENESS LEADER**: internal buyer improving how their org works; briefing = leadership dashboard + gate; move pricing toward team/seat (away from $10 self-serve).
- D32 (principle, applied): no hash-synthesized/unvalidated number in a customer-facing headline without a real-data path + visible fidelity marker → elevates backlog 12-14.

## CP2 — M12 pick (2026-07-27) — USER PRESENT
- Collision resolved by the user: other terminals stopped, everything merged to master; loop owns master.
- M12 = **A. Invariant repair**: 44 (300-LOC re-extraction), 20 residual (context-map re-sweep), 19 (tour OnboardingChecklist rename). B/C/D remain queued; pricing (34/38) still its own future checkpoint.

## CP3 — M13 pick (2026-07-27) — USER PRESENT
- M13 = **B. Two-tier execution**: 33 (Scorecard/briefing labels), 35 (AI-variance disclaimer), 17 (surface gate's deterministic default). Wording to be shown to the user before commit (product-visible copy). C/D/E queued.

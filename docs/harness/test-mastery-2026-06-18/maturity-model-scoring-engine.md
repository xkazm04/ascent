> Total: 5 findings (2 critical, 2 high, 1 medium)
# Test Mastery — Maturity Model & Scoring Engine

This context is the math behind every score the product sells: the coverage-weighted blend of deterministic signals with LLM judgment, the archetype weighting lens, the overall roll-up/level, and the posture quadrant. The CI gate (idx 1) blocks merges on these numbers, the badge embeds them, and the executive PDF reports them. The existing suite is honest where it exists (real invariants, no assertion-free coverage chasing) but it tests `assembleReport` ONLY for two warning paths — the load-bearing blend arithmetic, the PR/governance folds, and the archetype classifier are essentially untested. Findings are ranked by how much a silent regression in each would distort a customer-facing score.

## 1. Lock the coverage-weighted blend + LLM guardband in `assembleReport` against a silent score collapse
- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/lib/scoring/engine.ts:70-102
- **Scenario**: A refactor changes how `effectiveBlend = SCORE_BLEND * clamp(coverage,0,1)` is applied, or drops the `Number.isFinite(snap.coverage)` guard, or inverts the guardband `Math.max/Math.min` clamp. Every blended dimension score, the overall, the axes, the level, and the posture shift — or silently collapse to NaN on a partial/rate-limited scan — and the whole suite stays green because no test ever runs `assembleReport` with `coverage ≠ 1` or an LLM score outside `±25` of the signal.
- **Root cause**: `engine.test.ts` exercises `assembleReport` only for dimension reconciliation (#8) and mock/engine parity (#4). `blankSnap()` hardcodes `coverage: 1`, so `effectiveBlend` is always exactly `SCORE_BLEND`; the assessments used carry no per-dimension `score` that diverges from the signal, so the guardband math (lines 99-102) never executes. The long "false precision" / "trust boundary" comments describe fixed bugs with no regression lock.
- **Impact**: The blend is the score. A regression here mis-levels every repo (and thus the CI gate verdict, the badge, the exec PDF) with zero warning — the worst class of silent data-integrity failure for a scoring product.
- **Fix sketch**: Add direct `assembleReport` tests asserting: (a) at `coverage:1`, `score == round(0.6*guarded + 0.4*signalScore)` for an LLM score within band; (b) at `coverage:0.5`, `effectiveBlend` halves so the result leans harder on `signalScore` (assert the exact rounded value, and that it sits strictly between the full-blend result and the pure signal); (c) `coverage: NaN`/`Infinity` produces the SAME report as `coverage:1` (the finite-guard invariant), never a NaN `overallScore`; (d) an LLM score of 100 against a signal of 40 is clamped to `signalScore+25=65` before blending (guardband invariant). Each assertion pins a number, not an implementation detail.

## 2. Test that a `failed` detector is excluded from the overall instead of folding a fake 0
- **Severity**: Critical
- **Category**: error-branch
- **File**: src/lib/scoring/engine.ts:88-93, 151-156
- **Scenario**: Someone "simplifies" the `if (s.failed)` skip (or `analyzeSignals`'s catch stops setting `failed:true`), so a detector that THREW now folds its placeholder `signalScore:0` into the weighted mean. A repo with one crashing detector is deflated by ~10-15 points and may drop a whole maturity level — and the all-failed total-incompleteness warning (every dimension dropped → `dimensions.length===0`, must NOT read as a genuine L1) regresses to a fabricated L1 result. No test covers either branch.
- **Root cause**: No test ever passes a `DimensionSignals` with `failed:true` into `assembleReport`, and none asserts the `dimensions.length===0` "INCOMPLETE scan, not a genuine L1" warning. `signals.test.ts` checks `analyzeSignals` emits 9 dimensions on a happy path but never forces a detector to throw, so the `failed` flag is produced and consumed entirely untested.
- **Impact**: A self-inflicted extraction failure silently penalizes a real customer repo (under-reporting maturity, failing a CI gate it should pass), or an entirely-failed scan is sold as a confident L1 "Manual" verdict — both are dishonest numbers with money/trust consequences.
- **Fix sketch**: (a) Pass signals where D2 has `failed:true, signalScore:0` and the rest score 90; assert `overallScore` equals `overallScoreFor` over the 8 present dims (renormalized), NOT the 9-way mean including the 0, and that a warning naming D2 "not measured" is present. (b) Pass all-`failed` signals; assert `dimensions` is empty, the warning contains "INCOMPLETE scan" and "not a genuine L1", and the level is the renormalized floor — assert the warning, since that's the honesty invariant the UI depends on.

## 3. Cover `applyGovernanceSignals` and the D7/D8 folds in `applyPrSignals` — the rigor-axis inputs the gate blocks on
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/analyze/pulls.ts:236-270 (governance), 195-223 (D7/D8 PR folds)
- **Scenario**: `applyGovernanceSignals` has ZERO tests. A change to its `D6`/`D3`/`D8` boost amounts, the `!gov.readable` early return, or the additive-only contract (absence must never penalize) silently shifts the rigor axis → flips posture across the 50 threshold → flips the CI gate verdict. Likewise `applyPrSignals`'s D7 boost (`min(18, …)`) and D8 governed-rate fold are untested; only the D6 null-reviewedRate path is covered.
- **Root cause**: `pulls.test.ts` deliberately scopes to the two NaN-guard / null-reviewedRate fixes it was written for. The governance fold and two of the three PR folds were never given a regression test, despite feeding the same scored dimensions (D3/D6/D8, ~33% combined weight) that decide adoption×rigor and posture.
- **Impact**: Branch protection and AI-PR-governance evidence are exactly the signals that distinguish "governed" from "ungoverned" posture — the headline a customer is judged (and gated) on. A silent regression here mis-postures the repo and mis-blocks merges.
- **Fix sketch**: For `applyGovernanceSignals`: assert `!gov.readable` returns signals untouched (referential equality); a protected branch with required PR + code-owner review adds exactly `8+4` to D6 and `6` to D8; a repo lacking governance is never penalized below its base signalScore (additive-only invariant). For `applyPrSignals`: assert the D7 boost caps at 18 and never fires when `aiInvolvedRate===0`; the D8 fold `round(0.7*signal + 0.3*aiGovernedRate)` only applies when `aiGovernedRate != null`. Pin the arithmetic.

## 4. Test `classifyArchetype` boundaries — a wrong lens re-weights every dimension
- **Severity**: High
- **Category**: coverage-gap
- **File**: src/lib/analyze/index.ts:703-711
- **Scenario**: The `stars >= 1000`, `hasCodeowners && workflows >= 2` → org, and `stars >= 50 || hasCodeowners || workflows >= 1` → team thresholds are tweaked or an off-by-one creeps into the boundary, and a solo repo gets the org lens (or vice-versa). Every dimension is then weighted by the wrong `ARCHETYPE_WEIGHTS` set — solo's D2/D6 emphasis vs org's D3/D4 emphasis differ enough to move the overall several points and the posture — and nothing catches it because `classifyArchetype` has ZERO tests.
- **Root cause**: It's a pure, deterministic function of `snap` (stars, CODEOWNERS, workflow count) but no test file references it. It sits on the live scan path (`scan.ts:173`) and silently selects the entire scoring lens.
- **Impact**: Mis-classification systematically mis-scores a whole cohort of repos (e.g. all small teams judged by org-scale CI they don't need — the exact unfairness the archetype lens exists to prevent), distorting fleet rollups and the gate.
- **Fix sketch**: A small LLM-generatable table test asserting each boundary: 999 stars + no codeowners → `team`; 1000 stars → `org`; codeowners + 2 workflows → `org`; codeowners + 1 workflow → `team`; 49 stars + nothing → `solo`; 50 stars → `team`. Invariant: the returned archetype is a valid key of `ARCHETYPE_WEIGHTS`, and crossing each documented threshold changes the classification exactly once.

## 5. Cover `cheapestPathToNextLevel`'s unreachable + greedy-stop branches
- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/scoring/engine.ts:320-371
- **Scenario**: The `reachable:false` branch (when even projecting every dimension to 100 can't clear the next band floor — the remaining headroom lives in a zero-weight dimension under this lens) or the greedy `if (after >= targetScore) break` stop is refactored, and the UI shows a customer a "path to L4" that mathematically never crosses, or claims a level is unreachable when one more step would clear it. `cheapestPathToNextLevel` has ZERO tests.
- **Root cause**: `engine.test.ts` covers `projectSandbox`, `projectedGain`, `contributions`, and `diffReports`, but never `cheapestPathToNextLevel` — the one projection with non-trivial control flow (true-reachability pre-check, greedy selection, band-floor stop, the `-1`/findIndex level-id clamp).
- **Impact**: A misleading "how do I level up" path is a credibility hit on the core value prop (the motivating roadmap), and a false `reachable:false` discourages a team that's actually one fix away.
- **Fix sketch**: Build a self-consistent report (overall just below a band floor) and assert the greedy `steps` are ordered by descending weighted upside, stop as soon as `projected.overallScore >= target.score`, and `reachable:true`. Then construct a report whose only headroom is in a zero-lens-weight dimension and assert `reachable:false` with empty `steps` and a non-null `target` (the "don't imply a climb that never crosses" invariant). Add a top-band (L5) report and assert `target:null, reachable:true`.

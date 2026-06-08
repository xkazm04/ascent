# Bug Hunter — Maturity Model & Scoring Engine (ascent)

> Total: 7 findings (Critical: 1, High: 2, Medium: 3, Low: 1)
> Files read: 13
> Scope: src/lib/maturity, src/lib/analyze, src/lib/scoring, recommendations API

## 1. Partial LLM coverage silently rolls up a misleadingly high overall score
- **Severity**: Critical
- **Category**: functionality
- **File**: src/lib/scoring/engine.ts:63-116 (with src/lib/llm/provider.ts:174-178)
- **Scenario**: A scan asks the LLM for 9 dimensions. `isAssessmentUsable` only requires `MIN_ASSESSMENT_COVERAGE = 0.5`, i.e. **5 of 9** dimensions scored. A model returns scores for the 5 dimensions a repo happens to be strong in (D1, D2, D5, D6, D8 = 90s) and omits the 4 weak rigor/security dimensions (D3, D4, D7, D9). The gate passes (5 ≥ 5). In `assembleReport`, `signals.flatMap` still iterates all 9 deterministic signals, so the *missing* LLM dims fall back to `llmScore = s.signalScore` (engine.ts:75) — but that signal floor for the omitted weak dims is exactly what was low. Meanwhile the 5 present (strong) dims get blended *up* toward the LLM's 90s. The result is a real, persisted overall that leans on a cherry-picked half of the rubric.
- **Root cause**: The "usable" gate counts *how many* dimensions were scored, never *which* — and a 50% threshold lets a model score only the favorable half while every absent dimension is silently treated as "LLM agrees with the signal floor." There is no check that omitted dims are non-systematic (e.g. not all clustered on one axis).
- **Impact**: misleading maturity (dangerous false confidence) — an overall/level/posture that a buyer or team trusts is built from partial, potentially adversarial-looking-favorable data, with no warning since the gate passed and nothing threw.
- **Fix sketch**: Require coverage of *every* dimension (or per-axis minimums) before blending; if any dim is LLM-missing, mark `report.warnings` AND treat that dim's blend as pure signal *with* a visible "LLM did not assess" flag so the headline can't read as fully AI-validated.

## 2. `projectScore` weighted-mean uses raw stored weights, diverging from the headline's renormalized lens
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/scoring/engine.ts:162-174 vs 115 / 227-237
- **Scenario**: `assembleReport` computes the headline via `overallScoreFor` (engine line 115), which renormalizes by `Σ lensW[id]` over present dims. But `projectScore` (line 167) renormalizes by `Σ d.weight` where `d.weight = lensW[s.id] ?? def.weight` (engine.ts:86) — note the **`?? def.weight` fallback**: if any dimension id is missing from the archetype lens (schema drift / a new detector / a hand-edited persisted scan), that dim contributes its *base* `def.weight` here but contributes `lensW[id] ?? 0` (i.e. **0**) inside `overallScoreFor`. The two denominators then differ, so `projectScore(report, {})` no longer equals `report.overallScore`. `projectSandbox` advertises "with an empty override set this returns the report's own numbers byte-for-byte" (engine.ts:205-208) — that invariant breaks.
- **Root cause**: Two roll-up paths use different weight sources (renormalized lens vs. report-stored `weight` with a `def.weight` fallback). The `?? def.weight` vs `?? 0` mismatch is the divergence point.
- **Impact**: wrong scores — Roadmap Sandbox baseline, `deltaScore`, and `levelUp` drift from the actual report; the "no change" slider position shows a phantom delta, and `cheapestPathToNextLevel` (which is built entirely on `projectScore`) can over/understate gains and mark the wrong level reachable.
- **Fix sketch**: Have `projectScore` reuse `overallScoreFor` over the (possibly overridden) dimension scores, so there is exactly one weighted-mean implementation and one weight source.

## 3. `cheapestPathToNextLevel` can report a next level as unreachable even after maxing every dimension
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/scoring/engine.ts:240-275
- **Scenario**: The greedy loop stops the moment `after >= targetScore` — but if maxing the candidate dims never crosses the band floor *within the loop budget*, or rounding keeps `after` one point under `targetScore`, it returns `reachable: false`. Worse: dimensions already at 100 are filtered out (line 254), and a dim whose stored `weight` is 0 (the `lensW[id] ?? 0` case, e.g. a lens missing that id) yields `upside = 0` and can never gain points — so a repo whose remaining headroom lives entirely in a zero-weight dimension is told the next level is *unreachable even by closing every gap to 100*, when the truth is the level is unreachable for a different (weighting) reason. The UI then renders "no path to climb" despite open gaps.
- **Root cause**: Reachability is inferred from a greedy projection rather than from the actual ceiling (project ALL dims to 100 once and check). Zero/near-zero effective weights and rounding at the band floor produce false "unreachable."
- **Impact**: misleading UX — a team is told leveling up is impossible when it is achievable, or is shown a "path" that doesn't actually cross the floor.
- **Fix sketch**: First compute `projectScore(report, {all dims → 100})`; if that is `< targetScore`, the band is genuinely unreachable — otherwise greedily build steps and assert the final projection crosses the floor (loop until it does, since the all-100 ceiling guarantees it).

## 4. Detector-failure / unknown-dimension zeros silently deflate the overall and pose as "strengths" in the mock
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/analyze/index.ts:601-617, src/lib/scoring/engine.ts:115/232, src/lib/llm/mock.ts:27-39
- **Scenario**: When a detector throws (pathological repo file), `analyzeSignals` substitutes a `signalScore: 0` result with signal label `"Signal extraction failed for this dimension"` (index.ts:610-614). That 0 is a *real* present dimension to `overallScoreFor`, so it is folded into the weighted mean and **drags the overall down** as if the repo genuinely scored 0 on that dimension — the renormalization that protects *dropped* dims does not protect a *present-but-failed* one. Separately, the mock's `dimSummary` marks a signal a "strength" unless its label matches `/^no\b/i` (mock.ts:29); the failure label does not, so a crashed detector is rendered as a 0-score "strength" in the keyless report.
- **Root cause**: A failed detector emits a definite 0 rather than an "unknown/unscored" sentinel, conflating "we measured zero evidence" with "we couldn't measure." The mock's positive-signal heuristic is a fragile string prefix test.
- **Impact**: wrong scores + misleading UX — one bad file can knock a whole dimension to 0 and lower the level; the keyless demo lists the failure as a strength.
- **Fix sketch**: Represent a failed detector as `signalScore: null`/unscored and exclude it from `overallScoreFor`/`axisScore` denominators (treat like a dropped dim); in the mock, classify strengths by score/explicit polarity, not a label regex.

## 5. `applyPrSignals`/`applyGovernanceSignals` run before the LLM blend but the guardband re-anchors to the boosted signal — PR evidence can be double-counted or capped away
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/analyze/pulls.ts:151-249, src/lib/scoring/engine.ts:75-81
- **Scenario**: PR + governance signals mutate `signalScore` (e.g. D6 = `0.65*signal + 0.35*prRigor`, D8 = `0.7*signal + 0.3*aiGovernedRate`) *before* the engine runs. The LLM, however, is shown the *post-fold* `signalScore` (prompt.ts:71, scan.ts:142-156) and told to "calibrate to these." Then the engine guardbands the LLM to ±25 of that same already-boosted signal and blends again. So a governed-AI repo gets the PR lift folded into the signal, fed to the LLM as ground truth, *and* the blend re-centers on it — the same evidence shapes the score at three stages, while the guardband simultaneously prevents the LLM from correcting an over-boosted signal by more than 25 points. A repo with `reviewedRate` inflated by a few approving rubber-stamp reviews rides D6/D8 up with no way for the auditor to pull it back.
- **Root cause**: PR/governance evidence is injected into the deterministic baseline that is then used as *both* the LLM calibration anchor *and* the blend floor *and* the guardband center — the guardband assumes the signal is independent ground truth, but it has already absorbed the same behavioral evidence the LLM sees.
- **Impact**: wrong scores — review/governance signals are over-weighted and the auditor's ability to correct them is structurally clamped.
- **Fix sketch**: Keep the PR/governance contribution as a separate, labeled addend with its own cap, or guardband the LLM against the *pre-fold* signal so the auditor can still discount an inflated review rate.

## 6. Recommendation PATCH is read-modify-write with no concurrency control — last writer wins, timeline can misattribute `from`
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/recommendations/[id]/route.ts:82-84 (+ updateRecommendation)
- **Scenario**: Two reviewers PATCH the same recommendation near-simultaneously (e.g. one sets `status: done`, another `assigneeLogin`). `updateRecommendation(id, patch, …)` reads current state to compute each timeline event's `from → to`, then writes. With no optimistic-concurrency guard (version/`updatedAt` check) or transactional read-then-write, the two requests interleave: the later write clobbers the earlier field and/or records a `from` value captured before the other change landed, so the activity timeline shows a transition that never happened (`from: open` when it was already `in_progress`).
- **Root cause**: The PATCH handler validates fields but delegates a non-atomic read-modify-write; there is no conditional update keyed on the version the client last saw.
- **Impact**: data corruption of the audit timeline + a silently lost field update under concurrent edits.
- **Fix sketch**: Make the update conditional (Prisma `update where {id, version}` / `updateMany` with a version bump, 409 on no-match) so the timeline `from` and the write are atomic and a stale writer is rejected, not silently merged.

## 7. `levelUnlock` in the fallback roadmap can read `L5->L5` and assumes a parseable `L#` id
- **Severity**: Low
- **Category**: code_quality
- **File**: src/lib/scoring/recommendations.ts:128-131
- **Scenario**: `nextLevelNum = Math.min(5, Number(current.id.slice(1)) + 1)`. When the repo is already L5, this yields `"L5->L5"` — a no-op "unlock" rendered to the user. And `Number(current.id.slice(1))` silently assumes the id is `L`+digit; a schema-drifted or hand-edited level id (e.g. `"L5b"`, `""`) makes `Number(...)` `NaN`, so `Math.min(5, NaN) = NaN`, producing `"…->LNaN"` in the roadmap copy.
- **Root cause**: The next-level label is derived by string-slicing and arithmetic on the level id instead of using the canonical `LEVELS` ordering (which the engine already does correctly via `findIndex`).
- **Impact**: UX — nonsensical `L5->L5` / `LNaN` unlock strings on the top band or on drifted data.
- **Fix sketch**: Derive next level via `LEVELS` index (as `cheapestPathToNextLevel` does); when already at the top, omit `levelUnlock` rather than emitting a self-referential transition.

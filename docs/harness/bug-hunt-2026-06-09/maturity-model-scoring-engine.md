# Bug Hunter Scan — Maturity Model & Scoring Engine (ascent)

> Total: 6 findings (Critical: 0 | High: 2 | Medium: 3 | Low: 1)

## 1. NaN coverage poisons every blended dimension score (no finite guard on the blend factor)
- **Severity**: High
- **Category**: NaN-propagation / recovery-gap
- **File**: src/lib/scoring/engine.ts:65
- **Scenario**: If `assembleReport` is ever called with a `snap.coverage` that is `NaN` or `undefined` (a hand-built snapshot, a future reconstructed-snapshot scoring path, a partial-ingestion fallback, or a test/calibration harness that forgets to set it), then `effectiveBlend = SCORE_BLEND * clamp(snap.coverage, 0, 1)` is `NaN`, and `score = Math.round(effectiveBlend * guarded + (1 - effectiveBlend) * s.signalScore)` becomes `NaN` for **every** dimension. The whole report's per-dimension scores, `overallScore`, axes, level, and posture all collapse.
- **Root cause**: `clamp(n, min, max)` is `Math.max(min, Math.min(max, n))`; `Math.min(1, NaN) === NaN` and `Math.max(0, NaN) === NaN`, so `clamp` does **not** sanitize a non-finite input — it passes NaN straight through. The blend assumes `coverage` is always a finite 0..1 (true on today's only caller via `estimateCoverage`, but nothing enforces it at the trust boundary).
- **Impact**: Silent total score corruption — a report that renders "NaN/L?" or, worse, persists NaN scores that break every downstream comparison/diff/projection. No warning is emitted because nothing throws.
- **Fix sketch**: Make `clamp` (or the blend) coerce non-finite input: `const cov = Number.isFinite(snap.coverage) ? clamp(snap.coverage, 0, 1) : 1;` and treat a missing coverage as full coverage (or 0) explicitly. Optionally harden `clamp` itself to `Number.isFinite(n) ? ... : min`.

## 2. Partial-LLM-coverage warning miscounts "assessed" dimensions when a detector failed or was unknown
- **Severity**: Medium
- **Category**: edge-case / off-by-count
- **File**: src/lib/scoring/engine.ts:130
- **Scenario**: If one detector throws (`s.failed`) or a signal has no rubric def, that dimension is dropped early in the `flatMap` (returns `[]`) and is **never** pushed to `llmMissing`. Later `const assessed = signals.length - llmMissing.length` still counts the dropped dim in `signals.length`. So with 9 signals, 1 failed, and the LLM scoring the other 8, the warning reads "AI assessed 9 of 9 dimensions" — overstating coverage and implying the failed dim was AI-validated.
- **Root cause**: Two different denominators. `signals.length` is the raw input set (includes skipped/failed/unknown dims), but `llmMissing` is only populated for dims that *survived* to the blend and lacked an LLM score. The subtraction silently conflates "dropped" with "assessed".
- **Impact**: Misleading provenance text — a repo whose detector crashed is reported as fully AI-assessed. Erodes the very "not fully AI-validated" honesty caveat this block exists to provide.
- **Fix sketch**: Count against the dims that actually reached the blend: track `scoredDims = dimensions.length` (post-flatMap) and report `assessed = scoredDims - llmMissing.length` of `scoredDims`, or compute `assessed = scoredDims - llmMissing.length` with `signals.length` replaced by `dimensions.length` in the message.

## 3. `aiGovernedRate` gate uses a stale `>= 3` threshold that disagrees with `applyPrSignals`/prompt expectations
- **Severity**: Medium
- **Category**: edge-case / small-sample distortion
- **File**: src/lib/analyze/pulls.ts:138
- **Scenario**: With exactly 1–2 AI-involved PRs, `aiGovernedRate` is `null` and D8 receives no PR governance signal (correct). But at exactly 3 AI PRs where, say, 1 was approved, `aiGovernedRate = 33%`, and `applyPrSignals` folds `0.7*signalScore + 0.3*33` into D8 — a hard drag derived from a 3-PR sample. A single unreviewed AI PR in a tiny window can swing D8 (a 12%-weight rigor dimension) by several points and flip the rigor axis / posture quadrant near the 50 threshold.
- **Root cause**: `n >= 3` is treated as "statistically meaningful" but the downstream blend applies a full 30% pull regardless of how few PRs underlie the rate. Tiny denominators produce high-variance rates that are then trusted like large-sample ones.
- **Impact**: Posture/axis instability for low-activity repos; an AI-native solo/team repo can be dragged to "Fast & Ungoverned" by one unreviewed PR.
- **Fix sketch**: Either raise the meaningful threshold (e.g. `>= 5`) or scale the D8 pull weight by sample confidence (e.g. `0.3 * min(1, aiInvolved/10)`), so a 3-PR rate nudges rather than dominates.

## 4. Glass-box `signed` contributions don't sum to ~0 because they re-center on the *rounded* overall
- **Severity**: Medium
- **Category**: invariant-violation / floating-point
- **File**: src/lib/scoring/engine.ts:355-356
- **Scenario**: `contributions()` computes `points = normalizedWeight * d.score` (exact) but `signed = normalizedWeight * (d.score - overall)` where `overall = report.overallScore` is the **rounded** headline. The documented invariant ("`signed` sums to ~0") only holds if `overall` equals the exact weighted mean `Σ points`. Because the headline was rounded (and, with dropped dims, can differ further), `Σ signed = Σ points - overall = total - overall`, which is the rounding residual (up to ±0.5+), not 0. A waterfall UI that asserts the signed bars net to zero will show a visible nonzero remainder.
- **Root cause**: Mixing the exact internal mean (`total`) with the rounded display score (`overallScore`) inside the same decomposition. The "sums to ~0" guarantee silently assumes they're equal.
- **Impact**: UX/auditability — the "why this score" waterfall's positive/negative bars don't balance; a strict client assertion could throw or render a phantom residual bar.
- **Fix sketch**: Re-center on the exact mean: compute `mean = Σ points` once, set `signed = normalizedWeight * d.score - normalizedWeight * mean` (or `points - normalizedWeight * mean`). Keep `overallScore` only for display.

## 5. `levelUnlock` from the LLM is rendered verbatim with no validation, so a hallucinated transition reaches users
- **Severity**: Low
- **Category**: validation-gap / silent-trust
- **File**: src/lib/llm/provider.ts:135 (validate) → consumed via src/lib/scoring/recommendations.ts:158
- **Scenario**: `validateAssessment` accepts any `levelUnlock` string from the model as-is (`r.levelUnlock.trim()`). A model can emit `"L5->L7"`, `"L3→L2"` (a downgrade), or garbage, and the roadmap surfaces it unchecked. The deterministic `buildFallbackRoadmap` carefully derives `unlock` from canonical `LEVELS` to avoid exactly this (`L5->L5` / `LNaN`), but the LLM path bypasses that safeguard.
- **Root cause**: The fallback roadmap was hardened against bad level ids; the primary (LLM) roadmap path was not given the same canonical-transition validation.
- **Impact**: UX — a confidently-wrong "unlocks L4->L6" badge in the user-facing roadmap; possible nonsensical/backwards transitions that undermine trust in the tool.
- **Fix sketch**: Validate `levelUnlock` against `LEVELS` ids and monotonic adjacency (or just `from->to` both valid and `to` index > `from` index); drop or normalize it to the canonical `current->next` otherwise.

## 6. `targetDate` accepts any `Date.parse`-able string, violating the documented `YYYY-MM-DD` contract
- **Severity**: Low
- **Category**: validation-gap (trust boundary)
- **File**: src/app/api/recommendations/[id]/route.ts:72
- **Scenario**: If a client sends `targetDate: "2026-06-09T13:45:00Z"`, `"June 9 2026"`, or `"2026/06/09"`, `Number.isNaN(Date.parse(...))` is false, so the value is stored verbatim as `patch.targetDate`. The type and error message both promise a `YYYY-MM-DD` ISO date, but the validator enforces only "parseable by `Date.parse`", which is implementation-dependent and far broader.
- **Root cause**: `Date.parse` is used as a format check when it is actually a permissive timestamp parser; it never asserts the date-only `YYYY-MM-DD` shape.
- **Impact**: Inconsistent stored data — date-only UI fields and pacing/sort logic downstream may misrender or mis-sort full-timestamp or locale-format values; the persisted backlog drifts from its documented schema.
- **Fix sketch**: Add a strict shape gate before `Date.parse`: `if (body.targetDate !== null && !/^\d{4}-\d{2}-\d{2}$/.test(body.targetDate)) return 400`, then optionally still verify it's a real calendar date.

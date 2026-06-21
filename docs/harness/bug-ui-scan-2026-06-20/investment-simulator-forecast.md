> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

# Investment Simulator & Forecast — combined bug+ui scan

## 1. Trajectory GPS reports 100% "trend confidence" on the thinnest possible data (2 points)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: forecast-overconfidence
- **File**: src/lib/maturity/forecast.ts:123 (and surfaced at src/components/org/Trajectory.tsx:96, src/lib/org/portfolio.ts:98, src/lib/org/briefing.ts:236)
- **Scenario**: An org has exactly two distinct scan days (the minimum `forecastTrajectory` accepts). OLS fits a line through the two points; R² is mathematically 1.0 for any 2 points regardless of noise. `fitQuality` = 1.0, so Trajectory renders "trend confidence 100%" and a confident quarter-ahead `projected` + a promotion/demotion ETA, off two observations.
- **Root cause**: R² measures how well a line fits the *observed* points, but with n=2 the line always passes through both points exactly (ssRes=0 → fitQuality=1). The forecast surfaces `fitQuality` as user-facing "confidence" without tempering it by `n` (`points` is computed but never used in the confidence read). Degrees-of-freedom (n−2 = 0 at two points) is ignored, so the least trustworthy fit is reported as the most trustworthy.
- **Impact**: Leaders see "100% trend confidence" and a hard ETA date ("reach L4 in ~6 weeks (2026-08-01)") drawn from two data points — the exact overconfident-fit trap the GPS was meant to avoid. Drives premature investment/planning decisions; the same inflated number flows into the executive briefing PDF and portfolio rollup.
- **Fix sketch**: Penalize confidence by sample size before display — e.g. compute adjusted R² (`1 − (1−R²)(n−1)/(n−2)`), which is undefined/0 at n=2, or gate the confidence label on `points >= 3` (show "low data" otherwise). Keep the raw `fitQuality` for the math but never render an un-tempered 100% on n=2.

## 2. `etaToNextLevel` mislocates a fractional score into the integer band-gaps (wrong fromLevel / suppressed ETA)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: off-by-one / band-boundary
- **File**: src/lib/maturity/forecast.ts:154
- **Scenario**: Call `forecastTrajectory` with a current value that lands between two integer bands, e.g. `current = 64.4` rising. `currentLevel` = `levelForScore(64.4)` rounds to 64 → L3. But `etaToNextLevel` does `LEVELS.findIndex(l => current >= l.band[0] && current <= l.band[1])` against L3 `[45,64]` (64.4 ≤ 64 is false) and L4 `[65,84]` (64.4 ≥ 65 is false) → returns −1 → `i = 0` (L1). The repo, actually ~0.6 below the L4 boundary and rising, is treated as sitting in L1; its promotion boundary becomes 25, `(25−64.4)/perDay < 0`, and the ETA is dropped to null.
- **Root cause**: The maturity bands are integer-inclusive with one-point gaps (24↔25, 44↔45, 64↔65, 84↔85), but `etaToNextLevel` matches against the *raw, unrounded* `current`, while the headline `currentLevel` matches against the *rounded* value via `levelForScore`. Any fractional value in a gap fails `findIndex` and silently defaults to L1, contradicting the level shown right next to it.
- **Impact**: Inconsistent forecast: the GPS can show "L3, rising" yet refuse to project the imminent L3→L4 promotion (or report `fromLevel` as L1). Currently latent because the only production caller (org-rollup `trend[].avg`) rounds values to integers before calling; but `forecastTrajectory` is exported and documented to accept any 0..100 value, and `projectGoal`/portfolio reuse it, so the defect is reachable as soon as a fractional series is passed.
- **Fix sketch**: Use `levelForScore(current)` (or round `current` once) for the band lookup so it agrees with `currentLevel`, instead of an inline `findIndex` over raw fractional input.

## 3. `suggestMoves` (ROI ranking) fails silently — no error, no empty feedback
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: silent-failure / error-state
- **File**: src/components/org/plan/Simulator.tsx:96
- **Scenario**: Click "Suggest (→ 70)". If `/api/org/simulate?rank` returns non-OK (e.g. 404 "No scanned repos to rank", 403, 503) or the fetch throws, `suggestMoves` only sets `ranking` on `res.ok`; the non-OK branch does nothing and the `catch {}` is empty. The button spins, then returns to "Suggest" with zero visible change.
- **Root cause**: Unlike `run()` (which has an `error` state and surfaces `data.error`), the ranking path has no error state and discards both the HTTP error body and thrown exceptions. The user can't tell the difference between "no dimension moves the fleet" and "the request failed".
- **Impact**: A broken/empty/forbidden ranking is indistinguishable from a working "no suggestions" result. Users re-click expecting a different outcome; a real backend failure is invisible. Undercuts the headline SIM-3 "where should we invest?" feature.
- **Fix sketch**: Add a rank-error state; on `!res.ok` read `data.error` and render it (reuse the existing orange-text error pattern), and surface a message in the `catch`. Distinguish "ranked, none positive" (empty list message already exists) from "request failed".

## 4. "Applies to N repos" counts repos whose rounded overall does not move
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: metric-consistency
- **File**: src/lib/scoring/orgsim.ts:158 (rendered at src/components/org/plan/Simulator.tsx:332)
- **Scenario**: Simulate raising a low-weight dimension (e.g. D6, weight 0.07) by a few points across repos already close to target. A repo flips `moved = true` (it was below target on that dim), so it's counted in `affected`, but `recomputeRepo` rounds the new weighted overall to the same integer — `delta = 0`. The result reads "Applies to 5 repo(s) currently below target" while "Biggest movers" (filtered to `delta > 0`) and `promotions` show fewer or none.
- **Root cause**: `affected` is defined as "a leg changed a dimension value", which is not the same as "the repo's rounded headline overall changed". Low-weight raises can be absorbed by rounding, so the two counts legitimately diverge with no explanation in the UI.
- **Impact**: Mild confusion — the headline count can exceed everything else shown, looking like dropped movers. Not data loss; the wording ("below target") is technically defensible.
- **Fix sketch**: Either keep `affected` but add a note when `affected > repos.filter(delta>0).length` ("N below target; M change the score after rounding"), or expose a separate `moved-the-score` count and label each precisely.

## 5. Target inputs accept out-of-range / blank values with no inline feedback
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: input-validation / form-polish
- **File**: src/components/org/plan/Simulator.tsx:250 (and the `extras` input at :283)
- **Scenario**: Type `999` (or clear the field, or type a non-numeric that yields NaN) into a "to" target. `setTarget(Number(e.target.value))` stores the raw number despite `min={0} max={100}`. The user only discovers the problem after clicking Simulate and getting a generic 400 error string from the server ("Each fix needs … 0..100"). Clearing the field yields `Number("") === 0`, silently simulating "raise to 0".
- **Root cause**: The `min`/`max` attributes are advisory only (they don't block typed/spinner values), and the change handler does no clamping or validation. Validation lives entirely server-side, so bad input round-trips before the user gets feedback.
- **Impact**: Avoidable round-trip + opaque error for a routine mistake; "raise to 0" runs as a real (nonsensical) scenario. Minor UX/polish gap.
- **Fix sketch**: Clamp on change (`clamp(Number(value)||0, 0, 100)`) or disable Simulate while a target is out of range / NaN, and mirror the same guard on the `extras` targets.

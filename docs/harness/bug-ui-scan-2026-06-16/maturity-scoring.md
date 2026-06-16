# Maturity Model & Scoring Engine — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 7

(Lens note: every in-scope file is pure backend/math — `model.ts`, `analyze/index.ts`, `analyze/pulls.ts`, `practices.ts`, `scoring/{engine,prompt,recommendations}.ts`, `types.ts`. There is no JSX/markup here, so there are no honest ui-perfectionist findings; per the prompt this surface skews bug-hunter, and all 5 findings are concrete latent bugs in the scoring math.)

## 1. Total detector failure silently scores a repo at L1 with no headline warning
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent failure / empty-set edge case
- **File**: src/lib/scoring/engine.ts:148-154 (with src/lib/analyze/index.ts:641-659 and src/lib/maturity/model.ts:227-237)
- **Scenario**: A pathological snapshot (corrupt/huge file, encoding bomb, or every detector throwing for the same upstream reason) makes `analyzeSignals` return all-`failed` dimensions. `assembleReport` then drops every one of them (`if (s.failed) return []` at line 88-93), so `dimensions` is `[]`. `overallScoreFor([], archetype)` hits `presentWsum <= 0` and returns `0`; `axisScore` returns `0` for both axes; `levelForScore(0)` returns L1.
- **Root cause**: There is no aggregate guard for "zero dimensions survived." Per-dimension `warnings` are pushed, but the report still composes a clean-looking `overallScore: 0`, `level: L1 Manual`, posture `early` — indistinguishable from a genuinely empty repo. The partial-coverage warning at line 135 is gated on `assessment.dimensions.length > 0` and on `llmMissing`, neither of which fires here.
- **Impact**: A scan whose entire deterministic backbone failed is reported as a confident "L1 — Manual" grade. This is the worst kind of silent failure: the system was built to "degrade to a partial result rather than no score," but a *total* failure degrades to a fabricated bottom grade with no top-level caveat. It persists, feeds trend diffs (`diffReports`), and bills the user.
- **Fix sketch**: After the `dimensions` flatMap, if `dimensions.length === 0` push a prominent warning ("no dimension could be measured — score is not meaningful") and either throw to trigger the scan's fallback path or stamp the report as `confidence: 0` + an explicit `unscored` flag the UI can render instead of "L1".

## 2. A dimension absent from the archetype lens silently vanishes from the headline mean
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: weight normalization / state corruption
- **File**: src/lib/maturity/model.ts:232-236 (consumed at src/lib/scoring/engine.ts:153, 211, 260)
- **Scenario**: `overallScoreFor` weights each dimension by `lensW[d.id] ?? 0`. Every current archetype lens defines all nine ids, so today this is latent — but the function is the single source of truth shared by the engine, `projectScore`, `projectedGain`, and the mock provider, and it is explicitly designed to be robust to "persisted/partial signals" and "unknown dim id" (see the `projectedGain` docstring at line 244-250). The moment a persisted scan, a new detector, or a future lens omits an id, that dimension is assigned weight 0 **and excluded from the renormalization denominator** — its score disappears from the overall with no warning.
- **Root cause**: `?? 0` conflates "this dimension legitimately has zero weight under this lens" with "I don't have a weight for this id." The former should still be excluded honestly; the latter is a config/data-drift bug that should warn, not be silently swallowed by the renormalizer the same way a dropped dimension is.
- **Impact**: Score drift that's invisible by construction. `projectedGain` even documents "an unknown dim id carries zero lens weight" as a *feature* — so the org backlog will stamp "+0 pts" on a real gap and `cheapestPathToNextLevel` (which ranks candidates by `d.weight * (100 - score)`, engine.ts:341) will never select it, telling the user a reachable level is unreachable.
- **Fix sketch**: Distinguish missing-key from zero-weight: if `lensW[d.id]` is `undefined` for an id that exists in `DIMENSION_BY_ID`, log/collect a warning (lens drift) rather than treating it as a silent 0. Keep `?? 0` only for genuinely unknown ids that were already warned about upstream.

## 3. Non-finite coverage is guarded in the blend math but propagates raw into `confidence`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: NaN propagation / trust boundary
- **File**: src/lib/scoring/engine.ts:183 (vs. the guard at line 70-71)
- **Scenario**: Line 70 carefully defends the blend: `const coverage = Number.isFinite(snap.coverage) ? snap.coverage : 1`, with a thorough comment about NaN poisoning every blended score. But that sanitized `coverage` is never reused for the report field — line 183 writes `confidence: snap.coverage` directly from the raw snapshot. A NaN/Infinity coverage estimate therefore yields correct scores but a NaN `confidence`.
- **Root cause**: Two reads of `snap.coverage` — one guarded (`coverage`), one raw (`snap.coverage`) — for the same value. The guard was applied only to the math path, not the surfaced/persisted field.
- **Impact**: `confidence: NaN` flows into `reportToComparable` (engine.ts:430) and the pure diff, serializes to `null` via `JSON.stringify` (silently losing the value on persistence), and breaks any UI percentage render or threshold comparison (`NaN >= x` is always false). The low-coverage warning path keys off coverage and may mis-fire. The very NaN the author worked to keep out of the math leaks out the display door.
- **Fix sketch**: Set `confidence: clamp(coverage, 0, 1)` using the already-sanitized `coverage` local, so the displayed/persisted confidence and the blend agree and can never be NaN.

## 4. Fallback roadmap ranks gaps by raw signal score, contradicting the blended headline
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state inconsistency / validation gap
- **File**: src/lib/scoring/recommendations.ts:146 (called from src/lib/scoring/engine.ts:161-163)
- **Scenario**: When the LLM returns an empty roadmap (or on the keyless mock path), `buildFallbackRoadmap` ranks dimensions by `upside = w[s.id] * (100 - s.signalScore)` and renders "scored {signalScore}/100" in each rationale. But the report's actual dimension scores are the **blended** scores (`effectiveBlend * guarded + (1 - effectiveBlend) * signalScore`, engine.ts:102), which can be up to `LLM_GUARDBAND` (25) points above or below the signal. So the roadmap is computed against numbers the user never sees.
- **Root cause**: The fallback consumes the raw `signals[]` (pre-blend) while the headline and the per-dimension cards show blended scores. The two diverge whenever the LLM nudged a dimension.
- **Impact**: A dimension the LLM lifted to e.g. 70 (blended) can still be ranked the #1 gap and shown as "scored 45/100," recommending work that's already largely reflected in the grade — and the inverse hides a real gap the LLM marked down. Undermines the "cheapest path to level up" credibility, and the rationale text states a score that contradicts the dimension card next to it.
- **Fix sketch**: Pass the blended `DimensionResult[]` (or a score map) into `buildFallbackRoadmap` and rank on the blended score, matching what the report displays and what `cheapestPathToNextLevel` uses; fall back to `signalScore` only when no blended score exists.

## 5. PR/governance boosts mutate `failed`-detector dimensions, masking a measurement failure
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state corruption / ordering
- **File**: src/lib/analyze/pulls.ts:178-225 and 252-269 (interaction with engine.ts:88-93 and types.ts:181-185)
- **Scenario**: `applyPrSignals`/`applyGovernanceSignals` run over the signal array *before* the engine sees it. If detector D6 or D8 threw, its placeholder carries `failed: true, signalScore: 0`. These functions match on `s.id === "D6"` etc. and recompute `signalScore` (e.g. `0.65 * 0 + 0.35 * prRigor`), spreading `...s` so `failed` is preserved but now pairing a *non-zero* signalScore with a failed flag, and appending real-looking PR evidence ("PR review coverage 80%") to a dimension that was never actually measured.
- **Root cause**: The PR/governance folders don't skip `failed` dimensions; they treat the placeholder `signalScore: 0` as a real measurement to blend against.
- **Impact**: Today the engine still drops `failed` dims (engine.ts:88), so the corrupted score is discarded — but the dimension now carries fabricated evidence strings and a contradictory `{ failed: true, signalScore: 42 }` state. Any consumer that reads signals without re-checking `failed` (a persisted-signal path, a future "show all evidence" view, or a refactor that stops excluding failed dims) will surface PR evidence for a dimension whose detector crashed. It's a latent landmine guarded only by one downstream `if`.
- **Fix sketch**: In both `applyPrSignals` and `applyGovernanceSignals`, early-continue on `s.failed` (`if (s.failed) return s;` inside the map) so a crashed detector's placeholder is never blended or decorated with evidence.

---

### Reply summary
- slug: maturity-scoring
- total findings: 5
- severity: 0 critical / 2 high / 3 medium / 0 low
- lens split: bug-hunter 5 / ui-perfectionist 0 (pure backend/math files — no UI surface)
- most critical: a total detector failure composes a confident "L1 — Manual" grade with no top-level warning (engine.ts:148-154)
- files read: 7

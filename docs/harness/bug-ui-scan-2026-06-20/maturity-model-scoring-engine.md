> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

# Maturity Model & Scoring Engine — combined bug+ui scan

## 1. Axis roll-ups charge a dropped/failed dimension at score 0 with full weight (posture deflation)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: scoring-math / renormalization
- **File**: src/lib/scoring/engine.ts:168
- **Scenario**: A detector throws (or a signal id has no rubric def), so that dimension is excluded from `dimensions` and from `scoreById`. `assembleReport` then computes `adoptionScore = axisScore("adoption", scoreFor, archetype)` and `rigorScore = axisScore("rigor", scoreFor, archetype)` with NO `isPresent` predicate. `scoreFor` returns `?? 0` for the absent dim, and `axisScore` (default `isPresent = () => true`, model.ts:254) includes every axis dimension in BOTH the weighted sum and the weight denominator — so the dropped dim is scored 0 at full weight, deflating that axis. Example: if D2 (a Rigor dim, weight 0.15 in the org lens) fails while every other dim is 90, the Rigor axis drops from 90 toward ~75, and a repo sitting just over the `POSTURE_THRESHOLD` of 50 on that axis can flip its posture quadrant (e.g. `ai-native` → `ungoverned`).
- **Root cause**: The overall roll-up was deliberately fixed to renormalize over present dims (`overallScoreFor(dimensions, …)` iterates only the present list, model.ts:227-237), and `axisScore` was given an `isPresent` parameter for exactly this purpose (its docstring: "an absent dimension is excluded from BOTH the weighted sum and the weight denominator instead of being charged at 0 with full weight (which deflated the axis and flipped the posture)"). But `assembleReport` never passes that predicate, so the axis path is inconsistent with the overall path on the failed-detector branch — the one branch this machinery exists to handle.
- **Impact**: Wrong (deflated) `adoptionScore`/`rigorScore` and a possibly-flipped `posture`. These are persisted (scans-persist.ts:200-202) and consumed across org-rollup, briefing, alerts and the posture quadrant chart, so a single failed detector silently mis-postures the repo everywhere — while the headline `overallScore` it sits next to is computed correctly, making the inconsistency hard to spot.
- **Fix sketch**: Build a present-id set and pass it as the predicate, mirroring `overallScoreFor`: `const present = new Set(dimensions.map(d => d.id)); const adoptionScore = axisScore("adoption", scoreFor, archetype, (id) => present.has(id));` (and likewise for rigor). When all 9 are present this is a no-op, so healthy scans are unchanged.

## 2. `aiGovernedRate` rate denominator threshold drifted from its documented contract
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: documentation / contract drift
- **File**: src/lib/types.ts:282
- **Scenario**: The `PrStats.aiGovernedRate` doc comment states "Null when too few AI PRs to be meaningful (sample < 3)", but the producer requires a sample of 5: `aiGovernedRate: aiInvolved >= 5 ? pct(aiApprovedCount, aiInvolved) : null` (pulls.ts:147). A repo with 3 or 4 AI-involved PRs now yields `null` even though the published type contract says it should produce a rate.
- **Root cause**: The `>= 3` floor was raised to `>= 5` in pulls.ts (with an in-file rationale comment) but the canonical type doc — the contract every consumer reads — was not updated, so the two now disagree on when the D8-feeding governance signal exists.
- **Impact**: No crash, but the governance signal that folds into D8 (12% weight) and feeds the LLM prompt is suppressed for 3–4-AI-PR repos contrary to the documented behavior; anyone reasoning from the type (test fixtures, downstream callers) gets the wrong null/non-null expectation. pulls.test.ts has no coverage of the 3/4 vs 5 boundary, so the drift is invisible.
- **Fix sketch**: Update the type comment to "(sample < 5)" to match the producer, and add a boundary test (4 AI PRs → null, 5 → a rate) so the threshold can't silently drift again.

## 3. Non-finite snapshot coverage flows unguarded into the persisted `confidence` column
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: validation gap / trust boundary
- **File**: src/lib/scoring/engine.ts:193
- **Scenario**: `assembleReport` carefully guards the blend math against a non-finite coverage (`const coverage = Number.isFinite(snap.coverage) ? snap.coverage : 1`, line 70) but then assigns the report's user/DB-facing `confidence: snap.coverage` straight from the RAW value (line 193). For a reconstructed/persisted snapshot (or any future coverage source) carrying `NaN`/`Infinity`, that raw value is persisted unguarded into the `confidence` float column (scans-persist.ts:203). The engine's own test even asserts this: `expect(Number.isFinite(guarded.confidence)).toBe(false)` (engine.test.ts:494).
- **Root cause**: The finite-guard was applied only to the load-bearing blend, intentionally leaving `confidence` echoing the raw coverage — but the persistence/render boundary downstream has no equivalent guard, so a `NaN` confidence reaches the DB and any `confidence * 100` UI ("NaN%") or a chart axis.
- **Impact**: A `NaN`/`Infinity` confidence can be written to the database (rejected by some float columns, stored as a poison value by others) and renders as "NaN%" in freshness/confidence UI. Low likelihood today because `estimateCoverage` (github/source.ts:641-653) always returns a bounded finite value, but the boundary is unprotected for any non-pipeline snapshot.
- **Fix sketch**: Reuse the already-computed guarded `coverage` for the report field: `confidence: Number.isFinite(snap.coverage) ? snap.coverage : 1` (or assign the local `coverage` variable from line 70), so the persisted/rendered confidence can never be non-finite.

## 4. Fallback-roadmap upside ranks by `def.weight`, diverging from the gain it actually projects
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: scoring-math / weight-source divergence
- **File**: src/lib/scoring/recommendations.ts:146
- **Scenario**: `buildFallbackRoadmap` ranks gaps by `upside = (w[s.id] ?? 0) * (100 - s.signalScore)` using the archetype lens `w`, and the surviving entries already passed a `DIMENSION_BY_ID[s.id]` filter — so for the real D1–D9 set the lens weight is always defined and the ranking is sound. The divergence only bites a *persisted/future* signal id that exists in `CATALOG` + `DIMENSION_BY_ID` but is absent from the archetype lens: `w[s.id] ?? 0` makes its upside 0, so it sorts to the bottom and is correctly de-prioritized — which is the intended behavior, not a defect. (Verified: this is consistent with `overallScoreFor`'s `lensW[id] ?? 0`, unlike `cheapestPathToNextLevel`'s candidate ranking which uses the report's stored `d.weight`.)
- **Root cause**: Two weight sources exist in the codebase (lens `?? 0` for scoring vs report `d.weight = lensW ?? def.weight` for display); the fallback roadmap correctly uses the lens source, so no live mis-ranking exists for the shipped dimension set — this is a latent foot-gun only if a dimension is ever added to the catalog/rubric but omitted from a lens.
- **Impact**: None for the current rubric (all 9 dims are in every lens). Documented as a low-value latent risk so a future lens edit that omits a dimension doesn't silently produce a roadmap entry whose ranked "upside" can't materialize.
- **Fix sketch**: When adding a dimension, the `weightsAreValid()` invariant (model.ts:185) already forces every lens to include it and sum to 1, which keeps this consistent; optionally add a unit assertion that every `DimensionId` key appears in every `ARCHETYPE_WEIGHTS` lens to make the coupling explicit.

## 5. LLM score for a failed-detector dimension is silently discarded with no warning
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent failure / observability
- **File**: src/lib/scoring/engine.ts:88-93
- **Scenario**: When a detector throws, its dimension is `s.failed` and is dropped from the blend (line 88-93) with a "not measured (detector error)" warning. But if the LLM *did* score that same dimension (its id is in the signal set, so it is in `llmById`), that LLM judgment is silently thrown away: the failed dim never reaches the blend, it is not added to `llmMissing`, and it is not the "scored a dimension not in the signal set" case (line 122-129) — so no warning mentions that real AI nuance for a present-but-unmeasured dimension was discarded.
- **Root cause**: The exclusion is keyed purely on the deterministic `s.failed` flag; the engine has no path to fall back to the LLM score when only the deterministic detector failed, nor a warning acknowledging the discarded LLM input.
- **Impact**: A dimension the LLM could have scored (from file excerpts the detector choked on) is dropped entirely rather than scored from the LLM alone, slightly under-reporting coverage; purely a missed-recovery/observability gap, not a correctness error. The existing "excluded (detector error)" warning still fires, so the report is not silently wrong.
- **Fix sketch**: For a `s.failed` dim that the LLM nonetheless scored, either (a) keep the dimension using the LLM score directly (no guardband, since there is no signal anchor) with a "scored from AI only — detector failed" note, or (b) leave the exclusion but append a warning that an available AI score was discarded, so the drop is auditable.

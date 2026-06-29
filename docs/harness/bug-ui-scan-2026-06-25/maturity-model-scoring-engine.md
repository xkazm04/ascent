# Maturity Model & Scoring Engine — Bug + UI Scan
> Context: Maturity Model & Scoring Engine (Repository Scanning & Scoring)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. projectSandbox re-rolls the axes without the "present dimension" predicate
- **Lens**: bug-hunter
- **Category**: state-corruption / consistency
- **File**: src/lib/scoring/engine.ts:310-313
- **Value**: impact 5 · effort 2 · risk 2
- **Scenario**: A scan where one detector threw (e.g. a pathological repo file) yields a report with only 8 `dimensions` — `assembleReport` correctly excludes the failed dim and passes a present-id predicate to `axisScore` (lines 174-177). The Roadmap Sandbox then calls `projectSandbox(report, {})`. Here `axisScore("adoption", scoreFor, report.archetype)` is called with NO 4th arg, so it defaults `isPresent` to `() => true` and iterates every rubric dimension of the axis. The dropped dim's `scoreFor` returns `scoreById.get(id) ?? 0`, so it is charged **0 at full weight** — deflating adoption/rigor and possibly flipping the posture quadrant.
- **Root cause**: The "renormalize over present dims" fix applied to `assembleReport` (#1) and `overallScoreFor` was not propagated to `projectSandbox`'s two `axisScore` calls; `projectScore` (used for `overall`) is unaffected because it routes through `overallScoreFor`, which renormalizes — so only the axes/posture drift, masking the bug in casual testing.
- **Impact**: The Sandbox's documented invariant ("with no overrides reproduces the report's own numbers exactly — overall, adoption, rigor, posture") silently breaks for any partial report: the slider's baseline posture/axes disagree with the report header, and every tick is offset. The existing test only exercises a full 9-dim report, so it never catches this.
- **Fix sketch**: Mirror `assembleReport`: build `const present = new Set(dimensions.map(d => d.id))` and pass `(id) => present.has(id)` as the 4th arg to both `axisScore` calls. Make the class impossible by having `axisScore` derive "present" from the scoreFor map (e.g. a sentinel) rather than relying on each caller to remember the predicate.

## 2. Advanced-signal detectors match file-path substrings → false score inflation
- **Lens**: bug-hunter
- **Category**: edge-case / silent-failure (false signal)
- **File**: src/lib/analyze/index.ts:250-260 (D2), 548-555 (D8)
- **Value**: impact 6 · effort 4 · risk 4
- **Scenario**: The advanced-rigor blobs concatenate `idx.lowerPaths.join(" ")` into the regex haystack. So a repo with `src/components/AccessibilityMenu.tsx` (no a11y *tests* at all) matches `/…|accessibility/` and earns D2 "+6 Accessibility tests" (line 257). Worse, in D8 a generic `src/eval.ts` (or a dependency like `json-eval` in `manifestText`) matches `\bevals?\b` and earns "+30 AI-output eval / golden-test harness" (line 554) — a 30-point lift on a 12%-weight rigor dimension from a filename.
- **Root cause**: Several "advanced" detectors widen their haystack to all tree paths and use bare substrings (`accessibility`, `coverage`, `\bevals?\b`, `\bk6\b`, `\bmutant\b`) that name a *concept* rather than the *tool/test artifact*. Presence of the word ≠ presence of the practice.
- **Impact**: Wrong dimension scores in the product's core IP. Partly mitigated on tokened scans because the LLM auditor can flag discrepancies — but the keyless **Mock provider** demo path (a headline feature) has no LLM, so the inflation stands unchallenged in exactly the most-shown surface.
- **Fix sketch**: Anchor these to real evidence: require the term in a config/manifest/workflow (drop `lowerPaths` for `accessibility`/`coverage`), or require a path that is itself a test artifact (e.g. `*.a11y.spec.*`, an `evals/`/`golden/` dir which D8 already checks separately). Add a calibration test with a decoy `eval.ts`/`Accessibility.tsx` asserting no credit.

## 3. Published rubric doc contradicts its own weights (stale 8-dimension numbers)
- **Lens**: ui-perfectionist
- **Category**: documentation / visual-consistency
- **File**: docs/MATURITY_MODEL.md:59,67,86,94
- **Value**: impact 4 · effort 1 · risk 1
- **Scenario**: The canonical table (lines 31-39) and `model.ts` agree: D1 15%, D2 15%, D4 12%, D5 9%. But the "Dimension detail" sub-headers still read **D1 (18%)**, **D2 (18%)**, **D4 (16%)**, **D5 (12%)** — the pre-D9 8-dimension weights. A reader scrolling to the D1 section sees a weight that the same document's summary table contradicts.
- **Root cause**: When D9 was added and the weights were rebalanced (and the archetype lens introduced), the summary table and `model.ts` were updated but the per-dimension detail headers were not.
- **Impact**: This doc is explicitly "the core IP… intentionally transparent… so scores are defensible." Self-contradictory weights undermine the defensibility claim and can mislead anyone reasoning about the rubric (or porting it).
- **Fix sketch**: Update the four detail headers to 15/15/12/9, or better, generate them from `DIMENSIONS`/`ARCHETYPE_WEIGHTS` so the doc can't drift from the rubric again.

## 4. `aiGovernedRate` doc says "sample < 3"; code requires `>= 5`
- **Lens**: bug-hunter
- **Category**: documentation / silent drift
- **File**: src/lib/types.ts:379-380 (vs src/lib/analyze/pulls.ts:147)
- **Value**: impact 2 · effort 1 · risk 1
- **Scenario**: The `PrStats.aiGovernedRate` JSDoc states "Null when too few AI PRs to be meaningful (sample < 3)." The implementation in `summarizePullRequests` actually gates on `aiInvolved >= 5` (and its own inline comment explains the floor was deliberately raised from 3 to 5 to stop a single PR from swinging the rigor axis near the posture threshold).
- **Root cause**: The threshold was bumped in `pulls.ts` but the type's contract comment was left at the old value.
- **Impact**: A maintainer trusting the type doc will mis-reason about when the D8 PR-governance fold engages (it's the difference between 3 and 5 AI PRs — exactly the boundary the fold was hardened around). No runtime bug, but a correctness-relevant doc lie on a scored signal.
- **Fix sketch**: Change the comment to "(sample < 5)" — and ideally hoist the `5` to a named constant referenced by both the code and the doc.

## 5. `fetchPrStats` documents a `null` return it can never produce, and throws instead
- **Lens**: bug-hunter
- **Category**: error-handling / recovery-gap
- **File**: src/lib/analyze/pulls.ts:272-282
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: The JSDoc says "Returns null only on transport failure," but the signature is `Promise<PrStats>` (non-nullable) and the body just `await fetchPullRequests(...)` then `summarizePullRequests(...)`. On a transport failure `fetchPullRequests` rejects, so `fetchPrStats` **throws** — it never returns `null`. A caller that trusts the doc and writes `const s = await fetchPrStats(...); if (!s) { /* degrade */ }` will skip its degrade path and let the rejection propagate, potentially failing a scan that should have continued PR-less.
- **Root cause**: The catch/`null` behavior implied by the comment was never implemented (or was refactored out), leaving the contract, the type, and the runtime behavior three-way inconsistent.
- **Impact**: Misleads error handling around an optional, best-effort signal; a recoverable PR-fetch failure can surface as a hard scan error depending on the caller.
- **Fix sketch**: Either wrap the body in try/catch and actually return `null` (and change the return type to `Promise<PrStats | null>`), or correct the doc to "throws on transport failure" and confirm callers wrap it. The signature and the comment must agree.

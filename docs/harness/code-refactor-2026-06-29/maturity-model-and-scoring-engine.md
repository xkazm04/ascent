# Code Refactor — Maturity Model & Scoring Engine
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. AI tool vocabulary duplicated and drifting across 3 files
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/analyze/pulls.ts:11-23 (AI_AGENT / AI_MARKER / AI_TOOLS); src/lib/analyze/index.ts:465-475 (AI_TRAILER + isAiCommit); src/lib/analyze/passport.ts:183
- **Scenario**: The set of AI-coding-tool names (claude, copilot, cursor, devin, codex, gemini, aider, …) is hand-encoded into at least five separate regexes/structures. Within `pulls.ts` alone it appears three times: `AI_AGENT` (`/(copilot|devin|cursor|codex|sweep|claude|aider)/`), the two alternations inside `AI_MARKER`, and the `AI_TOOLS` array. `index.ts` keeps a fourth near-copy in `AI_TRAILER`, and `passport.ts:183` an inline fifth.
- **Root cause**: The same domain vocabulary was copy-pasted per call site instead of being derived from one source list. It has already silently drifted: `AI_AGENT` lists `sweep` but `AI_MARKER` doesn't; `AI_MARKER`'s "generated with" branch only covers claude/copilot/cursor/codex (drops devin/gemini/aider); `AI_TRAILER` adds `sourcery` and `github-actions` that the PR side lacks. This is exactly the failure the author called out in the `isAiCommit` comment ("if one copy's regex was updated the others silently drifted") — but that fix only single-sourced the *commit* path, leaving the PR and passport paths divergent.
- **Impact**: Adding/renaming a tool requires editing 5 places; missing one means a real AI tool is counted in D7 commit attribution but invisible in PR stats (or vice-versa), quietly skewing the very signals the scoring engine blends. Maintenance + correctness-of-signal cost.
- **Fix sketch**: Define one `const AI_TOOLS = [{name, re}, …]` (or a `string[]` of names) in a shared module (e.g. `src/lib/analyze/ai-tools.ts`). Build `AI_AGENT`/`AI_MARKER`/`AI_TRAILER` alternations by joining the names (`new RegExp(`co-authored-by:\\s*(${names.join("|")})`, "i")`). Import it in `pulls.ts`, `index.ts`, and `passport.ts` so the vocabulary and its drift-prone alternations have a single source of truth.

## 2. `DimensionSignals.notes` is written everywhere but read nowhere (and its doc comment is false)
- **Severity**: Medium
- **Category**: dead-code
- **File**: src/lib/types.ts:282-283; src/lib/analyze/index.ts:85-86, 286, 540, 699
- **Scenario**: `Scorer.result(id, notes?)` threads a `notes` string into every `DimensionSignals` it returns; detectors populate it (`"tests=…, source=…"` for D2 at :286, `"aiCommits=…"` for D7 at :540, `"detector error"` at :699). The type field is documented as *"Optional notes passed to the LLM as extra context."*
- **Root cause**: A grep of the entire `src` tree shows `.notes` is never read by any consumer. The LLM prompt builder (`src/lib/scoring/prompt.ts`, `signalBlock` at :117-124) composes its evidence from `s.id`, `s.signalScore`, and `s.signals` only — it does **not** include `s.notes`. The engine (`evidenceStrings`, blend) ignores it too, as does persistence. So the field's stated purpose is unfulfilled: the computed notes are dead data and the doc comment is misleading.
- **Impact**: Wasted per-dimension string construction on every scan, plus a comment that actively misleads a maintainer into thinking the LLM sees these notes (it doesn't). Confusion + dead surface.
- **Fix sketch**: Either (a) wire it in — append `s.notes` to each dimension block in `prompt.ts`'s `signalBlock` so it genuinely reaches the LLM as the comment promises; or (b) remove the `notes` field from `DimensionSignals`, drop the optional param from `Scorer.result`, and delete the three call-site strings. Pick one; today it is the worst of both.

## 3. Repeated "search-blob" construction across five detectors (d8/d9 byte-identical)
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/analyze/index.ts:250, 327, 357, 548, 600
- **Scenario**: Five detectors each rebuild a lowercased haystack from the same `RepoIndex` views. `d8` (:548) and `d9` (:600) are byte-identical: `idx.lowerPaths.join(" ") + " " + idx.workflowText + " " + idx.manifestText`. `d2` (`adv`, :250) is the same three components reordered; `d3` (`deliver`, :327) and `d4` (`blob`, :357) are the two-component subset `lowerPaths.join(" ") + workflowText`.
- **Root cause**: The combined-text view was assembled ad hoc inside each detector instead of being exposed once on `RepoIndex`. `idx.lowerPaths.join(" ")` (an O(paths) string build) is also recomputed up to five times per scan as a side effect.
- **Impact**: Five copies of the same concatenation to keep in sync — broaden the haystack for one dimension (e.g. start including a new file view) and the others silently differ. Plus redundant work each scan. Moderate maintenance/consistency cost.
- **Fix sketch**: Add two memoized getters to `RepoIndex`: `get pathText()` (cached `lowerPaths.join(" ")`) and `get allText()` (`pathText + " " + workflowText + " " + manifestText`). Replace the `d8`/`d9` blobs with `idx.allText`, `d2`'s `adv` with `idx.allText` (order is irrelevant for `.test()`), and `d3`/`d4` with `idx.pathText + " " + idx.workflowText`. One definition, computed once.

## 4. `scoring/engine.ts` mixes four distinct concerns in one 475-line module
- **Severity**: Low
- **Category**: structure
- **File**: src/lib/scoring/engine.ts:1-475 (section banners at :208, :379, :427)
- **Scenario**: The file already self-documents four separable areas via comment banners: the blend/assembly (`assembleReport`), the what-if score simulator (`projectScore`, `projectDimensionClose`, `projectedGain`, `projectSandbox`, `cheapestPathToNextLevel`), glass-box attribution (`contributions`), and the score-delta engine (`reportToComparable`, `diffReports`).
- **Root cause**: Simulator, attribution, and diff helpers accreted onto the original assembly module over time rather than landing in their own files.
- **Impact**: Low — the module is well-sectioned and all exports are live. But its breadth makes it a frequent merge-contention point and forces consumers that only need, say, `contributions` or `diffReports` to import from a grab-bag module. Mostly an organization/discoverability cost.
- **Fix sketch**: Split along the existing banners into `engine.ts` (assembleReport), `simulator.ts` (projectScore/projectDimensionClose/projectedGain/projectSandbox/cheapestPathToNextLevel), `attribution.ts` (contributions), and `delta.ts` (diffReports/reportToComparable), or re-export them through an `index.ts` barrel to keep import paths stable. Update the handful of importers (RoadmapSandbox*, roadmapPieces, ScoreWaterfall, db/*, webhook/scan-alerts). Defer if churn isn't worth it — purely cosmetic.

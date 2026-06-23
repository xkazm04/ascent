# Code Refactor — Maturity Model & Scoring Engine
> Context group: Repository Scanning & Scoring
> Total: 4 findings (Critical: 0, High: 1, Medium: 2, Low: 1)

This context is, on the whole, clean: no dead exports (every public function — `diffReports`, `projectSandbox`, `cheapestPathToNextLevel`, `contributions`, `projectedGain`, `fetchPrStats`, `PRACTICES`, `DIMENSION_BY_ID`, `ARCHETYPE_LABEL` — has live callers in routes/components/db, verified by repo-wide grep), no stray `console.log`/`TODO`/`FIXME`/commented-out code, and no unused imports. `weightsAreValid` is referenced only by the module-load invariant, but that is a genuine use, not dead code. The `PRACTICES` (practices.ts) and `CATALOG` (recommendations.ts) per-dimension tables look superficially redundant but carry different shapes and serve different consumers — intentionally separate, not flagged. The findings below are real consolidation opportunities, ordered by value.

## 1. The "next maturity level" / fromIdx-clamp logic is re-implemented in four places
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/scoring/engine.ts:233-234, 278-280, 331-333; src/lib/scoring/recommendations.ts:132-133
- **Scenario**: Four functions independently re-derive "the index of the current level" and/or "the next level up" by hand off `LEVELS.findIndex((l) => l.id === ...)`, each re-implementing the same defensive guard for an unrecognized level id (schema drift / hand-edited persisted scan):
  - `projectScore` (engine.ts:233): `const fromIdx = Math.max(0, LEVELS.findIndex(...))`
  - `projectedGain` (engine.ts:278): `const fromIdx = Math.max(0, LEVELS.findIndex(...))`
  - `cheapestPathToNextLevel` (engine.ts:331-333): `const rawIdx = LEVELS.findIndex(...); const fromIdx = rawIdx >= 0 ? rawIdx : 0; const nextLevel = fromIdx < LEVELS.length - 1 ? LEVELS[fromIdx + 1] : null`
  - `buildFallbackRoadmap` (recommendations.ts:132-133): `const curIdx = LEVELS.findIndex(...); const nextLevel = curIdx >= 0 && curIdx < LEVELS.length - 1 ? LEVELS[curIdx + 1] : null`
- **Root cause**: Each function was added at a different time (projections, ROI, level-path, fallback roadmap) and each independently re-solved "where is this level in the ladder, and what's next?" — there is no shared helper in `model.ts` despite `levelForScore`, `LEVEL_BY_ID`, and `LEVELS` all living there.
- **Impact**: The clamp-to-L1 invariant ("an unknown level must NOT read as above everything / max out at L5") is now encoded four times in three subtly different idioms (`Math.max(0, …)` vs `rawIdx >= 0 ? rawIdx : 0` vs `curIdx >= 0 && …`). That is exactly the drift hazard the comments themselves warn about: a future edit that hardens one site (or adds a new band) silently leaves the others behind, producing inconsistent level-up / unlock semantics across the projection, ROI, level-path, and fallback-roadmap surfaces. Each site also carries a near-identical multi-line comment explaining the same `-1` guard.
- **Fix sketch**: Add two tiny helpers to `src/lib/maturity/model.ts` next to `levelForScore`:
  ```ts
  /** Index of a level id in the ladder, clamped to 0 (L1) for an unrecognized id. */
  export function levelIndex(id: string): number {
    return Math.max(0, LEVELS.findIndex((l) => l.id === id));
  }
  /** The next level up the ladder, or null at the top band. */
  export function nextLevel(id: string): MaturityLevel | null {
    const i = LEVELS.findIndex((l) => l.id === id);
    const idx = i >= 0 ? i : 0;
    return idx < LEVELS.length - 1 ? LEVELS[idx + 1]! : null;
  }
  ```
  Then: `projectScore`/`projectedGain` use `levelIndex(report.level.id)` (and `LEVELS.findIndex` for `toIdx`, or a `levelIndex(lvl.id)` since `levelForScore` always returns a valid band); `cheapestPathToNextLevel` uses `levelIndex` + `nextLevel`; `buildFallbackRoadmap` uses `nextLevel(current.id)`. Behavior-preserving — the helpers reproduce each existing clamp exactly — and the four duplicated comment blocks collapse to the helpers' doc-comments. Tests in engine.test.ts (`projectedGain` unknown-level, `cheapestPathToNextLevel` L5/unreachable branches) already pin the behavior, so the consolidation is verifiable.

## 2. `aiStandard(idx)` is computed twice per scan — once for D1, once for D8
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/analyze/index.ts:129-153, 176, 568
- **Scenario**: `aiStandard(idx)` returns a `{ d1, d8 }` split-result and is called once inside the `d1` detector (`for (const g of aiStandard(idx).d1)`, line 176) and again inside the `d8` detector (`for (const g of aiStandard(idx).d8)`, line 568). The function's whole body — the `.ai/manifest.yaml` presence + content regex, the `.ai/doctor.mjs` + lefthook/workflow "wired" check, and the `.ai/memory/` count — runs in full both times, but each caller throws away the half it doesn't need.
- **Root cause**: The `.ai/` standard legitimately splits across two dimensions (D1 = agent-facing contract, D8 = executable harness + memory), so the author returned both halves from one function. But the detectors run independently (`DETECTORS.map`), so neither call can reuse the other's work — the single function ends up evaluated twice.
- **Impact**: Redundant work every scan: a second `idx.content(".ai/manifest.yaml")` map-walk, a second `idx.content("lefthook.yml")`/`lefthook.yaml` lookup, and a second `idx.workflowText` regex test — all to discard the D1 result on the D8 call and vice-versa. The `{ d1, d8 }` shape is a small structural smell (a helper that returns two unrelated buckets so two callers can each ignore one). It is also a latent drift risk: the two halves are coupled inside one function but consumed in two detectors, so a future split could desync them.
- **Fix sketch**: Compute it once. Simplest behavior-preserving option: memoize per snapshot the way `aiCommitFlags`/`loweredTreePaths` already do — `const aiStandardBySnap = new WeakMap<RepoSnapshot, {d1; d8}>()` keyed on the immutable snapshot (matching the existing memo pattern at index.ts:461-479), so the second detector reads the cached result. (The `RepoIndex` is per-`analyzeSignals` call, so keying on `snap` is correct.) Pure refactor; the `signals.test.ts` ".ai/ standard scoring" cases pin D1 and D8 outputs and will confirm parity.

## 3. ADR / decision-record detection regex duplicated across the D5 and D8 detectors
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/analyze/index.ts:388-389, 548-551
- **Scenario**: The exact same two-pattern ADR test appears in both detectors:
  - D5 (line 388): `if (idx.has(/(adr|decisions?)\/.*\.(md|mdx)$/) || idx.has(/architecture-decision/))`
  - D8 (lines 549-550): `idx.has(/(adr|decisions?)\/.*\.(md|mdx)$/) || idx.has(/architecture-decision/)`
- **Root cause**: ADRs count toward both "Documentation & Knowledge" (D5) and "AI Process & Harness" (D8, as agent-readable runbooks/ADRs), so the same detection got copy-pasted into each detector rather than factored out.
- **Impact**: The ADR-path definition lives in two places; if the convention is ever broadened (e.g. add `rfcs/` or `.adr` extensions), one detector can be updated and the other silently left behind, drifting D5 and D8 against each other. Low blast radius (two literal copies) but a clear single-source-of-truth opportunity in a file that already centralizes shared regexes like `TEST_PATH`, `AI_TRAILER`, and `CONVENTIONAL`.
- **Fix sketch**: Hoist a module-level `const ADR_PATH = /(adr|decisions?)\/.*\.(md|mdx)$/;` (and optionally `const ADR_HINT = /architecture-decision/;`) beside the other shared path regexes near the top of `index.ts`, then have both detectors call `idx.has(ADR_PATH) || idx.has(ADR_HINT)`. Behavior-identical (same regexes), guarded by `calibration.test.ts` (D3/D5/D8 signal pins) and `signals.test.ts`.

## 4. Signal → evidence-string formatting duplicated between the engine and the prompt builder
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/scoring/engine.ts:40-42; src/lib/scoring/prompt.ts:117-120
- **Scenario**: Two places turn a `Signal { label, detail? }` into a human string with the same `label (detail)` shape:
  - engine.ts:41 — `s.signals.map((x) => (x.detail ? `${x.label} (${x.detail})` : x.label))`
  - prompt.ts:119 — `.map((x) => `    - ${x.label}${x.detail ? ` (${x.detail})` : ""}`)`
- **Root cause**: The report-evidence list (engine) and the LLM signal block (prompt) were written independently, each inlining the same "append `(detail)` when present" rule with its own surrounding prefix.
- **Impact**: Minor — the core `label (detail)` rule is expressed twice, so a change to how a signal renders (e.g. trimming, escaping) would need to be made in both. Cosmetic; the two outputs intentionally differ in their list-prefix/indentation, so the shared part is small.
- **Fix sketch**: Optional. Extract a tiny `formatSignal(x: Signal): string` (in `types.ts` near the `Signal` interface, or a `lib/maturity` helper) returning `x.detail ? `${x.label} (${x.detail})` : x.label`. `evidenceStrings` becomes `s.signals.map(formatSignal)`; prompt.ts maps `\`    - ${formatSignal(x)}\``. Low value — flag only if touching these files anyway; the divergent prefixes mean the consolidation saves little.

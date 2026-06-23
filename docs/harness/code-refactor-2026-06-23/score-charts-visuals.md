# Code Refactor — Score Charts & Visuals
> Context group: Reporting & Visualization
> Total: 5 findings (Critical: 0, High: 0, Medium: 3, Low: 2)

This context is in good shape: the charts genuinely earn their "dependency-free SVG" framing, the
shared primitives (`chartScale`, `chartMotion`, `chartHover`, `ui.ts`, `LevelBadge`) are real and
broadly reused, and there is **no dead code, no stray `console.*`, no commented-out blocks, and no
stale TODOs** in any of the 14 files. The findings below are all duplication/structure consolidation
opportunities, each behavior-preserving. No Critical/High items — nothing here is a live bug source
or a misleading dead module.

## 1. `0..100 → pixel` clamp-scale closures re-derived in every radial/SVG chart
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/PostureQuadrant.tsx:55-56, src/components/report/DimensionCard.tsx:122, src/components/report/ScoreRing.tsx:24
- **Scenario**: Each non-time-series chart hand-rolls the identical "clamp a 0..100 value to range, then map linearly to pixels" closure. `PostureQuadrant` has `toX = (v) => x0 + (Math.max(0, Math.min(100, v)) / 100) * w` and the mirrored `toY`; `DimensionCard.ProvenanceTrack` has `x = (v) => padX + (Math.max(0, Math.min(100, v)) / 100) * (W - padX * 2)`; `ScoreRing` clamps the same way inline (`safeScore = Number.isFinite(score) ? Math.max(0, Math.min(100, score)) : 0`). The sibling `chartScale.ts` already centralizes exactly this idea for the *time-series* charts (`vScale`/`xScale`) and its header comment even says "Each chart previously re-derived the same 0..100 scale… centralizing them here is composition over duplication" — but the radial/track charts never got an equivalent shared linear-scale helper.
- **Root cause**: `chartScale.ts` was introduced to de-dupe the line/sparkline charts (DimLine/TrendChart) and stopped there; the radial charts (radar, ring, quadrant, provenance track) were written/extracted independently and each kept its own inline math. Note `chartScale.vScale` also includes the `Number.isFinite` NaN-guard that the inline copies in PostureQuadrant and DimensionCard omit — so the copies have already subtly drifted from the guarded canonical version.
- **Impact**: Four copies of the same clamp-and-scale logic to keep in lockstep; the NaN-guard divergence means a drifted/bad score that `vScale` would survive could still produce a NaN coordinate in the quadrant/provenance track. Any future change to scale behavior (e.g. a domain other than 0..100) must be made in 4 places.
- **Fix sketch**: Add a pure `linScale(domainMax: number, rangeStart: number, rangeLen: number): (v: number) => number` (with the same `Number.isFinite` clamp as `vScale`) to `chartScale.ts`. Then in `PostureQuadrant` build `toX`/`toY` from it, in `ProvenanceTrack` build `x` from it, and route `ScoreRing`'s `safeScore` clamp through a shared `clamp01to100` (or reuse the closure). No visual change — the geometry is identical, the copies just gain the guard.

## 2. Mount-driven staggered fill-bar idiom duplicated across the three bar visuals
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/DimensionCard.tsx:31-32, src/components/report/ScoreWaterfall.tsx:52-53, src/components/report/PosturePanel.tsx:47-48
- **Scenario**: The "fill bar that grows from 0 on mount with a per-row staggered ease-out, snapping to final under reduced-motion" pattern is written out by hand in three places. `DimensionCard`: `fillWidth = reduced || mounted ? \`${d.score}%\` : "0%"` + `fillTransition = reduced ? undefined : \`width 0.7s ease-out ${Math.min(index * 60, 480)}ms\``. `ScoreWaterfall`: `width = mounted || reduced ? \`${c.points}%\` : "0%"` + `transition = reduced ? undefined : \`width 0.7s ease-out ${Math.min(i * 50, 400)}ms\``. `PosturePanel.AxisBar` renders the same visual bar but un-animated (`width: \`${value}%\`` with a bare `transition-all`), so it reads inconsistently next to the other two.
- **Root cause**: Each bar was authored where it was needed; the shared `chartMotion` module gives them `useMounted`/`usePrefersReducedMotion` but stops at the hooks — there's no shared helper that turns `(value, index, reduced, mounted)` into the `{ width, transition }` style pair, so each call site re-expresses the formula (and the per-stagger constants 60/480 vs 50/400 differ for no documented reason).
- **Impact**: Three copies of the same animation recipe with slightly drifting magic numbers; the static `AxisBar` is visually out of step with its animated siblings. A change to the motion language (timing, stagger cap, reduced-motion behavior) must be replicated and reconciled by hand.
- **Fix sketch**: Add a tiny helper in `chartMotion.ts`, e.g. `fillBarStyle({ pct, index = 0, mounted, reduced, stagger = 60, cap = 480 }): { width: string; transition?: string }`, returning `{ width: mounted || reduced ? \`${pct}%\` : "0%", transition: reduced ? undefined : \`width 0.7s ease-out ${Math.min(index * stagger, cap)}ms\` }`. Call it from all three (passing `index` for the two animated ones, default 0 for `AxisBar`, which would also give the posture bars a consistent entrance). Behavior-preserving if the existing per-call constants are passed through.

## 3. `fmtPts` number formatter lives in `PosturePanel` and is cross-imported by `ScoreWaterfall`
- **Severity**: Medium
- **Category**: structure
- **File**: src/components/report/PosturePanel.tsx:55-59
- **Scenario**: `fmtPts(n)` — a generic "round to 1dp, drop trailing `.0`" number formatter — is exported from `PosturePanel.tsx`, a component module that otherwise renders the posture panel. `ScoreWaterfall.tsx` imports it via `import { fmtPts } from "@/components/report/PosturePanel"` (used 4× there), creating a component-to-component utility dependency where neither file is the natural home for a formatter.
- **Root cause**: The helper was added next to its first caller (`PosturePanel`/its waterfall neighbor) and then reused by `ScoreWaterfall` rather than promoted to a shared module — the path of least resistance.
- **Impact**: Importing a component module just to get a pure formatter pulls the whole `PosturePanel` (and its `PostureQuadrant`/`Surface` import graph) into the dependency chain of any formatter consumer, and obscures where shared number-formatting lives. It's a small but real "utility hiding in a component" wart that invites more of the same.
- **Fix sketch**: Move `fmtPts` to a shared utility home — `@/lib/ui` (which already hosts `scoreGlyph`/`scoreHex` and similar pure formatters) is the most consistent target; alternatively `chartScale.ts` if you prefer chart-local utilities. Update the two importers (`PosturePanel` self-use and `ScoreWaterfall`). Pure function move, no behavior change.

## 4. `Charts` barrel mixes chart-component and motion-hook re-exports, splitting the hook import path
- **Severity**: Low
- **Category**: structure
- **File**: src/components/report/Charts.tsx:6-9
- **Scenario**: `Charts.tsx` is a migration barrel that re-exports the co-located chart components (`ScoreRing`/`RadarChart`/`PostureQuadrant`) *and also* re-exports the two motion hooks from `chartMotion` (`useMounted`, `usePrefersReducedMotion`). The result is an inconsistent convention for the same two hooks: `DimensionCard.tsx` and `ScoreWaterfall.tsx` import them via `@/components/report/Charts`, while `PostureQuadrant.tsx` (and the out-of-scope `RemotionStage`/`useCountUp`/landing prototypes) import them straight from `@/components/report/chartMotion`.
- **Root cause**: When the charts were split out of the old monolithic `Charts.tsx` into co-located files, the barrel kept the hook re-export so pre-split imports wouldn't break — but the canonical home (`chartMotion`) also exists, so two valid paths now coexist and callers picked arbitrarily.
- **Impact**: Cosmetic but confusing — two import paths for identical hooks, and a "charts" barrel that doubles as a motion-hook barrel. Makes the dependency direction harder to reason about (a chart component importing hooks "through" the barrel that re-exports it).
- **Fix sketch**: Drop the `export { useMounted, usePrefersReducedMotion } from "@/components/report/chartMotion"` line from `Charts.tsx` and point `DimensionCard`/`ScoreWaterfall` at `@/components/report/chartMotion` directly (matching `PostureQuadrant` and every other consumer). Leaves `Charts.tsx` a clean component barrel. Behavior-preserving; only the two import lines change.

## 5. Local `r2` rounding helper in `RadarChart` shadows the outer dimension-count `n`
- **Severity**: Low
- **Category**: cleanup
- **File**: src/components/report/RadarChart.tsx:37,42
- **Scenario**: Line 37 binds `const n = dimensions.length` (used by `angleFor` as the vertex count). Line 42 then defines the coordinate-rounding helper `const r2 = (n: number) => Math.round(n * 100) / 100`, whose parameter reuses the name `n` — so inside `r2`, the dimension-count identifier is shadowed by an unrelated "number to round" argument.
- **Root cause**: A terse one-line helper grabbed the shortest convenient parameter name without noticing it collided with the meaningful outer `n`.
- **Impact**: Purely readability/maintainability — a reader scanning `r2` sees `n` and may momentarily conflate it with the dimension count; a future edit inside `r2` referencing `n` would silently get the parameter, not the count. No runtime effect.
- **Fix sketch**: Rename the parameter, e.g. `const r2 = (v: number) => Math.round(v * 100) / 100`. One-token change, no behavior impact.

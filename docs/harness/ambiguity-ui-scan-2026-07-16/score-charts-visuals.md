# Score Charts & Visuals — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Radar picker is pointer-only: no keyboard path and no touch path (missing the onPointerDown fix DimLine already has)
- **Severity**: High
- **Category**: a11y
- **File**: `src/components/report/RadarChart.tsx:102-109`
- **Scenario**: When `onSelect` is provided the radar "becomes a picker", but the whole interaction lives on an `svg role="img"` with `onClick` that only fires when `active` was set by `onPointerMove`. A keyboard user has no focusable element at all (the sr-only table is static, not interactive), and a stationary touch tap may never fire `pointermove`, leaving `active === null` so the click is a no-op — the code even admits it: "desktop pointer only". DimLine hit the identical touch gap and fixed it with an `onPointerDown` snap + `useCoarseTapToOpen`; RadarChart got neither.
- **Root cause**: Selection state is derived exclusively from hover proximity; no focusable/semantic control mirrors the pick action, and the touch-snap pattern from the sibling chart wasn't back-ported.
- **Impact**: On the Dimensions explorer, keyboard and most touch users cannot use the radar to select a dimension — a silent capability cliff on an interactive control that also violates WCAG 2.1.1 (Keyboard). The bar list presumably remains usable, but the radar advertises interactivity (`cursor: pointer`) it can't deliver to them.
- **Fix sketch**: Add `onPointerDown={onPointerMove}` (as DimLine does) so a tap resolves `active` before click; and make the sr-only table rows real `<button>`s (or add per-vertex `<circle tabIndex={0} role="button" onKeyDown>` targets) that call `onSelect(d.id)`, mirroring DimLine's sr-only link list pattern.

## 2. PostureQuadrant hardcodes an off-system palette and 10px slate-600 labels that fail the contrast bar RadarChart documents
- **Severity**: High
- **Category**: visual-inconsistency
- **File**: `src/components/report/PostureQuadrant.tsx:10-21,119-141`
- **Scenario**: `QUAD_TINT` hardcodes four hexes: three are score-ramp colors (L5 green, L2 orange, L1 red) reused for *posture semantics*, and `manual: "#3b9eff"` is a blue that exists nowhere in `LEVEL_HEX`, `CHART_INK`, or the brand tokens (the radar deliberately migrated to `var(--color-accent)` for re-skins; this chart won't retune). Meanwhile inactive quadrant labels render `fill="#475569"` (slate-600) and the axis labels `fill-slate-500`, both at 10px — RadarChart's own inline comment establishes that slate-500 on this canvas is ~3.9:1, below the AA 4.5:1 floor for small text, and slate-600 is worse (~2.7:1).
- **Root cause**: The quadrant was built before/outside the CHART_INK + token consolidation; its label typography reuses the "muted mono uppercase" recipe without applying the contrast lesson recorded 30 lines into a sibling file.
- **Impact**: A white-label re-skin leaves this one chart on the old palette; the "manual" blue reads as a fifth, unexplained hue next to the red→green ramp used everywhere else; and low-vision users cannot read three of the four quadrant names or either axis label — on the chart whose entire job is naming where you sit.
- **Fix sketch**: Move `QUAD_TINT` next to `CHART_INK`/`LEVEL_HEX` (or tokenize as `--color-posture-*`), document why posture colors intentionally alias score-ramp stops (or pick distinct hues), and lift inactive label ink to slate-400 with `fontSize={11}` per the RadarChart precedent.

## 3. QUAD_LABEL is a second, already-drifted source of truth for posture names
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/report/PostureQuadrant.tsx:16-21`
- **Scenario**: `QUAD_LABEL` hand-copies posture display names: `ungoverned: "Ungoverned"`, `manual: "Manual"`, `early: "Getting started"`. The canonical `POSTURE_META` in `src/lib/maturity/model.ts:372-376` says "Fast & Ungoverned", "Solid but Manual", "Getting Started". So PosturePanel's headline (`report.posture.label`) and the quadrant sitting right beside it in the same Surface can disagree — including a plain casing bug ("Getting started" vs "Getting Started"). Nothing records whether the short forms are intentional abbreviations for the tight SVG or accidental drift.
- **Root cause**: Duplicated display strings with no link (import, comment, or test) to the canonical taxonomy; adding a posture or renaming one must be remembered in two files.
- **Impact**: Users see two names for the same posture in one panel; a taxonomy rename in model.ts silently strands the chart; the `?? "#475569"` drift-guard on `QUAD_TINT` shows the authors already expect ids to drift, yet labels have no guard at all.
- **Fix sketch**: Derive labels from `POSTURE_META` (add an optional `short` field there if abbreviations are wanted), or at minimum fix the casing and add a comment + unit test asserting `QUAD_LABEL`/`QUAD_TINT` keys and spellings track `POSTURE_META`.

## 4. PrSignalsPanel magic thresholds: `revertRate > 10` twice, "≤200 lines" restated, and maturity-band colors applied to rates
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/components/report/PrSignalsPanel.tsx:73-83`
- **Scenario**: The "elevated" revert warning fires on `stats.revertRate > 10`, written literally twice (color + flag) with no constant and no rationale — yet the scoring engine (`src/lib/analyze/pulls.ts:179`) penalizes reverts on a continuous `100 - revertRate * 6` ramp, so 10% is a UI-only cliff unrelated to how the score actually moves. The "≤200 lines" small-PR hint is a third hand-copy of the analyzer's threshold (also in `types.ts:383` and `scoring/prompt.ts:31`). And `scoreHex(mergeRate)` / `scoreHex(smallPrRate)` silently assume the L1–L5 maturity bands (25/45/65/85) are meaningful cut-points for *rates* — e.g. a 60% small-PR rate paints L3 yellow with no recorded reasoning that 60% small PRs is "Defined"-tier.
- **Root cause**: Presentation-layer thresholds chosen ad hoc, never lifted to named constants beside the analyzer values they must track.
- **Impact**: Retuning the analyzer's small-PR definition or revert weighting leaves the panel lying about what it measures; the 10% cliff shows a repo at 11% as warn-orange "elevated" and 10% as plain white with no explanation anywhere of why.
- **Fix sketch**: Export `SMALL_PR_MAX_LINES` and a documented `REVERT_RATE_ELEVATED` from `src/lib/analyze/pulls.ts` (with a one-line why), import both here; add a short comment justifying (or replacing) the score-ramp coloring of rate metrics.

## 5. PosturePanel's AxisBar hand-rolls a fill bar with an un-gated `transition-all`, bypassing the fillBarStyle/reduced-motion contract
- **Severity**: Medium
- **Category**: component-extraction
- **File**: `src/components/report/PosturePanel.tsx:47-49`
- **Scenario**: `AxisBar` renders the same "colored fill on a slate-800 rounded track" as DimensionCard and ScoreWaterfall, but inline: `className="... transition-all"` with `width: value%`. `chartMotion.ts` exists precisely to centralize this (`fillBarStyle`: mount-grow, stagger, reduced-motion snap), and ScoreRing's comment declares "every sibling chart already gates its transitions on this hook". AxisBar gates nothing: `transition-all` animates for `prefers-reduced-motion` users whenever `value` changes, and animates *every* property, not just width. It also gets no entrance animation, so the two posture bars pop while every neighboring bar in the report grows in — plus `h-2` here vs `h-1.5` (DimensionCard) vs `h-4` (waterfall) with no recorded scale rationale.
- **Root cause**: PosturePanel is a server component, so the client `fillBarStyle`/hooks couldn't be dropped in directly and a bare CSS class was used instead; the trade-off was never noted.
- **Impact**: A WCAG 2.3.3-adjacent inconsistency (the exact violation ScoreRing's comment fixed elsewhere) if the panel is ever fed live values, visible motion inconsistency today, and a third slightly-different fill-bar implementation to keep in sync.
- **Fix sketch**: Extract a small client `<FillBar pct color />` built on `fillBarStyle` + `usePrefersReducedMotion` and use it in PosturePanel, DimensionCard, and ScoreWaterfall; at minimum replace `transition-all` with a motion-safe `motion-safe:transition-[width]`.

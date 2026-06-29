# Score Charts & Visuals — Bug + UI Scan
> Context: Score Charts & Visuals (Reporting & Visualization)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. LevelBadge crashes on an unknown / drifted level id
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/components/LevelBadge.tsx:10-16
- **Value**: impact 6 · effort 1 · risk 1
- **Scenario**: `const lc = LEVEL_CLASSES[id]` and `LEVEL_GLYPH[id]` index the lookup maps directly by `id` with NO fallback. `src/app/trends/page.tsx:130` renders `<LevelBadge id={latest.level as LevelId} …>` where `latest.level` is a stored history string force-cast to `LevelId`. If a persisted/legacy/hand-edited scan carries any id outside L1–L5 (e.g. `"L0"`, `""`, a rolled value), `lc` is `undefined` and `lc.border` throws → the entire Trends header / report headline crashes.
- **Root cause**: Every other level-id consumer in this codebase clamps drift (`levelForScore`, `levelIndex` → "clamped to L1 for an unrecognized id", `QUAD_TINT[posture.id] ?? "#475569"`, `scoreHex` via `levelForScore`). `LevelBadge` is the lone consumer that trusts the raw id — and it's fed a `as LevelId` cast, the codebase's own documented threat model for schema drift.
- **Impact**: Render crash (white screen / error boundary) on the trends page from a single bad DB row, not a graceful degrade.
- **Fix sketch**: `const lc = LEVEL_CLASSES[id] ?? LEVEL_CLASSES.L1` and `LEVEL_GLYPH[id] ?? LEVEL_GLYPH.L1`, making the unknown-id class impossible to dereference — mirroring `levelIndex`'s clamp-to-L1 contract.

## 2. Radar axis labels can be clipped at the left/right viewBox edges
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/components/report/RadarChart.tsx:36,109-120
- **Value**: impact 5 · effort 4 · risk 2
- **Scenario**: Labels are placed at `point(i, 1.2)` (20% beyond the plot radius) with `textAnchor` start/end. With `radius = size/2 - 56` (114px at the default 340), the west/east vertices land at x ≈ 35 / 305. A longer `DIMENSION_SHORT` label (e.g. **"AI Process"** = D8, which sits west, anchored `end` at x≈35) extends leftward to roughly x = −20, past the viewBox origin; the SVG root clips overflow, so the label is cut off / partly illegible.
- **Root cause**: The 56px radius inset reserves vertical room but not enough horizontal room for variable-width text at the 1.2 frac with start/end anchors; label width isn't accounted for.
- **Impact**: A dimension name is visually truncated on the canonical 8–9-dimension radar — looks like a layout bug and hurts scanability.
- **Fix sketch**: Increase the inset (e.g. `size/2 - 64`) or clamp label x into `[pad, size-pad]`, or reduce frac to ~1.12 for the near-horizontal anchors; alternatively wrap/abbreviate the longest tokens.

## 3. RadarChart hover uses a non-null assertion on a stale `active` index
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: state-corruption
- **File**: src/components/report/RadarChart.tsx:104-107,124-139
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: `active` is held in state; the highlight ring and tooltip read `dataPts[active]![0]` / `dimensions[active]!`. If a parent ever swaps `dimensions` for a SHORTER non-empty array while a vertex tooltip is open (the empty case is guarded, length-shrink is not), `dataPts[active]` is `undefined` and `undefined![0]` throws a TypeError mid-render. Today's callers (ScoringTab, RoadmapSandbox) keep the count fixed, so it's latent — but the sibling `DimLine` already defends this (`act = present[a]` left as `undefined`, then every `act && …` guard short-circuits), so the radar is an inconsistent gap.
- **Root cause**: `active` persists across renders but is only validated at set-time; the `!` assertions assume it still indexes the current array.
- **Impact**: Render crash in the rare shrink-while-hovering path; no graceful fallback.
- **Fix sketch**: Clamp/validate before use — `const act = active != null ? dataPts[active] : undefined;` then gate the ring/tooltip on `act` (the DimLine pattern), removing the `!`.

## 4. ScoreRing renders the raw, unclamped score in its numeral and aria-desc
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/components/report/ScoreRing.tsx:26,42,58
- **Value**: impact 3 · effort 1 · risk 1
- **Scenario**: The geometry is correctly hardened — `safeScore = clamp01to100(score)` drives `strokeDashoffset` so a NaN/out-of-range score can't render a full ring. But the big numeral (`{score}`) and the screen-reader desc (`Score ${score} of 100`) print the RAW `score`. A NaN or 137 would draw a correct-looking arc yet display "NaN" / "137" to sighted and screen-reader users alike — the clamp protects the picture but not the label.
- **Root cause**: Two sources of truth: the arc uses `safeScore`, the text uses `score`.
- **Impact**: Confusing/incorrect headline number in the degenerate case; the defensive clamp's intent ("the arc length can't lie") is undermined by the text that can.
- **Fix sketch**: Display `safeScore` (or `Math.round(safeScore)`) in both the numeral and the desc so geometry and label agree.

## 5. DimensionCard shows a redundant minus on negative deltas ("▼-3"), unlike the waterfall
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/components/report/DimensionCard.tsx:46-51
- **Value**: impact 2 · effort 1 · risk 1
- **Scenario**: For a drop, the card renders `▼` then the raw signed `{delta}` (a negative number) → "▼-3", a down-arrow next to a minus sign. The directly-comparable ScoreWaterfall itemization (ScoreWaterfall.tsx:84) and PointTooltip both render the arrow with the **absolute** value (`▼${Math.abs(...)}` → "▼3"). Same product surface, two conventions for the same concept.
- **Root cause**: `{delta}` is printed verbatim after the glyph instead of `Math.abs(delta)`; the up case already uses "▲+" so the sign is doubly encoded only on the down case.
- **Impact**: Minor inconsistency / slight visual noise across the report's delta indicators.
- **Fix sketch**: Render `{Math.abs(delta)}` after the arrow (and keep `▲+` / `▼`), matching ScoreWaterfall and PointTooltip.

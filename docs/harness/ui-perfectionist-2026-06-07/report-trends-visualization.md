# UI Perfectionist — Report & Trends Visualization

> Total: 8
> Severity: critical 0 · high 3 · medium 4 · low 1
> Scope: 8 files (Report & Trends Visualization)

## 1. Per-dimension trend charts drop the level bands + axis labels the overall chart shows
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/components/report/DimensionTrends.tsx:71`
- **Scenario**: The per-dimension small-multiples grid on /trends and the overall trend chart sit on the same page.
- **Root cause**: `TrendChart` renders shaded `LEVEL_BANDS` + numeric y-labels at `BAND_EDGES` (`TrendChart.tsx:124-139`), but `DimLine` only draws bare dashed lines at hardcoded `[25,45,65,85]` with no bands and no numeric scale — same 0..100 domain rendered in two different reading frames.
- **Impact**: Users compare a dimension's trajectory against a frameless chart next to a fully-scaled one; the maturity bands that give the numbers meaning are missing on the small multiples.
- **Fix sketch**: Route `DimLine` through `chartScale.ts` (`LEVEL_BANDS`/`BAND_EDGES`) and render at least 0/50/100 ticks so both chart families share one scale.

## 2. Overall trend line is always accent-blue while dimension lines are score-colored
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/components/report/TrendChart.tsx:145`
- **Scenario**: The headline maturity trajectory on /trends vs. the per-dimension lines and report sparklines.
- **Root cause**: `TrendChart` strokes a fixed `stroke="#3b9eff"` while its dots use `scoreHex`; `DimLine` (`DimensionTrends.tsx:75`) and `Sparkline` (`TrendChart.tsx:50`) stroke with `scoreHex(last)`.
- **Impact**: The single most important line — overall maturity — opts out of the red→green ramp, so an L1-red repo still shows a confident blue trajectory, contradicting the score color language used everywhere else.
- **Fix sketch**: Single-source the line-color rule (score-based via `lib/ui.ts`) across `TrendChart`, `DimLine`, and `Sparkline`.

## 3. Empty-range and error states in DimensionTrends bypass the canonical EmptyState
- **Severity**: high
- **Category**: component-architecture
- **File**: `src/components/report/DimensionTrends.tsx:230`
- **Scenario**: When a dimension has no history in range, or the history fetch errors, on /trends.
- **Root cause**: Bespoke centered cards at `:230-242` and `:296-305` duplicate notice styling instead of routing through `EmptyState`, while the page's own `Notice` (`trends/page.tsx:24-38`) is a third treatment.
- **Impact**: Three different "nothing here" visual treatments on one surface — inconsistent and drift-prone.
- **Fix sketch**: Render both the empty and error states via `EmptyState` with "Show all" / "Retry" as `actions[]`.

## 4. /trends has no top-level loading state — blank await before first paint
- **Severity**: medium
- **Category**: polish
- **File**: `src/app/trends/page.tsx:90`
- **Scenario**: First navigation to /trends before history resolves.
- **Root cause**: The server component `await`s history with no Suspense / `loading.tsx`, unlike `/report` which wraps in `ReportSkeleton` (`report/page.tsx:15`). The only skeleton lives buried in `DimensionTrends.tsx:308-315`.
- **Impact**: A blank screen until data arrives; the page feels slower and less polished than /report.
- **Fix sketch**: Add `src/app/trends/loading.tsx` with a header + chart silhouette skeleton.

## 5. Every per-dimension chart shares one non-descriptive aria-label
- **Severity**: medium
- **Category**: design-system
- **File**: `src/components/report/DimensionTrends.tsx:66`
- **Scenario**: Screen-reader users navigating the nine small-multiple charts.
- **Root cause**: A static `aria-label="Dimension trend"` is applied to all nine charts; the radar by contrast provides a full sr-only data table (`Charts.tsx:175-196`).
- **Impact**: Assistive tech announces nine identical, meaningless labels — the dimension identity and current value are lost.
- **Fix sketch**: Pass `name`/`current` into `DimLine` for a per-chart label, or emit an sr-only series table per the radar precedent.

## 6. Sparkline's lone reference line at 50 doesn't match the band edges used everywhere else
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/components/report/TrendChart.tsx:49`
- **Scenario**: The inline report sparklines.
- **Root cause**: Sparkline dashes a midline at `y(50)`, but the canonical edges are `0/25/45/65/85/100` (`chartScale.ts:16`) and `DimLine` uses `25/45/65/85`. 50 is not a rubric boundary.
- **Impact**: A reference line that implies a threshold where none exists, subtly misreading the score.
- **Fix sketch**: Drop the line, or snap it to a real `BAND_EDGES` value (e.g. 65).

## 7. ScoreWaterfall stacked track encodes dimensions by color only; tooltips are hover-dependent
- **Severity**: medium
- **Category**: polish
- **File**: `src/components/report/ReportView.tsx:505`
- **Scenario**: The score waterfall / contribution bar in the report.
- **Root cause**: Segments carry only `scoreHex` fills + a native `title` (`:517-518`); thin contributors render as unhoverable slivers with no touch / low-vision affordance.
- **Impact**: On touch devices and for low-vision users, small contributions are unreadable and uninspectable.
- **Fix sketch**: Link bar segments to the labeled list with a shared hover/active state and enforce a minimum segment width.

## 8. RadarChart is a fixed 340px square with no responsive scaling
- **Severity**: low
- **Category**: responsiveness
- **File**: `src/components/report/Charts.tsx:64`
- **Scenario**: The dimension radar on narrow phones (~320–360px).
- **Root cause**: `<svg width={size=340}>` has no `width="100%"` / `max-w`, unlike `PostureQuadrant` (`Charts.tsx:298,302`) and the `w-full` trend charts.
- **Impact**: On small screens the radar can overflow its container and clip the `1.2×`-radius axis labels (`Charts.tsx:144`).
- **Fix sketch**: Set `width="100%"` with a `max-w-[340px]` wrapper and keep the fixed `viewBox` for the internal geometry.

> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

# Score Charts & Visuals — combined bug+ui scan

## 1. ScoreRing renders "NaN" numeral and announces "Score NaN of 100" — only the geometry is NaN-guarded
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: chart-geometry / a11y
- **File**: src/components/report/ScoreRing.tsx:41,57
- **Scenario**: A drifted/bad score reaches ScoreRing as `NaN` (or `undefined` coerced). The remediation added `safeScore` (line 24) so `strokeDashoffset` and the arc are correct, but the displayed numeral (`{score}` at line 57) and the SR `<desc>` (`Score ${score} of 100`, line 41) still use the RAW `score`. The arc reads as 0%, while the big center label literally prints `NaN` and a screen reader announces "Score NaN of 100."
- **Root cause**: The NaN-guard was applied to the geometry path but not to the two human-facing surfaces (visible numeral + `<desc>`); the guard is half-applied.
- **Impact**: A broken-looking "NaN" headline number and a nonsensical SR announcement, where the rest of the ring already degrades gracefully to 0.
- **Fix sketch**: Compute a `safeScore` once and use it for the numeral, the `<desc>` text, and the offset (color already clamps via `scoreHex`→`levelForScore`→`clamp`). e.g. `<text…>{safeScore}</text>` and `Score ${safeScore} of 100`.

## 2. ScoreWaterfall segment `minWidth` can overflow the 0..100 track and clip the visual sum
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: responsive-svg / chart-scale
- **File**: src/components/report/ScoreWaterfall.tsx:46-63
- **Scenario**: With 9 weighted dimensions, several tiny contributors (e.g. a 2-point dimension on a narrow mobile track) are each forced to `minWidth: "0.375rem"` (6px) while keeping `shrink-0`. The sum of the colored segments' rendered widths (percent widths bumped up by per-segment minWidths) can exceed the container width; the `flex-1` headroom tail collapses to 0 first, then the rightmost segments are clipped by `overflow-hidden`. The bar no longer visually reaches/represents `overallScore`, and the "headroom to 100" tail disappears even when there is real headroom.
- **Root cause**: Mixing percentage widths with a fixed pixel `minWidth` on `shrink-0` flex children means total rendered width is not bounded to 100% of the track.
- **Impact**: The glass-box "parts sum to your headline" promise breaks visually on narrow viewports / many-small-contributor repos — the chart under-represents the score and hides headroom.
- **Fix sketch**: Drop `minWidth` (accept that sub-1% segments are near-invisible, which the itemized list below already covers), OR clamp the cumulative width, OR render the stack as proportional `flex-grow` values so children share the track without overflow.

## 3. DimLine has no empty / all-absent state — renders bands with no data and no message
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: empty-state
- **File**: src/components/report/DimLine.tsx:54-116
- **Scenario**: Called with `values = []` or an array that is entirely `null` (a dimension that was absent in every retained scan). `present` is empty, `drawnCount` is 0, so the path is gated off (`drawnCount > 1`) and no dots render. The component still draws the full band/gridline frame and the "65" label, producing an empty chart frame with zero signal and no explanation — unlike RadarChart, which guards `dimensions.length === 0` with a "No dimension data" state.
- **Root cause**: The single-/zero-point edge case is handled for the LINE (correctly suppressed) but there is no empty-state branch the way the radar has one.
- **Impact**: An empty, confusing chart frame that reads as a rendering glitch rather than "no history for this dimension."
- **Fix sketch**: When `present.length === 0`, return a small centered "No trend data" placeholder (mirror RadarChart's `role="img"` + `aria-label` empty state) instead of the bare band frame.

## 4. RadarChart floors every vertex at 4% radius — a true-zero dimension looks non-zero
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: chart-scale
- **File**: src/components/report/RadarChart.tsx:49
- **Scenario**: `point(i, Math.max(0.04, d.score / 100))` plots any dimension with score 0 (or 1–3) at 4% of the radius rather than at the center. A repo with a genuinely zero dimension shows a small but clearly non-zero spoke on the polygon, slightly inflating the visual area / shape.
- **Root cause**: A deliberate visibility floor (so a dead vertex doesn't collapse to a degenerate point) doubles as a small data distortion; the numeric label and SR table still show the true `d.score`, so only the polygon geometry lies.
- **Impact**: Minor visual over-statement of the weakest dimensions — the exact dimensions users scan the radar to find. Low because the adjacent numeral and SR table carry the true value.
- **Fix sketch**: Lower the floor toward 0 (e.g. `Math.max(0.01, …)` or 0 with a min-radius dot drawn separately), or keep the floor but document it; the dot already marks the vertex location regardless of polygon radius.

## 5. ScoreWaterfall lift arrow can disagree with its own sign when a contribution rounds across the ±0.05 band
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: off-by-one / display-precision
- **File**: src/components/report/ScoreWaterfall.tsx:71,86
- **Scenario**: `lift` is classified from the raw `c.signed` against a ±0.05 band, but the magnitude shown is `fmtPts(Math.abs(c.signed))` which rounds to one decimal. A `signed` of `0.051` is classified `up` and rendered "▲+0.1"; a `signed` of `0.049` is classified `flat` and rendered "·". Values like `0.04`→"·" are consistent, but a value such as `0.051` rounding to `0.1` and `-0.051`→"▼0.1" sit right at the boundary where the displayed magnitude (0.1) is much larger than the threshold that gated it (0.05), so a contribution that is effectively on the mean can still wear an arrow with a visible "0.1".
- **Root cause**: Classification threshold (0.05 on raw value) and the displayed rounding granularity (0.1) are not aligned, so the arrow shown and the magnitude shown can imply different precision.
- **Impact**: Cosmetic inconsistency in the per-dimension lift column; never wrong by more than rounding, no data impact.
- **Fix sketch**: Classify on the same rounded value used for display (round `c.signed` to one decimal first, then compare against `0.05`), so the arrow and the shown magnitude always agree.

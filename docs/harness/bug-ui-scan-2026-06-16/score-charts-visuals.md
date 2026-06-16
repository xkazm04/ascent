# Score Charts & Visuals — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 16

## 1. PostureQuadrant has no screen-reader fallback and degenerates when adoption == rigor == threshold
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: SVG a11y / screen-reader equivalence
- **File**: src/components/report/PostureQuadrant.tsx:78-159
- **Scenario**: A screen-reader user reaches the posture chart. Unlike RadarChart (sr-only `<table>`) and TrendChart (`aria-describedby` table), the quadrant exposes only a single `aria-label` string and uses `role="img"` with no `<title>`/`<desc>`. The four quadrant regions, the threshold crosshair, the active-quadrant emphasis, and the *trail to the previous scan* (history movement — a primary insight of this chart) are all invisible to assistive tech: the label states current adoption/rigor but never names the prior position or that the repo moved. Visually, the active quadrant is distinguished only by `opacity` (0.14 vs 0.05) plus a bold label — for a colorblind user two adjacent tints (e.g. `ungoverned` orange `#f97316` vs `early` red `#ef4444`) at ~0.05–0.14 alpha over the dark canvas are near-indistinguishable; the only robust cue is the bold-weight label, which is subtle.
- **Root cause**: The component predates the `<title>`/`<desc>` + sr-only-table convention the sibling charts adopted (RadarChart.tsx:76-160, TrendChart.tsx:249-274); it was given a one-line `aria-label` instead of the structured equivalent, and the trail/prev state was never surfaced textually.
- **Impact**: The 2D posture position and its trend (the whole reason the quadrant exists over two flat bars — see the component's own doc comment) are unavailable non-visually, and weak for low-vision/colorblind users. This is the chart library's headline differentiator; the a11y gap is most visible exactly here.
- **Fix sketch**: Add `<title>`/`<desc>` and switch to the sibling pattern: `aria-labelledby`/`aria-describedby` pointing at a `<desc>` (or sr-only block) that names the posture, both axis values, and — when `hasTrail` — the previous adoption/rigor and direction of movement. Give the active quadrant a non-opacity cue (e.g. a 1px stroke ring or the bold border the active region lacks) so it survives CVD.

## 2. ScoreWaterfall segments can overflow the 100% track and starve the headroom tail
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: chart layout / flex sizing
- **File**: src/components/report/ScoreWaterfall.tsx:50-62
- **Scenario**: Each contribution renders as a flex child with `width: ${c.points}%` **and** `minWidth: 0.375rem` for any `c.points > 0`. With 9 dimensions, several near-zero contributions (e.g. a 2-pt dimension at low weight) each get clamped up to a 6px floor. The sum of clamped widths can exceed the container width, so flex shrinks every segment proportionally (default `flex-shrink:1` is not disabled), distorting the visual proportions, and the trailing headroom `<div className="flex-1">` (line 62) collapses to zero — the "faint tail = headroom to 100" affordance silently disappears precisely on the lower-scoring repos that have the most headroom to show.
- **Root cause**: `minWidth` floors are additive but the track is a fixed-width flex row with no overflow budget; `shrink-0` is set on the segments but `flex-1` headroom still loses the fight when floored minWidths already fill the row. Percentage widths + rem minWidths can't be reconciled to sum ≤ 100% of the container.
- **Impact**: Misleading proportions and a vanished headroom indicator on exactly the reports where headroom is the story. Not a crash, but the "glass-box, parts sum to the headline" promise is visually violated.
- **Fix sketch**: Either drop the `minWidth` floor (sub-1% segments legitimately render thin) or render the floored micro-segments in an aggregated "other" sliver; alternatively give the headroom div a guaranteed share via `min-width`/explicit width derived from `100 - total` rather than `flex-1`.

## 3. chartScale.xScale clamps neither index nor count; a single-point line path silently never draws
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: SVG path generation / edge data
- **File**: src/components/report/chartScale.ts:38-40, src/components/report/DimLine.tsx:111
- **Scenario**: `xScale` centers a single point (`count < 2 → left + width/2`) — good — but DimLine/Sparkline/TrendChart all gate the `<path>` on `length > 1` / `drawnCount > 1`, so a history with exactly **one present point** renders a lone dot with no line and, in DimLine, the hover layer still maps to it. More subtly, when `count` is large but all-but-one values are `null`, `present` has length 1, `drawnCount === 1`, and the chart shows a single dot mid-track with the maturity bands behind it but no trend — readable but visually identical to "no data yet," with no caption distinguishing the two. There's no `aria` text noting "single scan."
- **Root cause**: `xScale` handles the geometry of the degenerate case but the consuming charts have no single-point presentation state (label/caption); the `> 1` guards correctly avoid a zero-length path but leave a bare, ambiguous dot.
- **Impact**: A one-scan dimension trend reads as broken/empty rather than "first data point." Low-frequency but confusing on first scan of any repo.
- **Fix sketch**: When `drawnCount === 1`, render a small "first scan" caption or a labeled dot, and ensure the `aria-label` reflects the single-point case. No math change needed in `xScale`.

## 4. RadarChart hover radius and label/score color use hue as the sole differentiator; no keyboard reachability
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: hover/focus polish / colorblind encoding / consistency
- **File**: src/components/report/RadarChart.tsx:48-63, 97-104
- **Scenario**: The radar's vertices and the hover highlight ring are encoded purely by `scoreHex(score)` (line 103) with no glyph/level cue on the SVG itself — unlike ScoreRing (LEVEL_GLYPH at line 60), DimensionCard, PosturePanel (scoreGlyph), and LevelBadge, all of which pair hue with the non-color glyph the codebase explicitly mandates (`ui.ts:64-77` "anywhere hue signals a level/score, render this glyph"). The radar is the most prominent chart yet is the one place the glyph rule is dropped on-canvas. Separately, hover is pointer-only: `onPointerMove`/`onPointerLeave` with a `size * 0.1` snap radius and no keyboard/focus path, so a keyboard or touch user can't surface any vertex's exact score+level tooltip (the sr-only table is the only fallback, and it lacks the level color-coding context the tooltip gives).
- **Root cause**: Hover was built as a mouse affordance mirroring the time-series charts; the on-SVG vertices were styled by color alone because the adjacent label already prints the numeric score — but the *hovered-vertex ring* and tooltip swatch still lean on hue with no redundant cue, and no focusable element was added.
- **Impact**: Colorblind users get no level cue from the radar's interactive layer; keyboard/touch users can't trigger the per-dimension tooltip at all. Inconsistent with every other surface in `src/lib/ui.ts`'s stated CVD policy.
- **Fix sketch**: Add `scoreGlyph` (aria-hidden) next to the score `<tspan>` at line 112-114 to honor the glyph rule on-canvas; make vertices focusable (`tabIndex`, `<circle>` in a focusable `<g>` or a parallel button list) so the tooltip is keyboard-reachable, or document the sr-only table as the accepted equivalent and add `:focus-within` handling.

## 5. PrSignalsPanel revert-rate threshold color is the only signal and uses a non-rubric orange
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: consistency / colorblind encoding / token usage
- **File**: src/components/report/PrSignalsPanel.tsx:51
- **Scenario**: Revert rate is flagged "bad" purely by switching its value color to a hardcoded `#f97316` when `revertRate > 10`, with no glyph, label change, or "high" annotation. Every other score metric in this panel routes through `scoreHex(...)` (the canonical level ramp), but revert rate bypasses it for a raw orange that isn't tied to `LEVEL_HEX`/`scoreHex` and carries no non-color cue — so a colorblind user sees the same numeral styling for a healthy 3% and an alarming 25%. It also diverges from the codebase's stated "hue is never the sole signal" policy (`ui.ts:45-54`).
- **Root cause**: A one-off inline threshold color was added for the single inverted-polarity metric (lower is better) instead of a shared helper that pairs color with a glyph/word.
- **Impact**: The one metric where a high value is a red flag is the one with no accessible cue; minor visual inconsistency with the rest of the panel. Low blast radius (single stat) but it's the metric most worth surfacing.
- **Fix sketch**: When `revertRate > 10`, also render a warning glyph or "high" tag (aria-visible), and source the color from a shared token rather than a literal hex; consider a small inverted-scale helper so "lower is better" metrics get the same redundant encoding as the rest.

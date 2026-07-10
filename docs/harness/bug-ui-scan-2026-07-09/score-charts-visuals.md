# Score Charts & Visuals — bug-hunter + ui-perfectionist scan

> Context: Score Charts & Visuals (group: Reporting & Visualization)
> Files scanned: 14
> Total: 7 findings (Critical: 0, High: 1, Medium: 3, Low: 3)

Overall this layer is unusually well-instrumented for accessibility: every SVG carries `role="img"` + `<title>`/`<desc>` or `aria-label`, the radar exposes a full `sr-only` data table, DimLine exposes focusable deep links, and the scales in `chartScale.ts` (`vScale`/`clamp01to100`/`linScale`) all NaN-guard and clamp, so divide-by-zero / `d="M NaN…"` corruption is genuinely prevented. The findings below are the residual gaps.

## 1. Stale hover index crashes DimLine when the range toggle shrinks the series
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: state-corruption
- **File**: src/components/report/DimLine.tsx:71
- **Scenario**: User hovers/taps a DimLine point (say `active=20` of 40 present points), then — pointer still resting on the chart, or via keyboard/touch where `onPointerLeave` never fires — activates the "Last 5 days" `RangeToggle` in `DimensionTrends.tsx:140`. The same DimLine instance (stable `key={r.id}`) re-renders with a 3-point `series`.
- **Root cause**: `useChartHover`'s `active` state (chartHover.tsx:49) is never reset when its `xs` array shrinks; it's only validated at set-time. Line 71 then does `present[a]!.v - present[a-1]!.v` with a non-null assertion on a now-out-of-bounds index. (`act` one line above uses safe optional indexing — the guard is inconsistent, and the sibling `RadarChart.tsx:70-76` explicitly defends this exact pattern.)
- **Impact**: `undefined!.v` → TypeError thrown mid-render → the whole Dimension Trends section white-screens / hits the error boundary. Easy to hit on touch (tooltip persists after tap by design).
- **Fix sketch**: Reset `active` when `xs.length` changes (effect keyed on `xs.length`, or clamp), and drop the assertion: `const prev = a!=null && a>0 ? present[a-1] : undefined; const actDelta = act && prev ? act.v - prev.v : null;`.

## 2. ScoreRing's arc transition ignores prefers-reduced-motion
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: reduced-motion
- **File**: src/components/report/ScoreRing.tsx:59
- **Scenario**: In `RoadmapSandbox.tsx:99` the ScoreRing's `score` is driven live by the projection sliders. A `prefers-reduced-motion` user drags a slider and the ring sweeps its arc over 0.8s on every change.
- **Root cause**: `style={{ transition: "stroke-dashoffset 0.8s ease" }}` is hardcoded unconditionally. Every sibling chart (PostureQuadrant, DimensionCard, ScoreWaterfall) gates transitions on `usePrefersReducedMotion()` from `chartMotion.ts`; ScoreRing doesn't even import it. The PostureQuadrant comment ("matches ScoreRing's 0.8s ease and is disabled under prefers-reduced-motion") reveals ScoreRing was the un-gated exception.
- **Impact**: WCAG 2.3.3 (Animation from Interactions) violation; motion-sensitive users get repeated animated sweeps.
- **Fix sketch**: `const reduced = usePrefersReducedMotion();` then `transition: reduced ? undefined : "stroke-dashoffset 0.8s ease"`.

## 3. Chart strokes/fills hardcode hexes that duplicate design tokens
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: design-token-adherence
- **File**: src/components/report/RadarChart.tsx:131
- **Scenario**: `globals.css` defines the brand system as tokens precisely so the "single confident azure accent" can be retuned / white-labelled — `--color-accent #3b9eff`, `--color-accent-soft #7bbcff`, `--color-divider #1e293b`, `--color-warn #f97316`. The charts bypass all of them with raw literals: radar polygon `stroke="#3b9eff"` + `rgba(59,158,255,0.22)` (131), dots `#7bbcff` (133), grid/axes `#1e293b` (122,128); ScoreRing track `#1e293b` (47); DimLine gridlines `#1e293b` (123); PostureQuadrant border `#1e293b` (106); ProvenanceTrack track `#1e293b` + guardband `#3b9eff` (DimensionCard.tsx:133,135).
- **Root cause**: SVG presentation attributes were treated as outside the token system, even though the module already uses Tailwind `fill-slate-*` utilities for text.
- **Impact**: A brand-accent change or white-label re-skin updates buttons/borders but leaves the charts on the old azure — the exact drift the `--color-divider` token comment says it exists to prevent.
- **Fix sketch**: Use `className="stroke-divider"` / `stroke-accent` / `fill-accent` (or `stroke="var(--color-accent)"`) so charts follow the token set.

## 4. Radar per-vertex score numerals fail AA contrast in the default state
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: contrast
- **File**: src/components/report/RadarChart.tsx:160
- **Scenario**: With nothing selected (the normal case) all nine axis score numbers render `fill-slate-500` (#64748b) on the panel surface — roughly 3.9:1, below the WCAG AA 4.5:1 for 11px normal text. They only jump to `fill-slate-300` when that vertex is the active highlight.
- **Root cause**: The careful numeral-contrast audit documented in `lib/ui.ts` (LEVEL_HEX) covered the score colors but not these slate axis labels; slate-500 was chosen for a "de-emphasized" look at a size where it's a primary readout.
- **Impact**: The nine per-dimension scores — a core readout of the radar — are hard to read for low-vision users. (Mitigated by the `sr-only` table, but that doesn't help sighted low-vision users.)
- **Fix sketch**: Lift the default score tspan to `fill-slate-300`/`slate-400`; keep slate-500 for the dimension label only if desired.

## 5. PR revert-rate signals "elevated" by color alone, off-token
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: color-as-sole-channel
- **File**: src/components/report/PrSignalsPanel.tsx:52
- **Scenario**: `color={stats.revertRate > 10 ? "#f97316" : "#fff"}` — a high revert rate is conveyed only by orange-vs-white text, with no glyph, label, or shape cue, and (unlike every other metric here) it bypasses `scoreHex`. The hex `#f97316` is exactly `--color-warn`, and `#fff` a raw literal.
- **Root cause**: One-off inline threshold styling instead of routing through the token/scoreGlyph system the rest of the report uses.
- **Impact**: CVD users may not perceive the warning; a brand re-skin won't reach it. Minor (a secondary metric).
- **Fix sketch**: Use `--color-warn` (or `text-warn`) and add a non-color cue (e.g. a "⚠"/"high" tag) when `> 10`.

## 6. Radar click-to-select is pointer-only — no keyboard path
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: keyboard-accessibility
- **File**: src/components/report/RadarChart.tsx:102
- **Scenario**: When `onSelect` is passed (DimensionExplorer), the radar becomes a picker with `cursor: pointer` and an `onClick`, but it's a `role="img"` SVG — there's no `tabindex`, focus ring, or key handler, so a keyboard user cannot select a vertex from the radar.
- **Root cause**: The vertex picker was built as a pointer enhancement over an image role.
- **Impact**: Low — the adjacent `DimBar` list in DimensionExplorer is the keyboard-accessible picker, so this is a redundant affordance, but it advertises interactivity (cursor) it can't deliver to keyboards.
- **Fix sketch**: Either drop `cursor:pointer` when there's no keyboard equivalent, or expose vertices as focusable elements; simplest is to lean on the DimBar list and mark the radar decorative for selection.

## 7. DimLine's screen-reader fallback omits values when no point is linked
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: screen-reader-parity
- **File**: src/components/report/DimLine.tsx:85
- **Scenario**: The `sr-only` list is built from `present.filter((p) => meta[p.i]?.href)` — only points that carry a report permalink. A trend whose scans have no `href` (or no `meta`) renders zero SR list items, and the svg `aria-label` states only "currently N of 100". Unlike RadarChart, which tables every value, DimLine's historical series is then invisible to assistive tech.
- **Root cause**: The SR fallback was designed as a *link* list (keyboard reach for deep links), not as a *data* equivalent, so unlinked history has no textual channel.
- **Impact**: Low — SR users lose the per-scan trajectory for repos without pinned-report links; the current value is still announced.
- **Fix sketch**: Always emit an `sr-only` list/table of `present` points (score + short date), wrapping the value in an `<a>` only when `meta[p.i]?.href` exists.

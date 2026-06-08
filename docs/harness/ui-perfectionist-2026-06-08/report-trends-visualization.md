# UI Perfectionist — Report & Trends Visualization

> Total: 9 findings (0 critical, 3 high, 5 medium, 1 low)
> Context: Report & Trends Visualization | Files audited: 8 (+3 supporting)

## 1. Score color ramp diverges between two color systems — Tailwind class palette vs. brand hex are different shades
- **Severity**: High
- **Category**: visual-consistency
- **File**: src/lib/ui.ts:31-66
- **Scenario**: The same maturity level is painted in two visibly different shades depending on surface. The headline level pill (ReportView.tsx:188, via `LEVEL_CLASSES`) renders L5 as `text-emerald-400` (#34d399) and L3 as `text-yellow-400` (#facc15). But ScoreRing, waterfall segments, AxisBar, dimension scores, and all trend lines use `scoreHex()` → `LEVEL_HEX`, where L5 is #22c55e (emerald-500, darker) and L3 is #eab308 (yellow-500, more amber). So the big "L5 — Autonomous" pill and the score ring right next to it (ReportView.tsx:184-191) are mismatched greens.
- **Root cause**: Two parallel level→color maps (`LEVEL_HEX` hex literals and `LEVEL_CLASSES` Tailwind `-400` classes) authored independently at different shade stops (-500 vs -400); nothing derives one from the other.
- **Impact**: Breaks the "color = level" model the whole report leans on. Side-by-side it reads as a rendering bug, undermining trust in a product whose value prop is a precise score.
- **Fix sketch**: Pick one canonical ramp. Either bump `LEVEL_HEX` to the `-400` values, or derive the pill text color from `LEVEL_HEX` via inline `style={{ color }}` and drop the `text-*-400` half of `LEVEL_CLASSES` (keep border/bg tints). Document LEVEL_HEX as the one true ramp.

## 2. Trend chart band shading is conveyed by color alone — no in-chart band labels or text alternative
- **Severity**: High
- **Category**: data-viz
- **File**: src/components/report/TrendChart.tsx:124-140
- **Scenario**: The overall TrendChart shades five maturity bands behind the line (`LEVEL_BANDS`, alpha 0.05–0.10). A sighted user can't tell which faint stripe is "L4 Integrated" vs "L3 Augmented" — bands carry no labels, and the only y text is bare edge numbers (0/25/45/65/85/100) at 9px (TrendChart.tsx:136). The chart's `aria-label` is just `"Overall score over time"` (line 119), so an SR user gets neither band structure nor data points — unlike RadarChart, which ships an `sr-only` data table (Charts.tsx:174-195).
- **Root cause**: Level-band semantics (the point of shading) live only in near-invisible fill opacity; no L1–L5 labels at band centers, and no `sr-only` series table like the radar's.
- **Impact**: The bands — the feature that lets you "see when a repo crosses a level boundary" (file header) — are functionally invisible to most users and entirely absent for SR users. The highest-value chart on the trends page degrades to an unlabeled squiggle.
- **Fix sketch**: Draw faint right-aligned band labels (`L5`, `L4`…) at each band's vertical midpoint (there's a 44px right inset already), and add an `sr-only` table mirroring the radar: scan date, score, level per point. Reference it via `aria-describedby`.

## 3. Trends page reaches into `LEVEL_CLASSES` directly, duplicating the report's level pill — no shared `LevelBadge`
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/trends/page.tsx:108-123
- **Scenario**: The trends page hand-builds a level badge (`rounded-full border ${lc.border} ${lc.bg} px-3 py-1 text-sm font-semibold ${lc.text}`) from `LEVEL_CLASSES`. ReportView.tsx:188 builds a near-identical pill plus a `LEVEL_GLYPH` prefix. The trends version omits the glyph, so the CVD-redundant cue is present on the report but missing on trends.
- **Root cause**: No extracted `<LevelBadge>` component; each page re-derives the recipe, so they drift and any palette/spacing tweak is a multi-place edit.
- **Impact**: Visual inconsistency between two pages users toggle between via the "Full report ↔ Dimension-level trends" links, plus a real a11y regression (no non-color cue on the trends badge).
- **Fix sketch**: Extract `LevelBadge({ id, name, size? })` that always renders `LEVEL_GLYPH[id] + id + name` with `LEVEL_CLASSES`, used in both `trends/page.tsx` and `ReportView`.

## 4. Report and trends pages duplicate the `Shell`/`Notice` layout scaffold instead of sharing one
- **Severity**: Medium
- **Category**: component-architecture
- **File**: src/app/trends/page.tsx:14-38
- **Scenario**: `trends/page.tsx` defines a local `Shell` (`SiteHeader` + `main.mx-auto.w-full.max-w-5xl.px-5.py-10` + `SiteFooter`) and a local `Notice` over `EmptyState`. `report/page.tsx:11-19` repeats the identical `main` shell inline. The `max-w-5xl px-5 py-10` magic numbers are copy-pasted across both routes.
- **Root cause**: No shared page-shell primitive; each route re-types the container, so they can silently diverge.
- **Impact**: Two pages meant to feel like one product can drift in width/padding; every future layout tweak is a multi-file edit.
- **Fix sketch**: Extract a `ReportShell({ children })` exporting the `SiteHeader / main.max-w-5xl… / SiteFooter` frame; use it in both routes. Keep `Notice` as a thin `EmptyState` preset.

## 5. DimensionTrends small-multiple charts drop the y-axis band-edge labels the main chart keeps
- **Severity**: Medium
- **Category**: data-viz
- **File**: src/components/report/DimensionTrends.tsx:85-106
- **Scenario**: The per-dimension `DimLine` charts shade the same maturity bands and draw dashed band-edge gridlines (DimensionTrends.tsx:92-94) but render **no numeric axis labels** — there's no `0/25/45/65/85/100` scale like `TrendChart` (TrendChart.tsx:133-139). So a 9-up grid of dimension sparklines shows lines floating against unlabeled stripes; you can't read an approximate value without hovering each one.
- **Root cause**: `DimLine` was written as a compact small-multiple and skipped the axis-label loop. The card's current value is shown top-right (DimensionTrends.tsx:288-300), but the *history* points have no readable scale.
- **Impact**: The "By dimension" grid — the core of the trends page — reads as decorative squiggles rather than legible quantitative charts; comparing two dimensions' trajectories by eye is unreliable.
- **Fix sketch**: Add at least one mid-scale tick label (e.g. `65` at the L4 edge) inside each `DimLine`, or a shared faint left-gutter scale, or annotate first/last point values inline (like `TrendChart`'s last-value label at 166-182).

## 6. Contributor "AI share" bar has no text alternative and reuses the brand accent for an unrelated metric
- **Severity**: Medium
- **Category**: accessibility
- **File**: src/components/report/ReportView.tsx:282-290
- **Scenario**: Each contributor row renders a bar whose fill width is `${pctAI}%` in `bg-accent` (the azure brand color). The bar `<div>` has no `role`/`aria-label`/`progressbar` semantics — an SR hears only the adjacent `{aiCommits}/{commits} AI · {pctAI}%` text (so not fully lost, but the bar is silent). Separately, azure `bg-accent` is the app's *primary action/brand* color, here meaning "fraction of AI commits" — a semantic the user must infer. The same raw-bar pattern recurs in `AxisBar` (455-457) and the rec-tracker progress (1033-1035).
- **Root cause**: Bars built ad hoc (raw div + inline width) rather than through a shared `<Meter>` primitive that would attach `role="progressbar"`/`aria-valuenow` + a label.
- **Impact**: Minor for SR users (text fallback present), but the repeated bespoke bars are an extraction opportunity and accent-as-data muddies the "azure = action" convention from globals.css.
- **Fix sketch**: Extract `<Meter value label hint color?/>` with `role="progressbar"` + `aria-valuenow/min/max` + `aria-label`; reuse for the contributor bar, `AxisBar`, and rec-progress. Consider a neutral/slate fill for the contributor bar to reserve accent for interactive affordances.

## 7. Tiny SVG chart text sits below legible/contrast minimums (7–11px on dark fills)
- **Severity**: Medium
- **Category**: data-viz
- **File**: src/components/report/ReportView.tsx:738-743
- **Scenario**: The ProvenanceTrack legend draws `fontSize={7}` mono text ("signal 62", "llm 70 · blended 65") in `fill-slate-500` (#64748b) over the dark card — 7px is below any practical legibility floor and slate-500 on slate-900/40 is low contrast. TrendChart axis labels are 9px slate-600 (TrendChart.tsx:136), DimLine has none, radar axis scores are 11px slate-500 (Charts.tsx:146-151). These are SVG `fontSize` in viewBox units, so they shrink further on narrow/zoomed-out renders.
- **Root cause**: Chart micro-text sized to "fit" rather than to a legibility budget; slate-500/600 chosen for subtlety at the cost of contrast (smaller text needs *more* contrast, not less).
- **Impact**: The glass-box provenance viz — built specifically to defeat the "black box" objection — has a legend most users can't read; the real values live in per-element `<title>` tooltips only discoverable on precise hover.
- **Fix sketch**: Raise the smallest chart text to ≥10px (scale the value-track viewBox up if needed) and bump fills to ≥slate-400 for standalone labels. For ProvenanceTrack, drop the redundant 7px corner legend and rely on the always-visible blended marker + the existing `aria-label` (line 713).

## 8. Trends header mixes a non-interactive level pill with interactive link-buttons at the same size/shape bracket
- **Severity**: Low
- **Category**: polish
- **File**: src/app/trends/page.tsx:120-138
- **Scenario**: Three same-height rounded chips sit in a row: a non-clickable level badge (`rounded-full px-3 py-1`) and two clickable links (`rounded-lg border-slate-700 px-3 py-1.5`). Only corner radius and a hover transition (border→accent) distinguish interactive from static; users may try to click the badge. Both links use a trailing `→`, reinforcing the ambiguity.
- **Root cause**: Static and interactive chips share a size/weight bracket; no resting-state affordance signals which are clickable.
- **Impact**: Minor confusion / mis-clicks on the trends header; the row reads as "three buttons" when one is a status badge.
- **Fix sketch**: Differentiate the static badge (keep `rounded-full`, no arrow) and/or give action links a subtle resting background so interactivity is legible without hover. Apply the `focus-ring` token (globals.css:86) to both links for keyboard users.

## 9. Loading/empty/error states are uneven across surfaces — DimensionTrends has full coverage; the report's history fetch fails silently
- **Severity**: Medium
- **Category**: states
- **File**: src/components/report/ReportView.tsx:28-46
- **Scenario**: `DimensionTrends` models `idle/loading/error/done` with a shimmer grid, a `Retry` section-empty, and a range-empty (DimensionTrends.tsx:251-335) — exemplary. But on the **report page**, the inline history+recommendations fetch (ReportView.tsx:31-42) swallows all failures in an empty `catch` and sets nothing: if `/api/history` errors (not just "no DB"), the "Maturity over time" panel and dimension sparklines simply never appear — no skeleton, no "couldn't load" note, no retry. "No history yet" is indistinguishable from "history failed."
- **Root cause**: The report's secondary fetch is fire-and-forget with a silent catch, while the trends page invested in a full state machine — opposite robustness against the same endpoint.
- **Impact**: On a flaky network or transient 500, report users silently lose the trend + per-dimension sparklines with zero feedback, making the report look incomplete rather than degraded. Inconsistent polish between sibling surfaces.
- **Fix sketch**: Give the report's history fetch a lightweight `loading | error | empty | done` state: inline skeleton in the trend panel while pending, and a compact "Trend unavailable — retry" `EmptyState variant="section"` (as DimensionTrends does) on error, distinct from the legit "Baseline established" single-scan copy at ReportView.tsx:216-218.

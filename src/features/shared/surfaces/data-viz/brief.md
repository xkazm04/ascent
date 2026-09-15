# Data visualization - showcase brief

subject: data-viz
subcategory: data-display
digest: sha256:b6657691892c6b9b
verifiedOn: 2026-09-06
goldenPath: knowledge/software-engineering/ui-surfaces/data-display/data-viz/data-viz.md

## Scene concept

A fleet instrument board: one fictional fleet's scan metrics drawn on the surfaces a product actually
draws them on — a headline tile with its daily strip, four small multiples of the same score, a
sparkline column inside a repository table, a multi-series chart with a legend, a lazily-engined
dashboard row, and one chart slot that walks every empty and degraded state. It hosts every technique
naturally because each is a rule about one of those surfaces (what a number means, what a scale
claims, when the engine arrives, what a glyph may say, what colour carries, what an empty frame
asserts), and a viewer can read it as a dashboard for a minute before the rail reveals the rules. The
viewer switches metric variants, scale policies, colour semantics and slot states, poisons a series,
and re-sorts the fleet, watching what moves and what stays.

Fixtures (`fixtures.ts`): mulberry32-seeded by `volume`; `WINDOW = 8` repositories are mounted at
every volume with 14 complete daily buckets + 1 partial (today so far); a `null` bucket is "not
measured"; the fleet totals the registry derives from scale with the volume. `reduced` and `volume`
are props; nothing reads a media query. framer-motion is used in `MiniLine.tsx` only (path draw-on).

## Techniques

### metric-identity
- use_when matched: "two surfaces disagree under one metric name"
- mechanism to show: `metrics.ts` registry (id, unit, precision, polarity, window, source, ONE
  `derive()` returning `null` for an empty denominator); tile, strip, cell and tooltip all read
  `readMetric()`/`fmtMetric()`; 7d and 14d are registered variants (14d has no previous window -> delta
  is a dash); `favourable()` colours a delta by polarity through `deltaHex`
- region: `MetricRegion.tsx`
- Ascent evidence: `src/components/ui/format.ts` - `DIRECTION_TONE`/`toneFor`/`fmtDelta`, the one
  delta-tone authority (grep: `rg "export.*(deltaHex|fmtDelta|signedDelta)" src/components/ui` -> 3 hits)
- deviation: no metric registry; fleet derivations live per surface with no importable contract
  (grep: `rg -i "metricIdentity|MetricDef|polarity" src` -> 0 hits)
- applications read: `react--metric-identity.md` (registry of declared variants with ids naming
  surface+window+source; "mirror maintained by a comment is not a parity gate"; provenance dropped by
  a wire type); nothing cited as Ascent's

### scale-and-axis-design
- use_when matched: "deciding whether a chart shares its scale with siblings"
- mechanism to show: `project(series, domain, box)` demands a domain; `domainFor(policy)` with
  `shared` / `auto` (zero floor, `niceCeil`) / `sample-floor` (labelled defect); four sibling panels;
  readout of the steady series' span turns `text-danger`; partial bucket dashed + hollow, never a
  ceiling; the axis predicate printed under the panels
- region: `ScaleRegion.tsx`
- Ascent evidence: `src/components/report/chartScale.ts` - `vScale` fixed 0..100, `linScale(domainMax,…)`,
  `BAND_EDGES` ticks (grep: `rg "vScale|linScale" src/components/report` -> 9 files)
- deviation: `src/components/org/shared/GoalTrend.tsx` `lo = Math.min(...values, target)` is the
  sample-anchored floor; no chart flags a partial trailing bucket (grep: `rg "partial" src/components/report/*.tsx` -> 0 hits)
- applications read: `node--scale-and-axis-design.md` (zero as default floor, hardened for length
  marks; shared-by-default for layer/facet; `ceil(height/40)` tick density; explicit domain yields a
  truncated bar with no warning); nothing cited as Ascent's

### chart-loading-economics
- use_when matched: "one malformed series blanks the whole dashboard"
- mechanism to show: slots at final height from the first frame; a simulated engine chunk loaded once
  and shared (`setTimeout` with cleanup); one placeholder for both waits, delayed 150ms via
  `animation-fill-mode: both`, still under `reduced`; `ChartBoundary` class per slot with
  `componentDidCatch` telemetry (identity + trigger) and `resetKey` reset; "poison series B" throws in
  render and only B fails
- region: `LoadingRegion.tsx`
- Ascent evidence: `src/components/ui/Defer.tsx` - `visible` strategy, one-shot IntersectionObserver
  (240px margin), disconnected and cleaned up; `deferPolicy.ts` `QUIET_PLACEHOLDER_DELAY_MS = 150`
  (grep: `rg "IntersectionObserver" src/components/ui` -> Defer.tsx)
- deviation: `Defer.placeholder` defaults to null (the optional-fallback lesson); error boundaries are
  per tab (`src/components/org/shell/OrgTabErrorBoundary.tsx`) and per report, none per chart
  (grep: `rg "componentDidCatch" src` -> 2 files, both page/tab level)
- applications read: `react--chart-loading-economics.md` (one dynamic import door; render-prop
  because the engine inspects child identity; `height` required 3/3 vs `fallback` optional 3/11;
  `rootMargin: '200px'` one-shot; per-chart boundary with logger); nothing cited as Ascent's

### micro-visualizations
- use_when matched: "flat and volatile rows looking identical in one column"
- mechanism to show: sparkline column with the header carrying metric + window; shared
  `SCORE_DOMAIN` vs a "per-cell auto (defect)" chip; the score number beside the glyph;
  `MIN_POINTS_FOR_SHAPE = 3` -> "collecting · n of 3" and no line; gap still shaded at 20px; delta via
  `fmtDelta`; fixed row height, no entrance animation
- region: `MicroRegion.tsx`
- Ascent evidence: `src/components/report/TrendChart.Sparkline.tsx` - `vScale` on the fixed domain,
  reference line at the L4 edge (grep: `rg -il sparkline src` -> 10 files)
- deviation: the Sparkline draws a line at 2 points (`points.length > 1`); `GoalTrend.tsx` auto-scales
  per card; no shared observation floor (grep: `rg "MIN_POINTS|minPoints" src` -> 0 hits)
- applications read: none registered for this technique in the index

### encoding-vocabulary
- use_when matched: "same entity changes color after a re-sort"
- mechanism to show: `seriesColor(id)` from the id's minted number into `STACK_COLORS`;
  identity-vs-status chips (status = `scoreHex`, identity moved to the direct label); end-mark shape
  + direct label as the non-hue channels; grayscale check via `filter: grayscale(1)`;
  `PALETTE_CAPACITY` + `aliases()` for the modulo wrap; the legend's `data-color` proves stability
  across "re-sort"
- region: `EncodingRegion.tsx`
- Ascent evidence: `src/lib/ui.ts` - `LEVEL_HEX`/`scoreHex` the one score ramp, `LEVEL_CLASSES` locked
  to the same stops, `LEVEL_GLYPH` the redundant channel (grep: `rg "export.*LEVEL_HEX|scoreHex" src/lib/ui.ts` -> 2 hits)
- deviation: the categorical palette is `src/features/standing/tech-stacks/stackViz.ts` `STACK_COLORS`,
  outside `@/lib/ui`, and `stackColor(i)` binds by index (grep: `rg "STACK_COLORS" src` -> stackViz.ts + consumers)
- applications read: `react--encoding-vocabulary.md` (a CVD texture channel rotated with its mark and
  two pairs collapsed; the fix pinned `patternTransform` on the pattern definition; the audit must run
  under every transform); nothing cited as Ascent's

### empty-and-degraded-chart-states
- use_when matched: "deciding what an empty plot area actually says"
- mechanism to show: one slot, eight facts; `chrome` only around data (`data-chrome="drawn"|"none"`);
  nothing-yet / nothing-in-window (widen) / not-measured (warn, configure) / could-not-answer
  (`role="alert"`, window kept, retry); `runs()` breaks the line at null, `gaps()` shades the stretch;
  two observations -> points + number, no line; partial bucket dashed/hollow
- region: `StatesRegion.tsx`
- Ascent evidence: `src/components/report/RadarFallback.tsx` - under-3-axes radar degrades to labelled
  bars, zero renders as an empty track with an explicit line (grep: `rg "RadarFallback" src` -> 3 files)
- deviation: `src/components/report/reportSeries.ts` drops an absent dimension from the series (a
  shorter line, not a gap); no chart distinguishes window-empty / not-measured / failed
  (grep: `rg -i "not being measured|not measured" src/components` -> 0 hits)
- applications read: `react--empty-and-degraded-chart-states.md` (`number | null` return type as the
  fix; `tsc` as a census of every surface handed a fabricated zero; a ring at 0% in the alarm hue);
  nothing cited as Ascent's

## Out of the read

- Mount-on-visibility is named in the drawer via `Defer`, not re-implemented: the scene sits inside
  the frame's canvas and an IntersectionObserver demo would need the page to scroll.
- Parity gates over shared fixtures (metric-identity's forced-duplication clause) are a test-suite
  concern; the scene shows one derivation door, not two runtimes.
- Time-zone bucket boundaries are stated in the axis predicate ("UTC midnight buckets"), not made
  switchable.
- Dual axes: not drawn, by the technique's own advice.
- Texture/pattern fills (the encoding application's rotation collapse) are out of scope for a line
  chart; the redundant channel here is mark shape + direct label.

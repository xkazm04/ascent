# Code Refactor — Score Charts & Visuals
> Total: 5 | Critical: 0 High: 1 Medium: 2 Low: 2

## 1. Signed-delta vocabulary re-implemented inline instead of using the canonical `DeltaTag`
- **Severity**: High
- **Category**: duplication
- **File**: src/components/report/DimensionCard.tsx:46-51; src/components/report/chartHover.tsx:124-133; src/components/report/ScoreWaterfall.tsx:69-84 (canonical: src/components/report/deltas.tsx:43-69)
- **Scenario**: `deltas.tsx` already exports `DeltaTag` — and its own doc-comment says it is the "Compact inline delta tag (▲+N / ▼N) **for dense rows like dimension cards**." It is the canonical red/green ▲▼ language and is already consumed by `WhatChangedParts`, `RoadmapSandboxParts`, and `DimensionTrends`. Yet `DimensionCard` hand-rolls the exact same span (`${delta > 0 ? "text-emerald-400" : "text-red-400"}` + `{delta > 0 ? "▲+" : "▼"}{delta}`), `chartHover`'s `PointTooltip` hand-rolls another copy (`▲ +`/`▼ ` + emerald/red), and `ScoreWaterfall`'s lift column hand-rolls a third (`▲+`/`▼` + emerald/red/slate).
- **Root cause**: The shared component was introduced (and adopted by three siblings) but these three call sites were never migrated, so four copies of the same "gain = green ▲ / loss = red ▼" mapping now coexist.
- **Impact**: The vocabulary has already silently drifted — `DeltaTag` applies `tabular-nums` for column alignment; the `DimensionCard` copy omits it, so the dimension list's deltas don't align the way the trends table's do. Any future tweak (color, glyph, noise band) must be repeated in 4 places or they diverge further; this is exactly the drift `deltas.tsx` was created to prevent.
- **Fix sketch**: Replace `DimensionCard.tsx:46-51` with `{delta !== null && <DeltaTag delta={delta} hideZero />}`. For `PointTooltip` (chartHover) and `ScoreWaterfall`'s lift cell, factor their extra needs (the "since prior" suffix / the `·` flat state + `fmtPts` formatting) into `DeltaTag` (e.g. a `flat`/`format` prop) or a sibling export in `deltas.tsx`, then route both through it so the glyph+color map lives in one file.

## 2. Level-band rect geometry duplicated between DimLine and TrendChart
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/DimLine.tsx:97-104 (and TrendChart.tsx:152-172, the out-of-scope half)
- **Scenario**: Both charts render the maturity bands with the identical loop body — `const top = y(i === 0 ? 100 : LEVEL_BANDS[i - 1]!.min); const bottom = y(band.min); <rect ... height={Math.max(0, bottom - top)} fill={band.color} />` — followed by a `BAND_EDGES`-driven gridline map. Even the inline comment `// safe: i > 0 here, i-1 in-bounds` is copied verbatim (DimLine.tsx:98 ↔ TrendChart.tsx:153). Only the chrome differs (TrendChart adds L-id labels and an x/width inset; DimLine starts at x=0 and filters edge gridlines).
- **Root cause**: `chartScale.ts` already centralized the band *data* (`LEVEL_BANDS`, `BAND_EDGES`) and the scales (`vScale`/`xScale`), but the band→rect *geometry* (the `top`/`bottom`/`height` derivation) was left inline in each chart. This is the band/gridline duplication already flagged in the Trends wave; DimLine is its in-scope twin.
- **Impact**: The band rendering can desync between the two charts (e.g. a clamp/height fix applied to one), defeating the "every chart's bands in lockstep" intent stated in `chartScale.ts`'s header.
- **Fix sketch**: Add a pure helper to `chartScale.ts`, e.g. `levelBandRects(y: (v:number)=>number): { min:number; top:number; height:number; color:string }[]`, that returns the per-band geometry. Each chart maps over it for its own `<rect>` (with its own x/width and optional L-label/gridlines), removing the duplicated arithmetic and comment.

## 3. Chart-chrome hex literals duplicated inline across every report chart
- **Severity**: Medium
- **Category**: duplication
- **File**: src/components/report/RadarChart.tsx:89,96; ScoreRing.tsx:43; PostureQuadrant.tsx:106,109,110,147,160; DimLine.tsx:103,110; DimensionCard.tsx:130,147,152,153 (29 occurrences across 10 report files)
- **Scenario**: The same chart-chrome colors are typed as raw hex literals in every chart: `#1e293b` (grid/ring track/axis stroke), `#475569` (hover crosshair), `#020617`/`#0f172a` (point outline), `#0b1322` (dark canvas, also hardcoded in `ui.ts` `heatCell`), `#334155` (dashed crosshair). The maturity *band* colors were already centralized into `LEVEL_BANDS`, but the chrome palette was not.
- **Root cause**: Each SVG chart was authored independently and copied the neighbor's stroke/fill colors rather than referencing a shared token set.
- **Impact**: A palette retune (e.g. lighten gridlines for contrast) means a find-and-replace across 10 files with no compiler safety net; copies inevitably get missed and the charts drift apart. The `#0b1322` "dark canvas" value is even duplicated between a chart (`PostureQuadrant`) and a `ui.ts` luminance calc, where they are conceptually the same surface and must stay equal.
- **Fix sketch**: Add a `CHART_COLORS` (or `CHART_INK`) const map to `chartScale.ts` — e.g. `{ grid: "#1e293b", crosshair: "#475569", pointStroke: "#020617", canvas: "#0b1322", crosshairDash: "#334155" }` — and reference it from the charts (and from `ui.ts`'s `heatCell` for the canvas value).

## 4. Progress "track + colored fill" markup duplicated across in-scope panels (shared bar already exists elsewhere)
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/report/PosturePanel.tsx:47-49; src/components/report/DimensionCard.tsx:65-67; src/components/report/ScoreWaterfall.tsx:46
- **Scenario**: The same horizontal-meter shell — `<div className="... overflow-hidden rounded-full bg-slate-800"><div className="h-full rounded-full" style={{ width, backgroundColor }} /></div>` — is repeated in `PosturePanel`'s `AxisBar`, `DimensionCard`'s score fill, and `ScoreWaterfall`'s stacked track (which differ only in height and the animated vs static inner style). The animated inner style is already centralized via `fillBarStyle` (chartMotion.ts), but the track wrapper is not. A shared bar primitive already exists in the codebase at `src/components/org/ui.tsx:164`, and the same `overflow-hidden rounded-full bg-slate-800` shell recurs in ~14 other components app-wide.
- **Root cause**: The score-bar shell was copied per component instead of extracted, even after `fillBarStyle` consolidated the harder (motion) half.
- **Impact**: Minor but pervasive Tailwind drift (track heights/radii/colors vary slightly per copy); the dark-track color (`bg-slate-800`) is conceptually the same token as the `#1e293b` chrome in Finding 3 yet expressed differently.
- **Fix sketch**: Extract a tiny `ScoreBar({ value, color, height? })` (or promote the `org/ui.tsx` bar to a shared location) that owns the track shell and consumes `fillBarStyle`, then use it in `AxisBar` and `DimensionCard`.

## 5. Guarded ISO-date formatter re-implemented in multiple chart/util modules
- **Severity**: Low
- **Category**: duplication
- **File**: src/components/report/chartHover.tsx:73-83 (`shortDateTime`); also TrendChart.tsx:96-100 (`shortDate`) and src/lib/ui.ts:160-170 (`timeAgo`) / 178-189 (`freshness`)
- **Scenario**: The "parse an ISO string, bail safely on an invalid date" guard — `const d = new Date(iso); if (Number.isNaN(d.getTime())) return "..."` — is hand-written four times: twice as private `shortDate`/`shortDateTime` date formatters (chartHover + TrendChart) that differ only in their `toLocaleString` options, and twice more inside `ui.ts`'s `timeAgo`/`freshness`.
- **Root cause**: Each formatter independently re-derived the NaN-guard rather than sharing one parse helper.
- **Impact**: Low — small block — but the guard's behavior (what counts as invalid, what the empty fallback is) is duplicated and can drift; a single helper would also make the two near-identical chart date formatters obviously one concept.
- **Fix sketch**: Add a `safeDate(iso?: string): Date | null` (or `formatIso(iso, opts)`) helper in `ui.ts`, have `shortDate`/`shortDateTime` and the `timeAgo`/`freshness` guards route through it; the two chart formatters then collapse to a single `formatIso(iso, opts)` call with differing options.

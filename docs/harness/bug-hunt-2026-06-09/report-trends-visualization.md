# Bug Hunter Scan — Report & Trends Visualization (ascent)

> Total: 7 findings (Critical: 0 | High: 2 | Medium: 4 | Low: 1)

Files read (~20): `src/app/report/page.tsx`, `src/app/trends/page.tsx`, `src/components/report/ReportClient.tsx`, `ReportView.tsx`, `Charts.tsx`, `TrendChart.tsx`, `DimensionTrends.tsx`, `DimensionTrendsRange.tsx`, `RadarChart.tsx`, `ScoringTab.tsx`, `PostureQuadrant.tsx`, `chartScale.ts`, `chartHover.tsx`, `DimLine.tsx`, `src/app/api/history/route.ts`, `src/lib/ui.ts`, `src/lib/report/validate.ts`, `src/lib/maturity/forecast.ts`, `src/lib/maturity/model.ts`, `src/lib/db/scans-read.ts`.

Note: the chart math is already well-hardened — `vScale` is NaN/clamp-guarded (chartScale.ts:28), `xScale` centers single points, `parseRepositoryHistory` coerces junk to empty `scans`, and `levelForScore`/`clamp` make `scoreHex` safe for any number. So the classic divide-by-zero / NaN-path bugs are mostly closed. The remaining issues are subtler reconciliation and cross-fetch consistency bugs.

## 1. Radar chart divides by `n` — empty dimensions array → NaN coordinates, vanished polygon
- **Severity**: High
- **Category**: divide-by-zero / nan-coordinates
- **File**: src/components/report/RadarChart.tsx:16
- **Scenario**: If `RadarChart` receives `dimensions: []`, `angleFor(i) = -π/2 + (i*2π)/n` divides by `n = 0`; every `point()` returns `[NaN, NaN]`, the `<polygon points>` becomes `"NaN,NaN"`, vertex circles get `cx=NaN`, and the radar collapses to nothing.
- **Root cause**: Radar trusts callers to pass the full non-empty set. The streamed path is guarded (`parseScanReport` rejects empty `dimensions`, validate.ts:66) but `RadarChart` has no internal guard, so `RoadmapSandbox` (`proj.dimensions`) or any future caller passing `[]` silently renders a broken chart with no error.
- **Impact**: blank/broken chart, no fallback message — reads as a CSS glitch, not a data problem.
- **Fix sketch**: Early-return an `EmptyState`/placeholder when `dimensions.length === 0`, mirroring the validate-layer guard so the component is self-defending.

## 2. `currentStored` exact-string timestamp match can double-count the current scan
- **Severity**: High
- **Category**: state-corruption / wrong-trend-shown
- **File**: src/components/report/ReportView.tsx:62
- **Scenario**: The stored `scan.scannedAt` is `Date.toISOString()` (scans-read.ts:148); the live `report.scannedAt` is a free-form string on `ScanReport`. If they differ by one character (ms precision, `+00:00` vs `Z`, trailing zeros) for the same instant, `scans.some((s) => s.scannedAt === report.scannedAt)` is `false`, so the current point is appended again (lines 71-72 / 102-107). The trend chart and dimension sparklines then show two points for one scan — a phantom flat last segment.
- **Root cause**: Reconciliation hinges on byte-identical ISO strings from two independently-serialized sources.
- **Impact**: wrong trend shown; the "since last scan" delta and the chart's last dot disagree — the exact failure the code comment claims to prevent.
- **Fix sketch**: Compare parsed instants within a tolerance (`Math.abs(Date.parse(a) - Date.parse(b)) < 1000`), or reconcile on the immutable `scan.id`/`headSha`.

## 3. `baselineScan` uses lexicographic `<` on timestamps — wrong baseline under mixed ISO formats
- **Severity**: Medium
- **Category**: wrong-trend-shown
- **File**: src/components/report/ReportView.tsx:63
- **Scenario**: `scans.find((s) => s.scannedAt < report.scannedAt)` is a string comparison. If any timestamp uses a numeric offset (`+02:00`) or differing fractional-second width, lexical order diverges from chronological order and the wrong "previous" scan is picked (scans is newest-first, so `.find` returns the first lexically-smaller string).
- **Root cause**: String comparison substitutes for date comparison; only correct while every timestamp is the identical canonical `…Z` shape with equal precision — an unenforced invariant.
- **Impact**: wrong "since last scan" delta and wrong baseline posture/quadrant trail; ring and trail can disagree.
- **Fix sketch**: `Date.parse(s.scannedAt) < Date.parse(report.scannedAt)` (NaN-guarded), same `.find` semantics.

## 4. Overall vs per-dimension sections slice two *different* datasets — "N scans shown" mislabels dimension charts
- **Severity**: Medium
- **Category**: wrong-trend-shown / data-inconsistency
- **File**: src/components/report/DimensionTrends.tsx:71,84
- **Scenario**: The overall chart uses the lightweight server `history` (`limit: 60`, trends/page.tsx:92); the dimension small-multiples use the lazily-fetched `full` from `/api/history` (default `limit: 30`, scans-read.ts:104). When the repo has >30 scans, the two sections plot different point counts for the same range while the header still reads `{overallScans.length} scans shown` and "{overallChrono.length} scans".
- **Root cause**: Two independent fetches with different default `limit`s feed sections the UI presents as one synchronized view; the count label derives only from the overall series.
- **Impact**: dimension charts silently truncate to 30 points while the overall line shows up to 60; labels overstate what was drawn.
- **Fix sketch**: Pass an explicit matching `&limit=` on both fetches (or share one constant), or label each section from its own series length.

## 5. CSV export crashes the whole route on any non-stringable history field
- **Severity**: Medium
- **Category**: silent-failure / 500
- **File**: src/app/api/history/route.ts:32
- **Scenario**: `historyToCsv` calls `csvField(s.level)` etc. directly on raw DB rows (the CSV path does NOT pass through `parseRepositoryHistory`, unlike the JSON path). A field that is an object, a throwing getter, or otherwise not cleanly `String()`-able propagates out of the synchronous map into the route `try`, returning a generic `500 "Failed to load history."` for the entire export.
- **Root cause**: The CSV builder assumes every field is cleanly `String()`-able; no per-field coercion equivalent to the chart path.
- **Impact**: "Export CSV" silently fails with an opaque 500; no indication which scan was malformed.
- **Fix sketch**: Run the payload through `parseRepositoryHistory` before `historyToCsv` so junk rows are dropped, and/or make `csvField` swallow non-stringable values to `""`.

## 6. ETag keyed on (mode, count, newest id) — stale 304 after in-place correction
- **Severity**: Medium
- **Category**: stale-data / cache-correctness
- **File**: src/app/api/history/route.ts:100
- **Scenario**: `etag = W/"h…${payload.scans.length}-${payload.scans[0]?.id}"`. If a malformed newest row is later corrected without changing its `id` or the total count, the weak validator is unchanged; a client holding the old ETag gets `304` and never re-fetches the corrected series.
- **Root cause**: Validator assumes strictly append-only history and that the newest row's `id` captures all change; in-place corrections/same-count replacements are invisible.
- **Impact**: stale trend chart until the scan count changes.
- **Fix sketch**: Fold a content signature into the ETag (hash of newest `scannedAt`+`overallScore`, or `max(updatedAt)`).

## 7. Flat (zero-variance) trend line can render indistinguishable from a gridline
- **Severity**: Low
- **Category**: degenerate-render / UX
- **File**: src/components/report/TrendChart.tsx:172
- **Scenario**: Single-point and label-thinning cases are correctly handled. But a series of ≥2 identical scores draws a flat line at `yFor(score)`; when that value equals a band edge (e.g. all scores = 65, the L4 edge with a gridline at `yFor(65)`), the line sits on a same-position/near-same-color gridline and reads as "no chart."
- **Root cause**: Flat series land the polyline directly on a same-colored gridline/band boundary with no minimum visual separation.
- **Impact**: a real flat trend looks like a rendering failure.
- **Fix sketch**: For a flat series, add emphasis (thicker stroke / "Holding at N" annotation) or draw the line above the gridline.

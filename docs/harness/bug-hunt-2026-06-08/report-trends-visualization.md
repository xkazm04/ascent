# Bug Hunter — Report & Trends Visualization (ascent)

> Total: 7 findings (Critical: 0, High: 2, Medium: 3, Low: 2)
> Files read: 12
> Scope: /report, /trends, report components, /api/history, lib/ui

## 1. /api/history JSON cast to RepositoryHistory with no validation, then iterated — bad payload crashes trends
- **Severity**: High
- **Category**: functionality
- **File**: src/components/report/ReportView.tsx:40 (and src/components/report/DimensionTrends.tsx:189)
- **Scenario**: ReportView does `setHistory((await h.json()) as RepositoryHistory)` — raw cast, no shape check. The streamed ScanReport is rigorously validated by parseScanReport, but the history payload is trusted blindly. If the endpoint returns shape drift (`{scans: null}`, an older deploy's schema, a proxy-rewritten body, a `dims=0` payload with undefined dimensions), then `scans.some(...)` / `[...scans].reverse()` (ReportView.tsx:60–73,95–107) throws TypeError mid-render. Same blind cast in DimensionTrends.loadDimensions (189), where `withinRange(full.scans,…)` / `full.scans.some(...)` (177) then explode. The `catch` only fires for network failures, not a 200 with a bad body.
- **Root cause**: The streamed report has a hand-written runtime guard at its trust boundary; the history endpoint — a second untrusted JSON boundary feeding the SAME charts — has none.
- **Impact**: render crash (white-screen of trend section / whole /trends lazy load); silent for misshapen-200.
- **Fix sketch**: Add parseRepositoryHistory(unknown) mirroring parseScanReport: require scans to be an array, coerce each point's overallScore/dimensions. Reject → treat as no history, not a crash.

## 2. NaN / out-of-range scores reach un-clamped vScale / ScoreRing offset — invisible or escaping SVG, NaN ring
- **Severity**: High
- **Category**: functionality
- **File**: src/components/report/TrendChart.tsx:124,172,176 + src/components/report/chartScale.ts:24 + src/components/report/Charts.tsx:23
- **Scenario**: vScale = `top + span*(1 - v/100)`; xScale/yFor never clamp. History points come straight from `s.overallScore` (unvalidated, see #1). score=NaN → yFor(NaN)=NaN → path contains `,NaN` and the whole <path>/<circle cy=NaN> silently fails to render (plausible-looking but line-missing chart). score=250 or -30 plots far outside the box (no clamp) while scoreHex (via clamping levelForScore) still paints a valid color — a misleading line that escapes its bands. ScoreRing (Charts.tsx:23): `offset = c*(1 - score/100)` with score=NaN → strokeDashoffset=NaN → ring renders as a full circle (looks like a perfect 100).
- **Root cause**: scoreHex routes through clamping levelForScore, so COLOR is always safe — masking that the GEOMETRY functions (vScale, ScoreRing offset) never clamp/NaN-guard.
- **Impact**: misleading chart / invisible SVG (silent failure).
- **Fix sketch**: Clamp+sanitize at the scale boundary: in vScale `const c = Number.isFinite(v) ? Math.max(0,Math.min(100,v)) : 0`; same in ScoreRing offset.

## 3. parseScanReport validates posture.label/blurb but not posture.id; PostureQuadrant indexes QUAD_TINT[posture.id] → undefined color
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/report/validate.ts:40 + src/components/report/Charts.tsx:279,283,360–374
- **Scenario**: Validator checks posture.label/blurb but NOT posture.id ∈ Posture["id"]. PostureQuadrant does `const color = QUAD_TINT[posture.id]` (279). A report whose posture.id is missing/unexpected (schema drift, LLM-composed payload, future id) yields color=undefined, passed to stroke/fill on the trail+dot (360–374) → the "you are here" dot renders with invalid stroke (none) and vanishes; no region matches so no quadrant highlights — the chart silently loses its primary signal.
- **Root cause**: Validator guards posture's displayed text but not the id used as a record lookup key.
- **Impact**: silent failure / invisible marker.
- **Fix sketch**: Require posture.id ∈ {ai-native|ungoverned|manual|early} in parseScanReport; or default `QUAD_TINT[posture.id] ?? "#475569"`.

## 4. ReportClient peek fast-path may render another repo's cached 200, and a non-timeout abort leaves a permanent spinner
- **Severity**: Medium
- **Category**: functionality
- **File**: src/components/report/ReportClient.tsx:94–102,191–197
- **Scenario**: (a) Peek path (95) guards `.json()` but never cross-checks that the returned report's repo matches the requested repo — a stale/colliding cache entry on the `?peek=1` URL renders the wrong repo's report. (b) On AbortError, an error message is set only when timedOut is true (192); a connection reset surfacing as AbortError without the 180s timeout firing leaves the component stuck in status:"loading" forever — the checklist spins with no error and no retry.
- **Root cause**: (a) trusting a peek 200 is THIS repo's report; (b) assuming every non-timeout abort is an intentional unmount.
- **Impact**: misleading chart (wrong repo) / silent failure (permanent spinner).
- **Fix sketch**: After peek parseScanReport succeeds, assert report.repo matches the requested repo before rendering. In the AbortError branch, if `!cancelled && !timedOut`, set a generic "scan interrupted — try again" error.

## 5. withinRange keeps points with unparseable scannedAt; they blank the x-axis and feed forecastTrajectory on the server
- **Severity**: Medium
- **Category**: functionality
- **File**: src/components/report/DimensionTrends.tsx:139–142 + src/components/report/TrendChart.tsx:92–96 + src/app/trends/page.tsx:109–111
- **Scenario**: withinRange does `Number.isNaN(t) ? true : t >= cutoff` — a garbage scannedAt is deliberately KEPT in every range. shortDate(iso) returns "" (TrendChart.tsx:95) so the axis label silently blanks. More consequentially the same unvalidated date feeds `forecastTrajectory(history.scans.map(s => ({date: s.scannedAt, value: s.overallScore})))` (trends/page.tsx:109); if the forecast's date math doesn't guard NaN, one corrupt timestamp skews/voids the forward trajectory line.
- **Root cause**: "keep unparseable dates" is fine for index-based xScale position but the date is ALSO used as a label and forecast input, where blank/NaN isn't harmless.
- **Impact**: UX degradation (blank labels) + potentially misleading forecast.
- **Fix sketch**: Drop points whose Date.parse(scannedAt) is NaN at the history boundary.

## 6. RadarChart degenerates to an invisible single-vertex polygon for a one-dimension report
- **Severity**: Low
- **Category**: functionality
- **File**: src/components/report/Charts.tsx:68–80,118–153
- **Scenario**: parseScanReport guarantees dimensions.length>=1 (so angleFor's `/n` never divides by 0). But with exactly ONE dimension (truncated report passing the length===0 check), dataPath is a single "x,y" passed to <polygon> — renders nothing; rings collapse to points; the "radar" silently becomes a dot with one label while the sr-only table lists one row. No crash, but a meaningless chart presented as a 7-dimension radar.
- **Root cause**: Radar assumes the full canonical dimension set; no minimum-vertex floor / fallback.
- **Impact**: misleading/empty chart for a degenerate but validator-passing report.
- **Fix sketch**: Below ~3 dimensions, render bars/list instead of the polygon.

## 7. CSV export interpolates scannedAt/overallScore raw while sibling columns are quoted — alignment breaks if a value gains a comma
- **Severity**: Low
- **Category**: code_quality
- **File**: src/app/api/history/route.ts:28–29
- **Scenario**: historyToCsv quotes level/levelName/engineProvider via csvField but emits s.scannedAt and s.overallScore raw, and dims cells raw (`byDim.get(id) ?? ""`, line 28). Safe today (ISO date, number), but the one place bypassing the RFC-4180 quoter: if scannedAt ever carries a comma'd locale timestamp or a dim value lands as a comma-bearing string, the column count shifts and every cell misaligns in the export meant for "show my boss progress."
- **Root cause**: Inconsistent application of the quoting helper — two trusted-by-assumption columns skip it.
- **Impact**: silent failure (mis-aligned CSV → wrong numbers in a deck).
- **Fix sketch**: Run every field (scannedAt, overallScore, each dims cell) through csvField uniformly.

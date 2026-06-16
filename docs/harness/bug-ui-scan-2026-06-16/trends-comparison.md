# Trends & Comparison — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 13

## 1. Trajectory forecast ignores the active range toggle — projected ETA contradicts the chart on screen
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: stale derived UI / range filter
- **File**: src/app/trends/page.tsx:115 (forecast fit) + src/components/report/DimensionTrends.tsx:78 (range slice)
- **Scenario**: A repo has 40 scans spanning a year. The user opens `/trends`, sees the "Climbing at +3/wk, on track to reach L4 in ~6 weeks" Trajectory banner, then clicks the **5d** range toggle. The TrendChart and every DimLine re-slice to the last 5 days (maybe 1–2 points showing a recent dip), but the Trajectory banner above them does not move — it still claims a long-run rising forecast that the now-visible slice flatly contradicts.
- **Root cause**: `forecast` is computed once on the server in `TrendsPage` from the full `history.scans` (limit 60, never range-sliced) and rendered by `<Trajectory>`. The range toggle (`RangeKey` / `withinRange`) lives entirely inside the client `DimensionTrends` component and only filters the chart series; it has no channel back to the server-rendered forecast. The two views are wired to different data windows.
- **Impact**: The headline GPS — the most authoritative-looking element on the page — desynchronizes from the chart the moment a user narrows the range, presenting a contradiction (rising banner over a falling slice). This is exactly the "leader-facing read" the forecast is meant to be trusted for.
- **Fix sketch**: Either (a) move forecast computation into `DimensionTrends` so it re-fits over `withinRange(...)` whenever `range` changes, or (b) keep the forecast server-side but label it explicitly as "all-time trajectory" and visually decouple it from the range-toggled section so it doesn't read as describing the current slice.

## 2. /api/history `dims=0` light series and full series can return DIFFERENT scan counts but DimensionTrends assumes they align
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: scan-diff / series alignment
- **File**: src/components/report/DimensionTrends.tsx:40 + src/app/api/history/route.ts:88-91
- **Scenario**: A repo has 60+ scans. The server renders the page with the overall-only series `limit:60` (page.tsx:92). `DimensionTrends` then lazy-fetches dimensions with `limit = Math.max(1, history.scans.length)` = 60. If between the server render and the client fetch a new scan lands (or the DB clamps differently), the two payloads can differ by a row. The header at line 121/149 prints the count from the **overall** series, while the small-multiples plot the **full** series — so "60 scans" can sit above 59 plotted dim points (or vice-versa).
- **Root cause**: Two independent fetches (server overall-only vs client full) are assumed to be snapshots of the same immutable list, but they are taken at different times and through different code paths (`getRepositoryHistory` server call vs `/api/history` route). The header count is hard-derived from the first; the charts from the second. There is no reconciliation, and `parseRepositoryHistory` silently drops any point it can't coerce (validate.ts:123-127), which can also shrink the full series below the header count.
- **Impact**: Header "N scans shown" overstates/understates what is actually drawn — the precise bug the limit-matching comment at line 36-39 was written to prevent, but it only matches the *requested* limit, not the *returned* row count.
- **Fix sketch**: After `setFull(...)`, derive the displayed count from the actually-rendered series (`overallChrono.length` should fall back to `dimChrono.length` once `full` loads), or render the header count from whichever series is currently feeding the charts rather than always from the overall payload.

## 3. Compare diff: a dimension present in only ONE scan is shown with a misleading half-filled bar and no "added/removed" cue
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: delta visual encoding / mismatched dimensions
- **File**: src/components/report/WhatChangedParts.tsx:61-69 (DiffBar single-sided branch) + 137-145 (card header)
- **Scenario**: The maturity model adds a new dimension between two scans (or a dimension was dropped). `diffScans` correctly sets `before=null, after=72` and `delta=null` (compare.ts:226-228). The card renders the score row as `— → 🟡72` with **no DeltaTag** (guarded by `d.delta !== null`), and `DiffBar` falls into the single-sided branch drawing a plain 72%-wide colored bar — visually identical to a normal dimension sitting flat at 72. Nothing tells the reader this dimension is *new to this comparison* rather than unchanged.
- **Root cause**: The diff math deliberately suppresses an invented delta for a one-sided dimension (correct — see the comment at compare.ts:18-19), but the UI has no distinct treatment for the `before===null XOR after===null` case. `DiffBar`'s fallback collapses "added" and "removed" into one anonymous solid bar, and the absent side renders as a bare "—".
- **Impact**: On any comparison that straddles a model change, newly-added or newly-removed dimensions read as "stable at X," hiding a real structural change in what was measured. Users can't distinguish "this dimension held steady" from "this dimension didn't exist before."
- **Fix sketch**: When exactly one side is null, render an explicit badge ("new in this scan" / "not scored before") next to the dimension name and tint the `DiffBar` segment as added (green) / removed (slate), rather than a neutral solid bar.

## 4. ETag still keyed on overall `scannedAt`+`overallScore` — an in-place dimension-only correction serves a stale 304
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: caching / silent staleness
- **File**: src/app/api/history/route.ts:118-127
- **Scenario**: A scan's stored per-dimension scores are corrected in place (re-judged, a detector fix backfilled) without touching the newest row's `id`, `scannedAt`, or `overallScore`. The weak ETag signature is `${newest.id}-${newest.scannedAt}-${newest.overallScore}` and the count is unchanged, so a client holding the prior ETag gets a `304` forever and the per-dimension small-multiples never reflect the correction.
- **Root cause**: The signature was hardened (per the comment at lines 114-117) to catch *overall*-row corrections, but it folds in only the overall fields. The `includeDimensions` full payload's body can change (a dimension's score) while none of the signature inputs move. The `f`/`l` mode marker distinguishes full-vs-light responses but not two different full bodies.
- **Impact**: Asymmetric, silent: the overall chart updates after an overall correction, but a dimension-only fix is invisible to any client (or the /trends poller) caching the full series — the same "304 forever" failure the comment claims to have fixed, just one level down.
- **Fix sketch**: For the `includeDimensions` (full) response, fold a cheap signature of the newest row's dimension scores into the ETag (e.g. a sum/hash of `newest.dimensions.map(d => d.score)`), or version the row with an `updatedAt` and include it in the signature.

## 5. Single-point trend chart: SVG `aria-label` says "over time" but conveys no value; sr-table is the only equivalent
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y / single-point state
- **File**: src/components/report/TrendChart.tsx:140-141 (aria-label) + 179-196 (line/flat-label guards)
- **Scenario**: A repo with exactly one stored scan reaches `DimensionTrends` (the page note at page.tsx:155 says "baseline only," but the chart still renders). `TrendChart` draws one centered dot, no line (guarded `points.length > 1`), and no "Holding at N" label (also guarded `> 1`). The SVG's `aria-label` is the static "Overall score over time" — for a single point there is no "over time," and a screen-reader user gets only that generic label plus the visually-hidden table; sighted low-vision users see a lone dot with a value label and no axis context that it's the *only* scan.
- **Root cause**: The chart's accessible name and visible affordances are written for the multi-point case. The single-point branch has no dedicated label ("Baseline score: N, no trend yet") and no on-canvas cue distinguishing "one scan" from "a flat line that happens to render as a dot."
- **Impact**: Minor but real: the one moment a user most needs the "this is just a baseline" framing inside the chart, the chart gives the least context. The page-level note partially compensates, but the chart itself is ambiguous.
- **Fix sketch**: When `points.length === 1`, set `aria-label` to "Baseline overall score, single scan — no trend yet" and render a small on-canvas "baseline" label beside the dot, mirroring the existing "Holding at N" treatment for flat multi-point series.

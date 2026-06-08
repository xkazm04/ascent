# Feature Scout — Report & Trends Visualization

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Trajectory GPS (forecast + level ETA) on the per-repo /trends page
- **Severity**: High
- **Category**: feature
- **File**: src/app/trends/page.tsx:147 (host: `<DimensionTrends>` section); engine: src/lib/maturity/forecast.ts:82
- **Gap**: A complete, unit-tested forward forecast already exists — `forecastTrajectory()` fits an OLS slope and returns rate/wk, projected score, promotion/demotion ETA, and fit confidence (forecast.ts:36–149), rendered by `<Trajectory>`. But it's wired ONLY into the org rollup: grep for `forecastTrajectory`/`Trajectory` in `src/app/trends` and `src/components/report` returns no matches. The repo /trends page draws only rear-view lines — it never tells a user "you're climbing +2.4/wk, on track to reach L4 in ~6 weeks" for THEIR repo.
- **User value**: A repo owner gets the same "where is this heading / when do I cross the next band" GPS the org leader already has, turning trends from a record into a planning tool.
- **Implementation sketch**: Map `history.scans` to `SeriesPoint[]`, call `forecastTrajectory()` server-side in trends/page.tsx, render the existing `<Trajectory>` card above `<DimensionTrends>`; per-dimension series can each get a `forecastHeadline()`.
- **Effort**: S

## 2. Make trend points link to their scan/commit (report permalink + GitHub commit)
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/scans.ts:511 (`HistoryPoint`); consumed at TrendChart.tsx:150, chartHover.tsx:90
- **Gap**: Each trend dot is a dead end. `HistoryPoint` (scans.ts:511–520) omits `headSha`, though the DB stores it (scans.ts:378) and the sibling comparable type surfaces it (scans.ts:659/713). So the tooltip and points can't open that scan's pinned report — despite `reportPermalink(fullName, headSha)` already existing (scans.ts:838) — nor link to the GitHub commit.
- **User value**: Anyone investigating a movement can click a dot to jump to the exact pinned report or commit, instead of manually going to /report/compare.
- **Implementation sketch**: Add `headSha` to `HistoryPoint` + its `toPoint` mapper, then make TrendChart/DimLine points anchor to `reportPermalink(...)` and add a commit link in `PointTooltip`.
- **Effort**: S

## 3. Export trend history (CSV / JSON / shareable image)
- **Severity**: High
- **Category**: integration
- **File**: src/app/api/history/route.ts:65 (host endpoint); attach UI at src/app/trends/page.tsx:120
- **Gap**: No export exists anywhere (grep `csv|export|download|text/csv` finds only org-watch wording). /api/history returns JSON only. Sharing is first-class for this product (README + gate badges in ReportView), yet the trend — the key "show my boss progress" artifact — can't leave the page.
- **User value**: Leads drop the series into a QBR deck/spreadsheet; CI can pull a stable CSV; teams get a portable "L2→L4" story.
- **Implementation sketch**: Add `?format=csv` to the existing org-scoped, ETag'd /api/history route emitting `scannedAt,overall,level,D1..D9,engine` rows + a "Download CSV" button; optionally reuse the inline-SVG TrendChart for a shareable PNG/SVG like the badge route.
- **Effort**: M

## 4. Deploy / release / PR annotations on the timeline
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/report/TrendChart.tsx:124; data via src/app/api/history/route.ts
- **Gap**: No event context on the timeline (grep `annotat|milestone|marker|release` finds nothing in the chart layer). A jump/slide between scans gives no clue what changed, though scans are pinned to `headSha` and the app ingests commit/PR/governance signals.
- **User value**: A user seeing a dip understands "this is the week we removed required reviews," making trends diagnostic, not just descriptive.
- **Implementation sketch**: Derive markers from data on hand — release tags / large merges, or `scan.regression` audit entries (scan-alerts.ts) — and render vertical rules with hover labels in TrendChart; start with regression-audit markers since those rows already exist.
- **Effort**: M

## 5. Visually flag engine-mix (mock vs LLM scans) on the trend line
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/components/report/TrendChart.tsx:150; src/components/report/DimensionTrends.tsx:219
- **Gap**: Different-engine scans share one continuous line; `engineProvider` is per-point but shown only in the hover tooltip (chartHover.tsx:112). A keyless `mock` scan between two LLM scans reads as a real jump/drop. ReportView already treats `mock` as a first-class "Demo · deterministic rubric" caveat (ReportView.tsx:18,145), but the trend lines don't.
- **User value**: Users avoid misreading a methodology artifact as a maturity movement; the chart stays trustworthy across mixed histories.
- **Implementation sketch**: Style mock points differently (hollow ring / muted hue) in TrendChart + DimLine using the `engine` already on each point, plus a legend/footnote when engines mix; no new data needed.
- **Effort**: S

## 6. Side-by-side trend overlay for two repos
- **Severity**: Low
- **Category**: feature
- **File**: src/app/trends/page.tsx:40; chart host src/components/report/TrendChart.tsx
- **Gap**: /trends is strictly single-repo (`searchParams: { repo }`, trends/page.tsx:43); TrendChart takes one `points` array. The org side has `SegmentComparePicker` for cohorts, but nothing overlays two specific repos on one trend chart.
- **User value**: A platform team can compare flagship vs struggling service (or before/after adopting a practice) on one frame.
- **Implementation sketch**: Accept `?repo=a&vs=b`, fetch both via existing `getRepositoryHistory`, and extend TrendChart with an optional muted second series + legend, reusing xScale/vScale/level-band machinery.
- **Effort**: M

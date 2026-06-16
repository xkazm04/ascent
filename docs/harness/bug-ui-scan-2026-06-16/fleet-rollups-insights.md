# Fleet Rollups & Insights — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 3, Medium: 2, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 9

## 1. Rolling 30d/90d windows mix UTC-offset math with local-midnight, so deltas read against the wrong baseline near midnight / across DST
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: period-over-period window date math (timezone)
- **File**: src/lib/window.ts:93 (also :95)
- **Scenario**: `30d`/`90d` compute `start = new Date(now.getTime() - 30 * DAY)` — a pure 86,400,000-ms offset from "right now". The `quarter` and `custom` cases instead snap to *local midnight* (`startOfQuarter` → `new Date(year, q*3, 1)`; `parseDay` → `T00:00:00` local). So the baseline date for the rolling windows is an arbitrary wall-clock time (e.g. 14:37:xx), not a day boundary, and it drifts by an hour across a DST transition (DAY is a fixed 86.4M ms, but a calendar day spanning a DST change is 23h or 25h). The baseline query then selects `scan.scannedAt <= start` (org-rollup.ts:257) and the trend selects `scannedAt >= start` (org-rollup.ts:223).
- **Root cause**: Inconsistent time model — fixed-ms subtraction for presets vs. local-midnight construction elsewhere; no normalization of `start` to a day boundary.
- **Impact**: A repo scanned earlier on the boundary day lands on the wrong side of `start` depending on the hour the page is rendered, so the cohort baseline (and which day's scans count as "in window") flickers within the same calendar day and shifts by an hour around DST. The "vs 90d ago" delta is computed against a baseline that is not actually 90 calendar days back.
- **Fix sketch**: Normalize preset starts to local midnight: `start = startOfDay(new Date(now.getTime() - N*DAY))`, where `startOfDay` zeroes h/m/s/ms — matching the `quarter`/`custom` model. Consider counting back N calendar days rather than N×86.4M ms if calendar-day semantics are intended.

## 2. Baseline boundary uses `<=`/`>=` on the same instant, double-counting a scan exactly at `start`
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: baseline date off-by-one / boundary overlap
- **File**: src/lib/db/org-rollup.ts:257 (baseline `lte: start`) vs :223 (trend `gte: start`)
- **Scenario**: The baseline "fleet as it stood at window start" fetches scans with `scannedAt: { lte: start }`, while the in-window trend fetches `scannedAt: { gte: start }`. A scan whose timestamp equals `start` exactly is simultaneously the baseline snapshot *and* the first in-window point. With `custom` ranges (where `start` is a clean local midnight) and snapshot/seed data scanned at exactly 00:00:00, this boundary collision is real, not theoretical. `getOrgMovers` shares the ambiguity: `arr.find((s) => s.scannedAt <= start)` (org-insights.ts:109) treats a scan *at* `start` as the baseline, yet that same scan is also a candidate for "now".
- **Root cause**: Inclusive-on-both-sides boundary; no decision on whether `start` belongs to the baseline period or the present window.
- **Impact**: Period-over-period delta and movers compare a scan against (effectively) itself on the boundary day → a spurious 0-delta baseline or a repo dropped from movers when `prev === now`. Low blast radius but produces "moved by 0" rows and an off-by-one in `comparedRepos`.
- **Fix sketch**: Make the window half-open: baseline `scannedAt < start`, trend/in-window `scannedAt >= start` (or vice-versa) so each scan lands on exactly one side.

## 3. `getOrgMovers` windowed baseline silently degrades to "since first in-window scan" with no flag, conflating period delta with first-ever delta
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent fallback / mover delta semantics
- **File**: src/lib/db/org-insights.ts:109
- **Scenario**: `const prev = arr.find((s) => s.scannedAt <= start) ?? arr[arr.length - 1];` — for a repo onboarded mid-period (no scan at/before `start`), the baseline falls back to the *earliest in-window* scan. That fallback is documented, but the resulting `RepoMove` is indistinguishable from a true period delta: `dOverall`, `sinceDays`, `levelDelta` are all relative to first-ever-scan, not "90d ago". These rows then feed `gainers`/`levelChanges` and `comparedRepos` (:134-137) and the page's `regressionCount`.
- **Root cause**: Two different baselines (period-baseline vs. first-observation) collapsed into one code path with no marker on the output. A repo with a *single* in-window scan is correctly skipped (`prev === now`), but a repo with two scans both after `start` reports its full lifetime delta as a period delta.
- **Impact**: Onboarding a repo that improved since its first-ever scan injects an inflated "gainer" into the period movers and inflates `comparedRepos`, overstating fleet momentum for the selected period — the exact composition-vs-movement confusion `computeWindowDeltas` was written to avoid, reintroduced in the movers panel.
- **Fix sketch**: Tag fallback moves (e.g. `baselineKind: "onboarded"`) and either exclude them from the period gainers/regressers or surface them as a separate "new this period" group; don't count lifetime deltas toward period movement.

## 4. `forecastTrajectory` is fed the windowed `trend`, so short windows fit a slope over 1 day and project off near-noise
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: aggregation over single-scan / single-day windows
- **File**: src/lib/db/org-rollup.ts:243 (uses `trend` built from `allScans` filtered to the window, :220-240)
- **Scenario**: `trend` is the per-day org average *within the window* only (`scannedAt` bounded by `start`/`end`). For a 30-day window on a fleet that scans, say, weekly, the trend can collapse to 1–2 distinct days. `forecastTrajectory(trend.map(...))` then fits an OLS line through ≤2 points. The forecast type's own doc says it needs "at least two distinct scan days" — a 30d window on a sparsely-scanned fleet can yield exactly one day, or two adjacent days that produce a wild `perDay` slope extrapolated to a promotion/demotion ETA.
- **Root cause**: The trend (rear-view, bounded to the selected period) is reused as the input to the forward-looking forecast, which wants as much history as possible. Window scoping that's correct for "movers this period" is wrong for "where is the org heading".
- **Impact**: Switching the dashboard to a short range can flip the projected trajectory and ETA to a confident-but-meaningless value derived from one or two in-window days, even when months of history exist — a misleading "projected demotion in 12 days" on noise.
- **Fix sketch**: Fit the forecast over full (or a min-span) history independent of the display window, or suppress the forecast when `trend` has < N distinct days / spans < N days (mirror the forecast module's own minimum-points guard at the call site).

## 5. `dueBucketFor`/`daysUntil` bucket on UTC calendar days while the fleet's window math is local — overdue/this-week flips for non-UTC viewers
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: timezone boundary in date bucketing
- **File**: src/lib/db/org-insights.ts:223 (`daysUntil` → `Date.UTC(...)`), consumed at :234 / :391 / :465
- **Scenario**: `daysUntil` truncates both `target` and `now` to their **UTC** Y/M/D before differencing, then `dueBucketFor` maps `< 0 → overdue`, `<= 7 → this_week`. But `now` is `new Date()` (server clock) and the rest of the fleet date logic (window.ts quarter/custom) is **local-midnight**. For a viewer/server west of UTC, a `targetDate` of "today local" can read as +0 or −1 UTC days depending on the hour, so an item due today is bucketed `overdue`, and the `dueSoon` count (:465, `dueInDays >= 0 && <= 7`) and per-item `overdue` flag (:392) flip at the UTC day boundary rather than the user's midnight.
- **Root cause**: Mixed date reference frames — UTC-truncation in the backlog vs. local-midnight in the window layer — with no single canonical "org day".
- **Impact**: Recommendations show as overdue (or drop out of "due this week") up to a day early/late for any non-UTC user, and the `overdue` tally on owner groups and the summary is off by the count of boundary-day items. Pure mis-bucketing, not a crash, but it directly drives the "needs attention" affordances leaders act on.
- **Fix sketch**: Pick one reference frame for the org and apply it everywhere (truncate `now`/`targetDate` to local day, or store/compare an explicit org timezone). At minimum, make `daysUntil`'s frame match `window.ts` so all date thresholds agree.

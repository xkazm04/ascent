# The plan's history window is an access boundary

- **Status:** Accepted (2026-10-09, the day the last commit below landed)
- **Date:** 2026-10-09
- **Deciders:** App Master `ascent`, through the full council on `scan-history-trends`, rounds 1 and 2
  (2026-10-08). **No source this author could read shows an operator ruling on it.** One branch of the
  rule is marked in the code as "the App Master's pending decision" (`src/lib/history/window.ts:13-14`);
  the operator has not ruled on that either, in any source read.

## Constraint

`/pricing` sells a history depth per plan: `retentionDays` is 30 on Free, 180 on Starter, 365 on Team and
unlimited on Custom (`src/lib/plans.ts:240`, `:264`, `:275`, `:290`). The org reads and the personal
overview already clamped to it (`retentionCutoff`, `src/lib/db/personal.ts:160`). The per-repo history
surfaces did not.

Round 1 (`.claude/master/ascent/headless/council/2026-10-08-scan-history-trends-r1/report.md`, head
`2560e20a`) put this first in `must_address` (value-1, high): "The tier's history window sold on /pricing
is not applied on /trends, /report/compare or the CSV, while the personal overview one click away does
apply it." `/trends` read up to 200 scans plus the compacted tail, `/report/compare` read 60 and the CSV
read 200, all bounded by count only. A Free viewer saw 30 days on the overview and the whole corpus one
click away. Two declared characters, Mariam and Priyanka, name retention honesty as their acceptance check,
and no span test covered the window on any of the three surfaces (robustness-3).

Round 2 (`.../2026-10-08-scan-history-trends-r2/report.md`, head `2e99e29c`) found the fix had introduced
its own defect (craft-1, high), which it put first in `must_address` and which dropped craft 0.10: the
forecast was now fit on the windowed series while the panel still printed "Fit over this repository's full
recorded history" and `forecast.ts` still stated that contract. Under a 30-day window both were false, and
the same repo projected a different ETA on each tier.

## Decision

**The plan's history window is the access boundary of a history read. A read that the plan clamps never
fetches rows beyond the window, and nothing derived from the read claims to have seen more.**

1. **One helper decides, and the readers take `since`.** `resolveHistoryWindow(orgSlug, viewerLogin)`
   returns `{ since, days, planLabel }` (`src/lib/history/window.ts:41-57`). In order: a read under a
   tenant org gets that org's plan window; a read under the shared public org by a signed-in viewer with a
   personal workspace gets that workspace's plan window, so the overview and its Trends and Compare links
   show one window; anyone else is not clamped; self-host is never clamped because `retentionCutoff` is
   null there. `getRepositoryHistory` and `getScanComparison` gained an optional `since` that adds
   `scannedAt >= since` to the scan query and skips compacted periods that end before it
   (`src/lib/db/scans-read.ts:432`, `:499-501`, `:529`, `:711-752`; `7f50f215`).
2. **Trends, `/api/history` (JSON and CSV) and Compare read under the window** (`d4457259`):
   `src/app/trends/page.tsx:112-119`, `src/app/api/history/route.ts:111-117`,
   `src/app/report/compare/page.tsx:96-103`. The JSON and CSV carry an `x-ascent-history-since` header when
   clamped (`route.ts:112-113`). A window that hides every scan says so instead of "No scans recorded yet"
   (`historyOutsideWindowNote`). Documented at `566d3a89` (`docs/features/reporting/report.md`, "The
   history window").
3. **The trajectory fit runs over the window, and the panel says so.** The heading is
   "{N}-day trajectory" instead of "All-time trajectory", and the basis line reads "Fit over the N scans in
   the last N days, the <plan> plan's history window"
   (`src/app/trends/TrajectoryPanel.tsx:30-40`, `:63`; `5fb5b58f`, docs `a37b34bd`). `forecast.ts:1-23`
   now states the decision, including that it deviates from the governing standard.
4. **The window's org row is read through `scans-read`, not the raw client**, and the lookup is strict: an
   unreachable database is a `DbUnavailableError`, never an unclamped read (`getOrgForHistoryWindow`,
   `window.ts:50`, `:54`; `7fc91208`).

## What the windowed fit gives up

The fit is no longer a function of the repo alone; it is a function of the repo and the viewer's plan.

- **History older than the window cannot inform the slope.** A Free viewer's ETA rests on at most 30
  days of scans; a repo that changed direction 40 days ago looks as if it never had a prior trend.
- **Thin windows refuse to project.** `forecastInsufficiency` declines when the fit saw fewer than 3
  distinct scan days or less than 14 days of span (`forecast.ts:21-23`). A Free repo scanned weekly gets a
  projection only after the window holds enough scans, and one scanned monthly may never get one.
- **Two tiers see two ETAs for one repo.** This is the cost the round 2 finding named. The panel now
  discloses the basis; it does not remove the difference.
- **The rubric cut applies inside the window.** The fit uses only the trailing run of points scored under
  the latest point's rubric (`forecast.ts:29-32`), so a rubric bump inside a short window leaves fewer
  points still.

## Alternatives that lost

- **Fit over the unclamped read and clamp only what is drawn.** One of the two remedies round 2 named. The
  forecast would be the same on every tier and use the most evidence. It lost because the point of a window
  is that rows beyond it are not part of the plan: a figure derived from them (a slope, an ETA) discloses
  what the plan does not include (`forecast.ts:12-16`: "fitting older history would derive a figure from data
  the plan does not include"). It also requires the unclamped read, which is the one thing the access rule
  forbids.
- **Withhold the projection under any window.** The second remedy round 2 named. It never shows a
  tier-dependent number. It lost because it removes the forecast for every Free and Starter viewer, who are
  the viewers most likely to want a number, and the plan sells the window, not the absence of forecasts.
  The windowed fit with a named basis keeps the feature and is honest about what it saw.
- **Clamp the display only, and keep reading everything.** Cheap, and a window toggle on the chart. It lost
  because it makes the window a rendering choice: the CSV, the API and the compare read would still hand
  over the whole corpus, which is the defect round 1 found.
- **Drop the sold window instead, so the claim matches `/trends`.** Round 1 named this as the other half of
  the decision. It lost because `plans.ts` sells depth as a tier differentiator, and the overview, the org
  reads and `retentionCutoff` already enforce it; removing the claim would change the pricing page and the
  tier ladder, which is not a history-reader change.
- **A count cap per plan instead of a date.** What the reads did already (200, 60). It lost because the
  plan is sold in days; a count cannot say "30 days", and a daily-scanned repo and a monthly one would
  see different spans for the same plan.

## Consequences

- **The window is opt-in per caller.** `since` is optional on both readers (`scans-read.ts:432`, `:725`),
  so a new caller that forgets it reads unclamped. Round 2 filed this (craft-2, med).
- **Two surfaces still read without the window at this head.** The report permalink calls
  `getRepositoryHistory(owner, name, { orgSlug, strict: true })` with no `since`
  (`src/app/report/[owner]/[repo]/page.tsx:241`), and `/api/org/repo-dimension` calls it with
  `{ orgSlug: org, limit: 12 }` (`src/app/api/org/repo-dimension/route.ts:46`). Round 2 filed the
  permalink as value-permalink-window (med): one click from the clamped pages, a trust cost.
- **A signed-out reader of the public org is unclamped** (`window.ts:53`, the branch marked pending).
  Whether that is right is the App Master's open decision, to be changed in `window.ts` and nowhere else.
- **A compacted period that straddles the floor carries pre-window sums** (`scans-read.ts:529` skips only
  periods that end before `since`). Round 2: craft-4 (low) names the semantics, economics-3 (low) the cost
  of digest rows read and discarded.
- **Every history read now does one more read first**, the org row (`window.ts:50`, `:54`), strictly.
  Economics stays unmeasured: every read is capped by a constant, but the repo has no per-read price.

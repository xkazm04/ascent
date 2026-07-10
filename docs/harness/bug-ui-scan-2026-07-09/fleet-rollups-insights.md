# Fleet Rollups & Insights — bug-hunter + ui-perfectionist scan

> Context: Fleet Rollups & Insights (group: Org Scanning & Fleet Rollups)
> Files scanned: 11
> Total: 7 findings (Critical: 0, High: 0, Medium: 4, Low: 3)

All findings are bug-hunter. This context is pure backend aggregation (10 `.ts` + 1 constant); there are no UI files, so 0 UI-perfectionist findings — none invented.

## 1. Baseline query pulls the org's entire pre-window scan history into memory
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: unbounded-query
- **File**: src/lib/db/org-rollup.ts:425
- **Scenario**: An org scanned daily across hundreds of repos for a year+ opens the Overview with any window (`start` set). The baseline `prisma.scan.findMany({ where: { repo, scannedAt: { lt: start } }, orderBy: desc })` has no `take` and no `distinct`, so it returns EVERY scan before `start` (tens of thousands of rows) only to dedupe to one-per-repo in a JS loop (lines 434-440).
- **Root cause**: The assumption "we only need latest-per-repo, so fetch-all-then-dedupe is fine" — the sibling `getOrgMovers` (org-insights.ts:106-120) already rejected this exact pattern and added `distinct: ["repoId"]`; the rollup baseline was never given the same fix, so the two diverged.
- **Impact**: Slow dashboards / Node memory pressure that scales with fleet AGE, not the selected period — the precise blow-up the movers comment (org-insights.ts:82-87) warns about, still live here.
- **Fix sketch**: Add `distinct: ["repoId"]` to the `priorScans` query (already ordered `scannedAt desc`), then drop the manual `seen`/`latestPerRepo` dedupe loop — the DB returns one row per repo.

## 2. Trend buckets by UTC calendar day while window boundaries are local midnight
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: timezone-boundary
- **File**: src/lib/db/org-rollup.ts:398
- **Scenario**: Server runs in a non-UTC zone (e.g. UTC+2). A scan at `2026-05-01 01:00` local (= `2026-04-30 23:00Z`) and another at `2026-05-01 10:00` local land in DIFFERENT trend buckets (`toISOString().slice(0,10)` → "2026-04-30" vs "2026-05-01"), even though both are the same local calendar day. Meanwhile the window `start`/`end` snap to LOCAL midnight (window.ts:66-68, `startOfDay`).
- **Root cause**: Two different day definitions in one pipeline — the window filter is local-zoned, the trend/day rollup is UTC-zoned. A late-evening scan is filtered by one calendar and labelled by another.
- **Impact**: The maturity trend line and `forecastTrajectory` fit (line 411) are plotted against dates that can be off by a day and split a single day's scans across two points, quietly skewing the projected promotion/demotion ETA.
- **Fix sketch**: Bucket by the same local calendar the window uses (derive `y-m-d` from local `getFullYear/Month/Date`), or move the whole subsystem to UTC days including window.ts — pick one zone and share it.

## 3. Fleet PR rates are an unweighted mean of per-repo rates (average-of-averages)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: average-of-averages
- **File**: src/lib/db/org-signals.ts:94
- **Scenario**: Fleet has a 1-PR toy repo (100% merge rate) and a 500-PR flagship (60%). `avgMergeRate = mean(stats.map(s => s.mergeRate))` reports ~80% — a number no meaningful slice of PRs experienced. Same shape for `avgReviewedRate`, `avgSmallPrRate`, `avgAiInvolvedRate`, `avgAiGovernedRate` (lines 95-98).
- **Root cause**: The assumption that a "fleet rate" is the mean of repo rates. Each repo votes equally regardless of PR volume, so tiny repos dominate — even though `totalPrs` (line 93) proves the volume weights are in hand. The org's OWN AI-share metric is correctly commit-weighted (org-contributors.ts:151 `aiCommitsTotal/totalCommits`), so the codebase is internally inconsistent about weighting.
- **Impact**: Delivery-tab headline rates are biased toward low-traffic repos; leadership reads an inflated/deflated fleet merge/review posture.
- **Fix sketch**: Weight by `analyzed` (e.g. mergeRate = Σ(rate·analyzed)/Σanalyzed), or if per-repo-typical is genuinely intended, rename to `medianRepoMergeRate` so it isn't read as a fleet rate.

## 4. Fleet activity trend has no recency bound — one stale repo stretches the grid
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: unbounded-aggregation
- **File**: src/lib/db/org-signals.ts:330
- **Scenario**: One watched repo was scanned a year ago and never re-scanned; its year-old `commitActivity` is still its latest scan. Another repo was scanned today. `minWk`/`maxWk` (lines 331-332) then span ~52 weeks and the zero-fill loop (line 334) emits a ~52-element series that is ~90% zeros, with a lone spike a year back. Unlike `getOrgRollup`'s trend, `getOrgActivity` takes NO window/retention param (line 283).
- **Root cause**: The assumption that every repo's latest scan is recent. Absolute-week bucketing is correct, but nothing bounds how far back a stale repo can drag the grid, and no window scopes it.
- **Impact**: The fleet sparkline's `weeks`/`total` misrepresent recent activity; a single un-rescanned repo dilutes and mislabels the whole trend.
- **Fix sketch**: Accept the dashboard window (or a fixed trailing horizon, e.g. last N weeks from now) and clamp `minWk = max(minWk, now - N)`; drop scan series older than the horizon before bucketing.

## 5. Benchmark loads every other org's repos + latest scans into Node uncapped
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: unbounded-query
- **File**: src/lib/db/org-insights.ts:591
- **Scenario**: `getOrgBenchmark` runs `prisma.repository.findMany({ where: { orgId: { not: org.id } }, include latest scan })` with no `take`. As the platform grows, every dashboard/digest render that shows a percentile pulls the ENTIRE cross-tenant corpus (all repos of all other orgs) into memory to compute per-org means.
- **Root cause**: The percentile needs a corpus distribution, but the whole corpus is materialized on every call rather than pre-aggregated.
- **Impact**: Latency and memory grow linearly with total customer count on a hot path; a scaling landmine, not a today-bug.
- **Fix sketch**: Aggregate org means in SQL (`groupBy orgId` with `avg`) instead of streaming raw repos, and/or cache the corpus distribution behind a short TTL.

## 6. Single-key sorts leave ties in non-deterministic order
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: unstable-sort
- **File**: src/lib/db/org-insights.ts:164
- **Scenario**: `gainers`/`regressers`/`levelChanges` (lines 164-166) sort only by `dOverall`/`levelDelta`; `concentration` (org-contributors.ts:135) sorts only by `topShare`. Repos tied on the sole key keep Map-iteration order, which follows DB row order and can differ between the SSR render and a client re-fetch.
- **Root cause**: No final deterministic tiebreak (unlike `dimAverages`/`byOwner`, which do add one). Ties are common (e.g. many `levelDelta === 1`, many `topShare === 100` solo repos).
- **Impact**: List order flickers on hydration and shuffles across renders for tied rows — minor UX churn, and unstable if ever paginated.
- **Fix sketch**: Append `|| a.fullName.localeCompare(b.fullName)` to each single-key comparator.

## 7. Team "knowledge leader" is named with no minimum-population floor
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: shared-invariant-drift
- **File**: src/lib/db/org-teams.ts:262
- **Scenario**: A team with a single human who has one AI-attributed commit passes `aiContributors > 0` and can become the org's headline `knowledgeLeader` (lines 262-265). `champions.ts:7` states CHAMPION_MIN_POP "must be applied IDENTICALLY everywhere champions are surfaced" to avoid exactly this success theater, yet the aggregation layer applies NO floor — the guard exists only in individual UI components (e.g. TeamsMatrixDetail gates champion display on `team.contributors`, but `knowledgeLeader` is gated nowhere on population).
- **Root cause**: The population guarantee is enforced per-view instead of centralized in the data layer, so any consumer that renders `knowledgeLeader` (or team `champions`) without re-implementing the check surfaces a 1-person "leader".
- **Impact**: A near-empty team is celebrated as the org's AI-knowledge leader on the Teams surface / digests — the surveillance-y false-signal champions.ts was written to prevent.
- **Fix sketch**: Enforce `contributors >= CHAMPION_MIN_POP` inside `rollupTeams` when electing `knowledgeLeader` and when emitting `champions`, so the floor can't be dodged by a consumer.

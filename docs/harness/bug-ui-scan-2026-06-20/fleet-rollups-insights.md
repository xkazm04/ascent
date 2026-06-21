> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Fleet Rollups & Insights — combined bug+ui scan

## 1. Fleet commit-activity trend sums mismatched calendar weeks across repos
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: aggregation / stale-data
- **File**: src/lib/db/org-signals.ts:178-185
- **Scenario**: Org has repo A scanned today and repo B scanned 4 weeks ago. Each repo's `commitActivity` is GitHub's trailing weekly series ending at its OWN scan time. `getOrgActivity` aligns the per-repo series by the LAST element (`offset = maxLen - s.length`, then sums `series[offset+i] += s[i]`), i.e. it assumes every repo's final week is the SAME calendar week.
- **Root cause**: "Align by most-recent week (last element)" is only correct if all repos were scanned in the same week. Stored series end at heterogeneous scan dates, so element N of repo A (this week) is summed with element N of repo B (4 weeks ago). The fleet trend mixes different real weeks into one bucket.
- **Impact**: The fleet activity sparkline/total is silently wrong whenever repos are scanned on different cadences (the normal case for a watchlist) — the rightmost "this week" bar double-counts a stale repo's month-old week, understating recent weeks and overstating older ones. Misleads delivery/activity reads.
- **Fix sketch**: Persist/derive a week ANCHOR (e.g. each scan's `scannedAt` ISO-week, or store week-start dates with the series) and align series by absolute calendar week before summing; pad/truncate per-repo to a common week grid. Or only aggregate repos scanned within the same recent week and label the window accordingly.

## 2. Cohort percentile compares the org's MEAN against peers' per-repo distribution
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: scoring / statistics
- **File**: src/lib/db/org-insights.ts:612-614, 621
- **Scenario**: An org with 8 repos averaging 60 is benchmarked against a peer cohort whose per-repo scores are widely spread. `percentileOf(peers.map(p => p.overall), myAvgOverall, ...)` ranks a single SCALAR (the org's mean) inside the cohort's per-repo values.
- **Root cause**: A mean of N repos is far less variable than individual repos, so comparing one aggregated number against an un-aggregated distribution systematically biases the percentile toward the middle (an org of many mediocre repos reads "average", an org with one star + many weak repos can't surface). The comparison unit is inconsistent: scalar-vs-population, not population-vs-population or mean-vs-mean.
- **Impact**: The headline "you beat X% of peers/orgs" is statistically skewed — the same set of repos benchmarked individually vs. aggregated gives different stories. Drives the dashboard and the digest, so it's a visible, repeatedly-wrong number (the sample-floor fix addressed tiny corpora, not this unit mismatch).
- **Fix sketch**: Either compare the org mean against the distribution of OTHER ORGS' means (group corpus by org, average each, then percentile), or compare per-repo against per-repo. Pick one unit and apply it to both corpus and cohort paths consistently.

## 3. Baseline cohort is NOT retention-clamped while the trend is — deltas can use invisible history
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / consistency
- **File**: src/lib/db/org-rollup.ts:224-233 vs 262-270
- **Scenario**: A Free-plan org (30d retention) views the 90d window. The trend query clamps its lower bound to `retentionCutoff` (30d), but the baseline `priorScans` query (`scannedAt: { lt: start }`) has NO retention floor, so it can pull a scan from 88 days ago to compute the headline period delta.
- **Root cause**: Retention was applied to `trendStart` only. The baseline/deltas path was added with the half-open `lt: start` cohort but never threaded through the same `retentionCutoff` floor, so the two surfaces disagree on how far back data is "allowed" to be read.
- **Impact**: The "▲ +N vs last quarter" tile can be computed from a baseline scan the org's plan is otherwise not permitted to see (and that the trend chart deliberately hides), so the delta references a point the user can't corroborate on the chart — a subtle CRED/retention inconsistency, and a delta that silently changes meaning by plan tier.
- **Fix sketch**: Clamp the baseline query's lower bound to the same `retentionStart` (e.g. `scannedAt: { lt: start, gte: retentionStart }` when `retentionStart` exists), so deltas and trend look back exactly as far as the tier buys.

## 4. repo-specific outliers can re-flag a dimension already named a common org gap
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: aggregation / double-counting
- **File**: src/lib/db/org-insights.ts:774-812
- **Scenario**: A dimension where most repos are weak (avg ~48) qualifies as a `commonGap` AND has `orgAvg >= HEALTHY_AVG (50)` is impossible — but a dimension at avg exactly 50-52 with ~half the repos weak can land in `commonGaps` (weak ratio ≥ 0.5) while its worst repo (delta ≥ 18) ALSO lands in `repoSpecific`. The same gap is presented as both "systemic, fix once" and "this one repo lags".
- **Root cause**: `commonGaps` (ratio-of-weak) and `repoSpecific` (below-org-avg outlier) are computed independently with overlapping thresholds (`GAP_SCORE 45`, `COMMON_RATIO 0.5`, `HEALTHY_AVG 50`, `OUTLIER_DELTA 18`); there's no exclusion of common-gap dimensions from the repo-specific pass.
- **Impact**: Contradictory guidance in the same view ("is this an org problem or a repo problem?" — the section's explicit promise) — leadership sees a dimension flagged systemically and simultaneously blamed on one repo, eroding trust in the insight.
- **Fix sketch**: After computing `commonGaps`, exclude those dimIds from the `repoSpecific` scan (a dimension is EITHER systemic OR repo-specific, per the section's framing), or annotate repo-specific outliers that fall on a common-gap dimension so the UI can de-emphasize them.

## 5. Loading/empty distinction missing: gap-analysis & several rollups return null both when DB-off and when no data
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: empty/loading-state
- **File**: src/lib/db/org-insights.ts:739-743,770 (also org-signals.ts:21-25,43; org-rollup.ts:148-152)
- **Scenario**: `getOrgGapAnalysis` (and siblings) return `null` for THREE different conditions — DB not configured, org not found, and "scanned === 0 / no parseable data". The consuming page can only render one generic empty/blank state for all three.
- **Root cause**: A single `null` sentinel collapses "not available yet / misconfigured" and "available but empty fleet" into one signal. The caller cannot tell "scan some repos to populate this" (actionable empty) from "persistence off" (system state).
- **Impact**: Users with watched-but-unscanned repos see the same blank as a misconfigured deployment, with no nudge to run a scan — a worse first-run/empty experience on exactly the high-value insight panels.
- **Fix sketch**: Return a discriminated result (e.g. `{ status: "disabled" | "empty" | "ok"; data?… }`) or at minimum a non-null empty shape (`scanned: 0`) for the "no data yet" case, so pages can render an actionable empty state distinct from the disabled/error state.

## 6. PR-signal fleet averages are unweighted means of per-repo rates (tiny-sample repos skew the headline)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: averaging / weighting
- **File**: src/lib/db/org-signals.ts:45-60
- **Scenario**: Repo A analyzed 500 PRs at 80% merge rate; repo B analyzed 3 PRs at 0%. `avgMergeRate = mean([80, 0]) = 40` — a 3-PR repo drags the fleet number as hard as a 500-PR repo.
- **Root cause**: Each fleet metric is `mean(stats.map(s => s.rate))` — an unweighted average of per-repo rates, ignoring each repo's `analyzed` sample size, even though `totalPrs` is computed and available.
- **Impact**: A handful of barely-active repos distort the fleet's merge/reviewed/AI-involved rates, making the org-level PR posture noisy and occasionally misleading on the adoption/delivery views. (`reviewedRate`/`aiGovernedRate` already filter null-sample repos but still average the rest unweighted.)
- **Fix sketch**: Weight each rate by the repo's `analyzed` count (sum numerators ÷ sum denominators) for the fleet average, or gate per-repo rates behind a minimum-sample floor before including them — matching the sample-floor discipline used elsewhere (percentileOf, CHAMPION_MIN_POP).

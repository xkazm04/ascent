# Fleet Alerts & Digests — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 2, Medium: 2, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 7

Scope files: `src/lib/alerts.ts`, `src/lib/db/org-alerts.ts`, `src/app/api/org/alerts/route.ts`, `src/app/api/cron/digest/route.ts`. Cross-referenced (read-only) for semantics: `src/lib/db/org-rollup.ts`, `src/lib/db/org-insights.ts`, `src/app/api/cron/rescan/route.ts`, `src/lib/scan-alerts.ts`.

This is a backend alert/cron surface, so all findings are bug-hunter (no file in scope renders UI). Auth on the privileged `/api/cron/digest` route is correctly fail-closed (`CRON_SECRET` unset → 503; bearer-or-`?key=` match → else 401) — that hardening is solid and is NOT flagged. The findings below are the duplicate-dispatch gap, two date/window/delta correctness bugs, and two silent-failure observability holes.

## 1. Digest cron has no idempotency guard — overlapping/retried runs double-send the weekly digest
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: idempotency / duplicate dispatch
- **File**: src/app/api/cron/digest/route.ts:54-95
- **Scenario**: Vercel Cron occasionally double-fires, a run nears the `maxDuration = 300` ceiling and is retried, or an operator hits the documented manual retry path (`?key=SECRET`). The loop re-runs `dispatchAlert` for every org with no claim/dedupe, so each tenant receives two (or more) identical weekly digests in its Slack channel.
- **Root cause**: The sibling autoscan cron (`src/app/api/cron/rescan/route.ts:79-89`) was deliberately built with a CLAIM-BEFORE-WORK guard (`claimRescan` atomically advances `nextScanAt` only while still due) precisely because "a long batch near the 300s ceiling, a manual `?key=` retry, or a re-fired schedule" can overlap. The digest route does the equivalent push work (`dispatchAlert` to an external channel) with **no** per-org "already sent this period" marker — there is no `digestSentAt` column, no dedupe table, and the dispatch is not gated on any window-scoped claim. A grep for `digestSentAt|idempoten|dedupe` finds nothing for this path.
- **Impact**: Duplicate fleet digests land in customer channels on any cron overlap or manual retry — the exact failure mode the rescan route documents and defends against. Erodes trust in the "one reliable weekly push" the feature is sold on.
- **Fix sketch**: Add a window-scoped claim mirroring `claimRescan`: e.g. an `Organization.digestSentAt` (or a `(orgId, periodStart)` unique row) updated conditionally `WHERE digestSentAt < windowStart` before dispatch; skip when the conditional update affects 0 rows. Count those as a new `skippedAlreadySent` in the response for observability.

## 2. Digest window baseline is unreachable for sub-weekly cadences → "this week" delta silently vanishes
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: date/window logic
- **File**: src/app/api/cron/digest/route.ts:49,83 (+ src/lib/db/org-rollup.ts:255-289)
- **Scenario**: The digest sets `win = { start: now − 7 days, end: null }` and reads `overallDelta: rollup.deltas?.overall ?? null`. In `getOrgRollup`, `deltas` is non-null only when there is a prior scan at-or-before `start` (`scannedAt: { lte: start }`) that overlaps the current cohort. A fleet on the default **weekly** scan cadence frequently has its most recent prior scan *inside* the 7-day window (e.g. 6 days ago), so there is **no** scan ≤ `start` for those repos → `latestPerRepo` excludes them → `computeWindowDeltas` cohort doesn't overlap → `deltas = null`.
- **Root cause**: The digest window start (exactly 7 days) is narrower than the scan cadence it is summarizing, so the baseline snapshot ("latest scan ≤ start") is routinely empty for the repos that actually moved this week. The delta is computed against an absolute calendar boundary, not "the previous scan."
- **Impact**: The headline line in `buildFleetDigestMessage` (alerts.ts:168-173) collapses to `""` (no "+N this week" / "no change this week" suffix) for most real fleets — the single number a leader scans for is silently missing, even when scores moved. Worsens for newer orgs: any org with no scan older than 7 days *never* shows a weekly delta.
- **Fix sketch**: Either widen the baseline lookback (e.g. `start = now − 8d` or "latest scan strictly before the window") or have the digest derive its delta from `getOrgMovers` aggregate movement (which already falls back to each repo's earliest in-window scan, org-insights.ts:103-111) rather than the rollup's calendar-boundary baseline.

## 3. Digest headline delta can contradict its own gainers/regressers lists
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: aggregate consistency
- **File**: src/app/api/cron/digest/route.ts:83-85 (delta vs movers)
- **Scenario**: `overallDelta` comes from `rollup.deltas.overall`, which is **cohort-matched and rounded** (`computeWindowDeltas` averages only repos present on both sides, rounding each side before subtracting). `gainers`/`regressers` come from `getOrgMovers`, a different query with a different baseline rule (latest scan ≤ start, else earliest in-window). The two can disagree: the headline can read "(no change this week)" while the body lists three regressions, or show "+3 this week" with an empty movers list (movement absorbed by rounding or by repos outside the matched cohort).
- **Root cause**: Two independently-computed aggregates over different cohorts and rounding regimes are presented as one coherent story. `computeWindowDeltas` rounds each cohort average before subtracting (org-rollup.ts:139-144), so e.g. +0.4 net reads as 0; movers thresholds at raw `dOverall > 0`.
- **Impact**: A leader sees a digest whose summary number contradicts the listed movers — looks like a data bug and undermines the digest's credibility. The "(no change this week)" wording (alerts.ts:171) is especially jarring next to a "Regressions:" block.
- **Fix sketch**: Derive the headline delta from the same mover set the body shows (or suppress the "no change" wording when the movers lists are non-empty). At minimum, document that the headline is cohort-matched-and-rounded while the lists are per-repo raw, and reconcile the rounding boundary.

## 4. `rollup.scannedCount === 0` skip is invisible in the response — empty fleets look identical to nothing-to-do
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent failure / observability
- **File**: src/app/api/cron/digest/route.ts:65,95-101
- **Scenario**: An org with a configured sink but no scans in the window hits `if (!rollup || rollup.scannedCount === 0) continue;` and is dropped without incrementing any counter. Separately, when `dispatchAlert` returns `false` (the org's webhook 4xx/5xx'd — alerts.ts:330-338 swallows it and returns false), `sent` is not incremented and nothing is recorded. The final JSON `{ orgs, sent, skippedNoSink, errors }` therefore can't distinguish "org skipped, no data yet," "webhook rejected the post," and "dispatched OK."
- **Root cause**: The loop has three terminal outcomes (skipped-no-sink, skipped-no-data, dispatch-failed) but only two are counted; dispatch failure is fully silent because `dispatchAlert` is designed never to throw and only logs `console.error`. `orgs.length − sent − skippedNoSink` is an undifferentiated bucket.
- **Impact**: An operator watching the cron response cannot tell a healthy "no scans yet" org from a tenant whose Slack webhook is silently returning 404 every week. A misconfigured/revoked org webhook drops digests indefinitely with zero signal in the route's own output.
- **Fix sketch**: Track `skippedNoData` and `dispatchFailed` (or push the failed org slug into `errors`) so the response fully accounts for every org: `orgs === sent + skippedNoSink + skippedNoData + dispatchFailed + errors.length`.

## 5. Org regression thresholds accept 1..100 but the digest never applies them, and credit-line threshold double-reads can disagree
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: config plumbing / edge case
- **File**: src/app/api/org/alerts/route.ts:30-35,117-124; src/app/api/cron/digest/route.ts:92-93
- **Scenario**: (a) Admins set per-org `overallDrop`/`dimensionDrop` (route validates 1..100, persists via `setOrgAlertThresholds`). Those thresholds gate **per-repo regression alerts** (`scan-alerts.ts:63-67`) but the **digest's** `regressers` list (`getOrgMovers`, org-insights.ts:135) filters purely on `dOverall < 0` with no threshold — so a noise-level −1 shows in the digest as a "Regression" even when the org raised `overallDrop` to 20 to suppress exactly that. The configured sensitivity silently doesn't apply to the digest. (b) `creditsRemaining` reads `creditsAlertThreshold()` (alerts.ts:225-230, env-driven, can change between reads) once for the digest's `<= threshold*2` gate while `maybeAlertLowCredits` reads it again elsewhere — two evaluations of a mutable env value that should be read once per request.
- **Root cause**: Threshold configuration was wired into the per-repo regression path only; the digest's mover lists were never threshold-aware. The credit threshold is a per-call env read rather than a hoisted constant.
- **Impact**: Orgs that tune down alert noise still get noisy "Regressions:" lines in the weekly digest, making the threshold control look broken. The credit double-read is benign today but is a latent inconsistency if the env is ever changed mid-process or the function gains side effects.
- **Fix sketch**: Pass the org's resolved `overallDrop` into the digest and filter `regressers`/`gainers` by `Math.abs(dOverall) >= threshold` (or document that the digest is intentionally threshold-agnostic). Hoist `creditsAlertThreshold()` to a single `const` at the top of the digest handler.

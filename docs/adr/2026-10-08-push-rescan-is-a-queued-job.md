# A push rescan is a queued job, gated on the cadence

- **Status:** Accepted (2026-10-08, the day the last commit below landed)
- **Date:** 2026-10-08
- **Deciders:** App Master `ascent`, through the lite council's round 1 on `push-triggered-rescan`
  (2026-10-07, head `a2290a24`) and its rework. **No source this author could read shows an operator
  ruling on it.** The evidence is the commit messages, the code at this head, and the full council's
  round 1 (2026-10-09, head `5ebf9f60`). One question stays with the operator: the BYOM row under
  Consequences.

## Constraint

A default-branch push to a watched repo rescanned the repo inside the webhook's `after()`, which runs
under `maxDuration = 300` (`src/app/api/app/webhook/route.ts`). The lite council's round 1
(`.claude/master/ascent/headless/council/2026-10-07-push-triggered-rescan-lite-r1/report.md`) found two
defects on that path:

- **robustness-1: a paid rescan ran unbounded inside a 300 s budget, and a kill kept the credit and left
  no trace.** The old route reserved the credit, then called `scanRepository` with no deadline or signal.
  A platform kill skipped the catch: no refund, no persisted scan, no outcome row. The delivery stayed
  claimed for 24 h, so the next push repeated it. The code itself puts a median scan near 6 minutes.
- **value-1: "no autoscan" did not stop paid push rescans.** The push lane gated only on `watched`. The
  scheduled lane honoured `scanSchedule != off`, which the UI labels "no autoscan". Nothing told the user
  that a push buys a scan.

The same pass named the structural cause: the reserve, scan, refund and outcome loop was re-implemented
inline in a webhook, when the durable `ScanJob` queue already had a deadline, a lease reaper and outcome
writes.

## Decision

**A push rescan is a `webhook:push` job on the `ScanJob` queue, enqueued only for a repo on an autoscan
cadence. The webhook enqueues it and drains exactly that job; the queue worker owns the money.**

1. **The gate is `watched` AND `scanSchedule != off`.** `isRepoAutoscanned` returns
   `Boolean(repo?.watched) && repo?.scanSchedule !== "off"` (`src/lib/db/org-watch.ts:109-118`;
   `059ba4b7`). The route runs it first, before the owner confirm, so a repo off the cadence is a
   deterministic no-op (`src/app/api/app/webhook/route.ts:521-524`).
2. **The rescan runs on the installation org's engine.** The inline path called `scanRepository` with no
   `orgSlug`, so a BYOM org's pushed private repos were assessed by the platform provider
   (`c0bbfd85`). The worker passes `orgSlug: slug` to the scan (`src/lib/scan-queue-worker.ts:353`).
3. **One job per repo per aligned window.** `enqueueAndDrainPushRescan` enqueues a `rescore` job with
   reason `webhook:push` and drains that job alone, concurrency 1 (`src/lib/push-rescan.ts`; `379b9da0`,
   `93ccd721`). Its bucket is `push:${floor(now / window)}` (`pushRescanBucket`); the window is
   `PUSH_RESCAN_MIN_INTERVAL_MINUTES`, default 15, and `0` turns the throttle off (the bucket is then the
   delivery id). A row that exists, settled or not, buys nothing more, so the window closes on any outcome,
   not only on a persisted scan. The job row is the durable record: a killed or failed drain is reaped and
   retried on the queue with its credit carried, so the delivery is not released once a row exists
   (`push-rescan.ts`, doc on `enqueueAndDrainPushRescan`).
4. **A repo whose last attempt failed backs off for 6 hours.** The worker's push branch reads the last
   attempt before it reserves anything and settles the job `skipped` ("failure backoff") inside the
   window, writing no outcome row, because one would refresh `lastScanAttemptAt` and extend the backoff
   forever (`src/lib/scan-queue-worker.ts:261-275`; `FAILED_RESCAN_BACKOFF_MS = 6 * 60 * 60_000`,
   `src/lib/db/org-watch.ts:503`; `19c9eb77`). A provider that degraded to the deterministic floor is
   recorded as a failed outcome on purpose, so the backoff covers an outage instead of every push in it
   (`PUSH_DEGRADED_ERROR`, `scan-queue-worker.ts:40`). A push job never moves the repo's cadence.
5. **The user is told.** `PUSH_RESCAN_DISCLOSURE` says an autoscan cadence also rescans on push, that each
   is a metered scan (allowance first, then one prepaid credit; free on self-hosted), and that "no
   autoscan" stops push rescans too (`src/lib/org/repo-schedule.ts:31-34`; `fc0ba33b`). The feature docs
   were updated in `ec41e84e`.

## Alternatives that lost

- **Keep the inline `after()` rescan and add a deadline and a refund-on-kill.** The smallest diff. It lost
  because a kill is exactly the case where no code of ours runs: a refund path that has to execute after
  the platform kills the process cannot be relied on. The queue's lease reaper runs from outside the
  killed process, and its row survives the kill.
- **Gate on `watched` alone and fix the cost with the env throttle.** The throttle existed
  (`PUSH_RESCAN_MIN_INTERVAL_MINUTES`) and caps spend per repo. It lost because it is a deployment-wide
  environment setting the user cannot see or change, so it cannot be the control that "no autoscan"
  promises. The cadence is the per-repo control the UI already has.
- **A separate per-repo "rescan on push" switch.** The most honest control, one setting for one behaviour.
  It lost because it adds a second schedule vocabulary next to the cadence (`scheduleLabel` exists
  precisely because two controls once read as two vocabularies, `src/lib/org/repo-schedule.ts:36-39`),
  and it needs a default that either spends money nobody asked for or leaves the feature off. Reusing the
  cadence makes "autoscan on" mean what a user expects. It remains the way out if the coupling proves
  wrong.
- **Throttle by the last persisted scan instead of an aligned bucket.** This is what the inline path did.
  It lost because a failed or degraded rescan never persisted a row, so it never closed the window, and
  two instances could each buy inference for the same burst (`src/lib/push-rescan.ts` header). A bucket in
  the queue's idempotency key is cross-instance by construction.
- **Debounce: score the trailing head of a burst.** The best answer for a merge train. It lost for now
  because it needs a delayed job, a second cost-bearing trigger and a rule for the credit when a
  deferred job is refunded (full round 1, economics-3). It is the accepted cost under value-1 below.

## Consequences

Each was read in the full council's round 1
(`.claude/master/ascent/headless/council/2026-10-09-push-triggered-rescan-r1/report.md`) and checked in
the code at this head.

- **value-1: inside a window, a burst's trailing head is not scored.** The first push of an aligned window
  creates the job and the drain scores HEAD at that moment. Later pushes find the same bucket and buy
  nothing (`push-rescan.ts`, `pushRescanBucket`). Until the next window opens or the cadence runs, the
  score describes an earlier head.
- **value-2: a job that loses its claim or is killed waits for the daily drain.** A job whose repo another
  job is scanning yields at the claim and is requeued behind that lease; a killed drain is reaped. In
  both cases "the next rescore drain (the 06:00 cron)" runs it (`push-rescan.ts`, doc on
  `enqueueAndDrainPushRescan`). The push-to-score lag the feature exists for is therefore bounded only by
  the cron's day.
- **economics-1: spend is bounded per repo, not per org.** The window caps one repo at 4 scans an hour at
  the default (`push-rescan.ts`, `DEFAULT_PUSH_RESCAN_MIN_INTERVAL_MINUTES`). Nothing in
  `push-rescan.ts` or the worker's push branch bounds the sum across an org's repos, so an org with
  many autoscanned repos can spend in proportion to its pushes.
- **The cadence now buys two things.** An org that sets a repo to weekly also accepts push-driven spend on
  it. The disclosure says so; a user who wants weekly only must pick "no autoscan" and lose push rescans.
- **A redelivery is deduped by bucket, not by delivery.** A redelivery inside a window finds the row and
  buys nothing; one in the next window enqueues again.

### OPEN: a push rescan charges a BYOM org a credit; the worker's other job reasons do not

This ADR decides neither side. The worker meters a push job with `isMeteredScan(slug, false)`, which does
not exempt a BYOM org; every other job reason is metered by `slug.toLowerCase() !== "public" &&
!importPolicy?.mock && !(await ctx.isByom(slug))`, which does (`src/lib/scan-queue-worker.ts:292-297`).
The code comment calls unifying the two "a pricing decision, not this one". The full council's round 1
filed it as economics-4, craft-8 and value-6, and the disclosure above does not mention it. **The
question is with the operator:** should a BYOM org, which pays its own inference, be charged a credit
for a push rescan?

# A push rescan does not charge a BYOM org

- **Status:** Accepted (2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** The operator, through ask dd7fdbfc on 2026-10-09 ("Exempt BYOM on push too"). Recorded
  by App Master `ascent`. Settles the OPEN item in
  [2026-10-08-push-rescan-is-a-queued-job](2026-10-08-push-rescan-is-a-queued-job.md).

## Constraint

A BYOM org pays for its own inference. Since `c0bbfd85` a push rescan runs on the installation org's
own engine (the worker passes `orgSlug` to the scan), so the platform buys no inference for it. Yet the
queue worker metered a `webhook:push` job with `isMeteredScan(slug, false)`, which does not exempt BYOM,
while every other job reason used `slug.toLowerCase() !== "public" && !importPolicy?.mock &&
!(await ctx.isByom(slug))`, which does. A BYOM org was therefore charged a credit for a scan it also
paid the model provider for, and only on this path.

## Decision

**A push job is metered only when `isMeteredScan(slug, false)` is true and the org is not BYOM.**
Self-hosted, DB-less and the public org stay exempt through `isMeteredScan`. `ctx.isByom` keeps its
failure behavior: a failed probe degrades to `false` through `degradedRead`, so the job stays metered.
The reserve, refund and `creditCharged` carry are untouched. `PUSH_RESCAN_DISCLOSURE` gains one
sentence saying a BYOM org is not charged for push rescans.

## Alternatives that lost

- **Charge a BYOM org on every path.** One rule, and it earns on the platform's queue, scheduling and
  storage. It lost because the cadence, manual and import paths already exempt BYOM, and the ruling
  that BYOM bills inference to the org is the premise of the plan. Reversing it everywhere is a pricing
  change far larger than this item.
- **Keep the difference and disclose it.** Cheapest: add one sentence saying a BYOM org is charged on
  push. It lost because it documents an inconsistency nobody can justify; the user pays twice for one
  scan and only on the path they did not choose.
- **A reduced per-push platform fee for BYOM.** A reasonable middle: the platform's cost is not zero.
  It lost because it needs a second price in the ledger, a new disclosure and a refund rule for a
  fractional charge, to recover a cost the code does not measure.

## Consequences

- For a BYOM org, push spend is bounded by the per-repo window bucket and the 6 h failure backoff, not
  by credits. A zero-credit BYOM org keeps rescanning on push.
- The platform earns nothing on a BYOM push.
- A failed BYOM probe still meters the job, so a database blip never gives a free scan to a non-BYOM org.

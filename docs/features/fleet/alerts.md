# Regression alerts

When a tracked repo is re-scanned and its maturity **drops**, Ascent records the regression
and (if a webhook sink is configured) posts an alert. Detection is a pure, unit-tested
function over a scan diff; delivery is a separate integration layer that never lets an
alerting failure break the scan.

## Detection (`src/lib/alerts.ts`)

`detectRegression(diff, thresholds)` → `RegressionVerdict { regressed, severity, reasons[] }`
where `severity` ∈ `critical | warning | null`:

| Severity | Triggers |
| --- | --- |
| **critical** | A level demotion (e.g. L4 → L3); sliding **into** the "ungoverned" posture — gated on `postureTransition` (below), not on a bare label change. |
| **warning** | Overall score drop ≥ 5 (configurable `thresholds.overallDrop`); any single-dimension drop ≥ 15 (configurable). |

**Posture-transition hysteresis.** The quadrant cuts at exactly 50 per axis, so a repo hovering at
49/51 flipped its label on a re-scan of an unchanged commit and fired the *critical* ungoverned alert
on pure wobble. `postureTransition` (`src/lib/maturity/noise.ts`) now gates it: a crossing is news only
once an axis is clear of the corridor — **enter at ≥52, leave at <48**. The classification itself is
untouched (`postureFor` stays pure), so nothing re-labels; only the announcement is damped.

`detectPromotion(diff)` → `PromotionVerdict { promoted, severity: "celebration" | null, reasons[] }`
is the sibling condition in the same module: an **upward** band crossing (L3 → L4). It is a
separate verdict on purpose — `RegressionVerdict.regressed` gates the `scan.regression` audit
row and the regression memory, so a celebration must never set it. `buildPromotionMessage`
renders the celebratory voice (🎉 "leveled up", "What got you here:" attributions, no alarm
chrome).

`buildRegressionMessage(repo, diff, verdict)` formats a Slack-compatible message (emoji
headline 🔻/⚠️, reason bullets, top-3 movement attributions from `diff.movements`, report
link). `dispatchAlert(message, opts)` POSTs to the **resolved sink** — `resolveAlertWebhook`
picks the org's own `Organization.alertWebhookUrl` when set, else the global
`ALERT_WEBHOOK_URL` — so one tenant's fleet intelligence never lands in another's channel.
It never throws and returns `false` when no sink resolves or the POST fails.
`isAlertConfigured(orgWebhookUrl?)` checks for the sink. Per-org sinks and per-org
sensitivity (`alertOverallDrop` / `alertDimensionDrop`) are configured through
`GET`/`POST /api/org/alerts` (admin-gated) and the dashboard's Alerts popover
(`src/components/org/shared/AlertsControl.tsx`).

## Integration (`src/lib/scan-alerts.ts`)

`checkAndAlertRegression(prev, fresh, opts)`:

1. Diff the prior persisted report vs the freshly computed one (`diffScans`, see
   [report.md](../reporting/report.md)).
2. Detect a regression and record a `scan.regression` audit entry **even without a webhook
   sink**.
3. If a sink is configured, claim the per-repo cooldown and dispatch the message.
4. **If it did not regress**, check `detectPromotion`: an upward band crossing dispatches the
   celebratory message through the same sink and the same claim pool (a promotion *consumes*
   the window, so a repo flapping across a band edge can't alternate 🎉/🔻 every scan). No
   audit row — the level change is already recorded to Shared Org Memory, both directions.
5. Return `{ regressed, verdict, dispatched, promoted? }`. Never throws.

It's called from **three** fire sites, all *after* a new scan is persisted (capturing the prior
report before persist, diffing after): the [rescan cron](./rescan.md), the
[push webhook](../github/github-app.md), and — since the shared finalize layer was wired
(`cacheAndPersistScan` in `src/lib/scan-finalize.ts`) — every **interactive** scan through
`/api/scan` and `/api/scan/stream`, on a newly written row. All three share the per-repo
cooldown claim, so an interactive rescan can't double-alert with the cron.

## Key files

| File | Role |
| --- | --- |
| `src/lib/alerts.ts` | Pure detector + Slack message builder (regression, promotion, **fleet digest** `buildFleetDigestMessage`) + webhook dispatch + `digestHasSignal`/`creditsAlertThreshold`. |
| `src/lib/alerts.test.ts` | Threshold + verdict + message tests. |
| `src/lib/scan-alerts.ts` | Glue: diff prior vs fresh, audit, dispatch. |
| `src/app/api/cron/digest/route.ts` | Weekly fleet digest cron handler. |

## What moved since you last looked (in-app unread state)

The dashboard's Alerts chip carries a movement count. It is a **read** over records the scan
pipeline already persists (Shared Org Memory — regressions, level changes, closed gaps), not a
new event system:

- **Watermark** — `Membership.alertsSeenAt` (nullable, per-user-per-org). Never opened it? The
  window falls back to the member's join date. Advanced by `POST /api/org/alerts { seen: true }`
  when the popover opens.
- **Count** — `getOrgMovementSince(orgSlug, since)` (`src/lib/db/org-movement.ts`): ONE bounded
  `OrgMemory` query with `take: MOVEMENT_CAP + 1`, so ">9" costs no second query. Hidden at zero.
- **Degrades** — auth-off deployments, the public org, a viewer with no membership, or any read
  failure answer `{ movement: null }` and the chip renders exactly as it did before.

## Weekly fleet digest (`GET /api/cron/digest`)

Where regression/promotion alerts fire per-repo on a slide, the digest is the **positive
periodic push** — a leader relies on it instead of opening the app, so a flat week stays
silent rather than training the inbox filter.

- **What it summarizes** — for each org with watched repos: the past-week fleet rollup
  (`getOrgRollup(org, win)` — avg overall, level, scanned/repo counts, overall delta vs the
  week's start), the **top movers** (`getOrgMovers`, up to 3 gainers + 3 regressers,
  noise-filtered via `isWithinNoise` so within-jitter moves never appear under
  "Regressions:"), the **highest-leverage gap** (`getOrgRecommendations(org, 1)`'s top
  result — title + affected repo count), the corpus percentile (`getOrgBenchmark`), a
  one-line forecast trajectory (`forecastHeadline`), and — for metered, non-public orgs
  running low — the remaining credit balance. The week is derived from the shared
  `weekRangeParams()`/`resolveWindow()` period helper (a custom range snapped to local
  calendar days) so the digest's window matches the linked executive briefing
  (`?range=custom&from=&to=`) exactly.
- **Movement gate** — `digestHasSignal()` (`src/lib/alerts.ts`) decides whether the week is
  worth sending at all: a level change, a beyond-noise regression, a beyond-noise gainer, a
  non-zero overall delta, or a low credit balance. An org with none of those is skipped
  (`skippedFlat`).
- **Schedule/trigger** — invoked by Vercel Cron (see `vercel.json`) hitting
  `GET /api/cron/digest` (`src/app/api/cron/digest/route.ts`), `runtime: "nodejs"`,
  `maxDuration: 300`. Orgs are processed with bounded concurrency (`mapPool`, concurrency 4)
  and a soft deadline (270s) — past it, remaining orgs are counted as `remaining` instead of
  silently dropped when the platform kills the function.
- **`CRON_SECRET` auth** — fails closed: a missing/empty `CRON_SECRET` 503s rather than
  running unauthenticated. The secret must be presented as an `Authorization: Bearer <secret>`
  header (never a `?key=` query param, which routinely lands in access/CDN/proxy logs and
  Referer headers) and is compared with a constant-time `timingSafeEqual` (length-mismatch
  short-circuits without calling it, since `timingSafeEqual` throws on unequal-length
  buffers).
- **At-most-once per window** — an atomic conditional-insert claim (`claimOrgAuditOnce` /
  `releaseAuditClaim`, `src/lib/db/scans-audit.ts`) against the `org.digest.sent` audit
  action guards against double-sends from a platform retry or an overlapping schedule fire;
  a failed dispatch releases the claim so the next run retries.
- **Block-Kit message shape** — `buildFleetDigestMessage(input)` (`src/lib/alerts.ts`,
  pure) builds the same `AlertMessage { text, blocks }` shape as the regression/promotion
  builders: a headline (`📊 Ascent weekly digest: <org>`), a summary line (fleet maturity,
  level, delta, scanned/repo counts, percentile), an optional trajectory line, a "Top
  gainers"/"Regressions" block, a "Highest-leverage gap" block, an optional "Credits
  remaining" line, and a link to the org's executive briefing (carrying the same
  `?range=custom&from=&to=` window).
- **Shares webhook resolution with interactive alerts** — the digest resolves its sink
  through the exact same path as regression/promotion delivery: `getOrgAlertWebhook(org)` →
  the org's own `Organization.alertWebhookUrl` → falls back to the global
  `ALERT_WEBHOOK_URL` via `resolveAlertWebhook`/`isAlertConfigured`, and dispatches with the
  same `dispatchAlert()`. Orgs with no resolvable sink are skipped before any rollup work
  (`skippedNoSink`), so a deployment with neither configured is a clean no-op. A lookup
  *failure* (vs. a genuine unset column) is intentionally NOT treated as "no sink" — it
  propagates to the per-org error handler so a transient DB error can't misroute one
  tenant's fleet digest to the operator's global channel.
- **Deliberately separate noise policy** — the digest's gainers/regressers lists are gated
  by the global `isWithinNoise` band, not by the org's configured "Regression sensitivity"
  thresholds (`alertOverallDrop`/`alertDimensionDrop`, which tune only the per-repo
  `scan-alerts.ts` path). This keeps the digest's "beyond measurement jitter" semantics
  comparable across orgs rather than something each org tunes.

## Scan-completion email (a separate path)

The per-scan "email me when it's done" opt-in is **not** the alert layer — it goes through
`src/lib/email` (`dispatchScanCompletionEmail`). When no provider is wired
(`SES_FROM_EMAIL` unset, or `EMAIL_PROVIDER=noop`) the no-op sender returns
`{ ok: true, skipped: true }` and **nothing is sent**. `/api/scan/stream` emits a `notify`
SSE frame *before* the `result` frame with `status: "sending" | "unconfigured"` (derived from
`emailSendingEnabled()`), and logs the skip — so an unconfigured deploy says so instead of
implying a send.

## Known gaps

- **Slack-only delivery** — regression/digest/low-credit alerts POST to a webhook sink; there
  is still no email or in-app routing for them (per-org *sink* routing does exist).
- **Promotions are band-crossings only** — a large in-band gain (46 → 60, still L3) is not
  pushed; only a level crossing is.

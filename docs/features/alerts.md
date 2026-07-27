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
| **critical** | A level demotion (e.g. L4 → L3); sliding **into** the "ungoverned" posture. |
| **warning** | Overall score drop ≥ 5 (configurable `thresholds.overallDrop`); any single-dimension drop ≥ 15 (configurable). |

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
   [report.md](report.md)).
2. Detect a regression and record a `scan.regression` audit entry **even without a webhook
   sink**.
3. If a sink is configured, claim the per-repo cooldown and dispatch the message.
4. **If it did not regress**, check `detectPromotion`: an upward band crossing dispatches the
   celebratory message through the same sink and the same claim pool (a promotion *consumes*
   the window, so a repo flapping across a band edge can't alternate 🎉/🔻 every scan). No
   audit row — the level change is already recorded to Shared Org Memory, both directions.
5. Return `{ regressed, verdict, dispatched, promoted? }`. Never throws.

It's called from **three** fire sites, all *after* a new scan is persisted (capturing the prior
report before persist, diffing after): the [rescan cron](cron-and-retention.md), the
[push webhook](github-app.md), and — since the shared finalize layer was wired
(`cacheAndPersistScan` in `src/lib/scan-finalize.ts`) — every **interactive** scan through
`/api/scan` and `/api/scan/stream`, on a newly written row. All three share the per-repo
cooldown claim, so an interactive rescan can't double-alert with the cron.

## Key files

| File | Role |
| --- | --- |
| `src/lib/alerts.ts` | Pure detector + Slack message builder + webhook dispatch. |
| `src/lib/alerts.test.ts` | Threshold + verdict + message tests. |
| `src/lib/scan-alerts.ts` | Glue: diff prior vs fresh, audit, dispatch. |

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

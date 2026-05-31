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

`buildRegressionMessage(repo, diff, verdict)` formats a Slack-compatible message (emoji
headline 🔻/⚠️, reason bullets, top-3 movement attributions from `diff.movements`, report
link). `dispatchAlert(message, opts)` POSTs to `ALERT_WEBHOOK_URL` (Slack incoming
webhook); it never throws and returns `false` when the sink is unset or the POST fails.
`isAlertConfigured()` checks for the sink.

## Integration (`src/lib/scan-alerts.ts`)

`checkAndAlertRegression(prev, fresh, opts)`:

1. Diff the prior persisted report vs the freshly computed one (`diffScans`, see
   [report.md](report.md)).
2. Detect a regression and record a `scan.regression` audit entry **even without a webhook
   sink**.
3. If a sink is configured, build and dispatch the message.
4. Return `{ regressed, verdict, dispatched }`. Never throws.

It's called by the [rescan cron](cron-and-retention.md) and the [push webhook](github-app.md)
*after* a new scan is persisted (capturing the prior report before persist, diffing after).

## Key files

| File | Role |
| --- | --- |
| `src/lib/alerts.ts` | Pure detector + Slack message builder + webhook dispatch. |
| `src/lib/alerts.test.ts` | Threshold + verdict + message tests. |
| `src/lib/scan-alerts.ts` | Glue: diff prior vs fresh, audit, dispatch. |

## Known gaps

- **Slack-only delivery** — a single `ALERT_WEBHOOK_URL` sink; no email/in-app routing or
  per-org sink configuration.
- **Only on tracked re-scans** — alerts fire on cron/webhook re-scans of watched repos, not
  on ad-hoc one-off scans.

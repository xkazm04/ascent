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
| `src/app/api/cron/digest/extra-alerts.ts` | Goal-at-risk + spend-anomaly pushes that ride the weekly run. |
| `src/lib/email/alert-sink.ts` | Renders an `AlertMessage` as mail for a `mailto:` sink. |
| `src/lib/email/unsubscribe.ts`, `src/app/api/email/unsubscribe/route.ts` | Signed one-click unsubscribe (clears the org's sink). |

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
- **`CRON_SECRET` auth** — via the shared `requireCronAuth` gate (`src/lib/cron-auth.ts`),
  which this route hand-rolled until G8-48 promoted the strict contract into the helper. Fails
  closed: a missing/empty `CRON_SECRET` 503s rather than running unauthenticated. The secret
  must be presented as an `Authorization: Bearer <secret>` header (never a `?key=` query param,
  which routinely lands in access/CDN/proxy logs and Referer headers — accepted only behind the
  temporary `CRON_ALLOW_QUERY_KEY=1` deprecation hatch, which warns on every use) and is
  compared with a constant-time `timingSafeEqual` (length-mismatch short-circuits without
  calling it, since `timingSafeEqual` throws on unequal-length buffers).
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
  `?range=custom&from=&to=` window). A `null` `overallDelta` (no baseline exists for the
  window at all — a freshly-onboarded org, or a fleet whose entire scan history is younger
  than the window boundary) renders as an explicit "not enough history yet for a
  week-over-week comparison" clause, never a silently-dropped delta — an empty string there
  used to be indistinguishable from "the fleet held exactly flat."
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

## Email transport (`src/lib/email`)

Every message Ascent sends — scan completions, org invites, `mailto:` alert sinks, Custom-plan
enquiries — leaves through **one** selection point, `getEmailSender()`, so "email is off on this deploy"
is a single unambiguous fact (`emailSendingEnabled()`).

| `EMAIL_PROVIDER` | Sender |
| --- | --- |
| `auto` (default) | SES when `SES_FROM_EMAIL` is set, else Resend when `RESEND_API_KEY` is set, else the logging no-op |
| `ses` | `SesEmailSender` (lazy-imports the AWS SDK; credentials from the standard chain) |
| `resend` | `ResendEmailSender` (one `fetch` POST to `api.resend.com` — no npm dependency) |
| `noop` | Never sends, reports `{ ok: true, skipped: true }` |

SES wins over Resend under `auto` **deliberately**: adding a second provider must not silently re-route a
deployment that already had one. Choose the other order explicitly with `EMAIL_PROVIDER=resend`.

Selecting a provider whose credential is missing is a **broken deploy** — `ok: false`, logged — never the
`skipped` no-op, which means "no provider is wired here, nothing was attempted".

**Resend sender identity.** Resend refuses any `from` on an unverified domain. `RESEND_FROM_EMAIL`
defaults to Resend's shared sandbox identity (`Ascent <onboarding@resend.dev>`), which needs no
verification but **only delivers to the Resend account owner's own address**. That fits a single operator
inbox (the Custom-plan enquiry) and nothing else; verify a domain and set `RESEND_FROM_EMAIL` before
pointing user-facing mail at it.

`EmailMessage.replyTo` (honored by both real senders — SES `ReplyToAddresses`, Resend `reply_to`) exists
for mail that carries someone *else's* message: a Custom-plan enquiry lands in the operator's inbox and
Reply must reach the prospect. Pass it via `dispatchBuiltEmail(to, built, { replyTo })`.

## Scan-completion email (a separate path)

The per-scan "email me when it's done" opt-in is **not** the alert layer — it goes through
`src/lib/email` (`dispatchScanCompletionEmail`). When no provider is wired
(`SES_FROM_EMAIL` unset, or `EMAIL_PROVIDER=noop`) the no-op sender returns
`{ ok: true, skipped: true }` and **nothing is sent**. `/api/scan/stream` emits a `notify`
SSE frame *before* the `result` frame with `status: "sending" | "unconfigured"` (derived from
`emailSendingEnabled()`), and logs the skip — so an unconfigured deploy says so instead of
implying a send.

## Email sinks (`mailto:` — G7-01)

The alert sink accepts **an email address as well as a webhook**, so an org whose leadership
doesn't live in Slack still receives regression, promotion, low-credit, digest, goal-at-risk and
spend-anomaly pushes. There is no second transport and no second recipient list.

- **How it is turned on** — an admin stores `mailto:someone@example.com` in the org's alert sink
  (`POST /api/org/alerts { webhookUrl: "mailto:…" }`, the same admin-gated field and the same
  deliberate act as pointing the sink at a Slack channel). `validateAlertWebhookUrl` accepts the
  `mailto:` scheme, requires a single well-formed address (no comma-separated fan-out), and
  normalizes the stored value. The global `ALERT_WEBHOOK_URL` may also be a `mailto:` for a
  single-tenant deployment.
- **Who receives it** — exactly the one configured address. Nothing is ever sent to org members,
  to a scan requester, or to any address the org did not store as its sink.
- **Off by default, three ways over** — no sink stored, no global `ALERT_WEBHOOK_URL`, and no
  email provider (`SES_FROM_EMAIL`) each independently make it a no-op. With no provider,
  `dispatchAlert` to a `mailto:` sink performs **no network I/O** and returns `false`, so the
  digest releases its window claim and retries later rather than recording a phantom send.
- **How it stops** — every alert mail states why it arrived and carries an unsubscribe link to
  `GET/POST /api/email/unsubscribe`, whose token is an HMAC over the org slug signed with
  `EMAIL_UNSUBSCRIBE_SECRET`. `GET` only renders a confirm form (mail clients and security
  gateways prefetch links); `POST` clears `Organization.alertWebhookUrl`. With no secret
  configured there is no one-click link at all — the footer names the settings page instead, and
  the route 503s (no unauthenticated mutation endpoint on a deploy that never mailed a token).
  Clearing the sink stops the webhook pushes too, because they are one setting; the mail says so.
- **Rendering** — `buildAlertEmail` (`src/lib/email/alert-sink.ts`, pure) uses each builder's
  existing plain-text fallback as the body, so a new alert builder gets an email rendering for
  free. Slack Block Kit is ignored on this path.

## Goal-at-risk and spend-anomaly pushes (G7-03)

Two trigger classes the layer could always compute and never pushed. Both ride the weekly digest
cron (`src/app/api/cron/digest/extra-alerts.ts`) and route through the org's own sink — so an org
with no sink gets no extra work and no extra push.

| Trigger | Condition | Recipient | Cadence |
| --- | --- | --- | --- |
| **Goal at risk** (`buildGoalAtRiskMessage`) | Any goal `listGoals` already marks `pace: "behind"` and not achieved. | The org's alert sink. | At most once per weekly window (`org.alert.goal-at-risk` claim). |
| **Spend anomaly** (`buildSpendAnomalyMessage`) | This week's billable scans ≥ `SPEND_ANOMALY_RATIO` × the trailing 3-week per-week average, with a floor of 10 scans so small fleets can't trip it. A spend *drop* never fires. | The org's alert sink. | At most once per weekly window (`org.alert.spend-anomaly` claim). |

They are dispatched **before** the digest's movement gate on purpose: a goal sliding off pace is
exactly the news a flat fleet week still needs to carry. Each takes its own at-most-once claim and
releases it on a failed delivery; the whole call is internally caught, so it can add to `errors`
but can never fail the digest that carries it. The run's response reports `goalAlerts` /
`spendAlerts`.

**Security alerts (dispatched 2026-08-14, from the scan pipeline as intended).**
`buildSecurityAlertMessage` fires from `checkAndAlertRegression`'s post-scan diff — the same-day
trigger this doc always named — when **D9 fell past the org's `dimensionDrop` line but the generic
regression push headlined a different dimension** (or only the overall drop). When D9 *is* the
headline, no second push fires: one slide must not ping twice. It takes its own cooldown key
(`<fullName>#security` in the shared claim pool) so the generic claim can't starve it.

## Alert history (`AlertEvent`)

Every dispatch decision is persisted to the **`AlertEvent`** table
(`src/lib/db/alert-events.ts`: `recordAlertEvent` / `listAlertEvents`) — deliberately NOT
`AuditLog`, whose claim rows are deleted on failed delivery (`releaseAuditClaim`) and purged by
`retentionAuditDays`. Rows are written **even when no sink is configured**
(`delivered=false, suppressedReason="no-sink"`), so a webhook-less org finally has a trace of what
it would have been told. Fields: kind (`regression | promotion | security | low-credits | digest |
goal-at-risk | spend-anomaly`), severity, repo, title, body, `delivered`, `sinkKind`
(`webhook | email`), `suppressedReason` (`no-sink | cooldown | dispatch-failed`). Writers:
`scan-alerts.ts` (regression / promotion / security / low-credits), the digest cron (digest), and
`extra-alerts.ts` (goal-at-risk / spend-anomaly). Test alerts are deliberately not recorded.

The history is surfaced in the Alerts popover ("Recent alerts", `AlertsHistory.tsx`, lazy-loaded
`<details>`) via `GET /api/org/alerts?org=…&history=1` — member-readable like movement (rows carry
titles and outcomes, never the sink URL).

## Environment variables

| Var | Default | Effect |
| --- | --- | --- |
| `ALERT_WEBHOOK_URL` | unset | Global fallback sink. May be an `https://` webhook **or** a `mailto:` address. |
| `SES_FROM_EMAIL` | unset | Verified SES sender; its presence selects SES under `auto`. |
| `RESEND_API_KEY` | unset | Resend API key; selects Resend under `auto` when SES is unconfigured. |
| `RESEND_FROM_EMAIL` | `Ascent <onboarding@resend.dev>` | Resend `from`. The default is Resend's shared sandbox identity — needs no domain verification but delivers **only to the Resend account owner**. |
| `EMAIL_PROVIDER` | `auto` | `auto` \| `ses` \| `resend` \| `noop`. With **neither** SES nor Resend configured, no email is ever sent (the no-op sender reports `skipped`). |
| `EMAIL_UNSUBSCRIBE_SECRET` | unset | HMAC key for one-click unsubscribe links. Unset ⇒ no link is minted and `/api/email/unsubscribe` 503s. |
| `EMAIL_INVITES` | on | Set to `off` to refuse invite mail on a deploy that has SES wired for other mail. |
| `SPEND_ANOMALY_RATIO` | `2` | Multiple of the trailing average that trips the spend alert. Blank/invalid → 2, never 0. |
| `REGRESSION_COOLDOWN_MINUTES` | `360` | Per-repo regression/promotion alert cooldown. |
| `CREDITS_ALERT_THRESHOLD` | `5` | Low-water mark for credit alerts. |

## Known gaps

- **Promotions are band-crossings only** — a large in-band gain (46 → 60, still L3) is not
  pushed; only a level crossing is.
- (Closed 2026-08-14.) ~~No in-app alert history~~ — the `AlertEvent` table + the popover's
  "Recent alerts" section persist every dispatch decision with its outcome (see above). Still open
  within it: no acknowledgement state on individual rows.
- **Per-org digest frequency/sections are not configurable** — the cadence is the weekly cron plus
  the movement gate; per-org preference fields would also need a migration.
- (Closed 2026-08-14.) ~~Security alerts are built but not dispatched~~ — dispatched from the
  scan pipeline's post-scan diff (see above).

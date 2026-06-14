# Feature Scout — Fleet Alerts & Digests (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. No in-app UI to configure or test the alert webhook
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/api/org/alerts/route.ts:20 (GET/POST endpoint with no caller)
- **Scenario**: An admin enables Slack alerts for their fleet. They open the org dashboard expecting a "Notifications" or "Alerts" settings panel where they paste an incoming-webhook URL and confirm it works — exactly how they set up credits today.
- **Gap**: The full backend exists — `GET/POST /api/org/alerts`, `validateAlertWebhookUrl`, `setOrgAlertWebhook`, audit logging — but grep confirms NO frontend consumes it: `/api/org/alerts` and `setOrgAlertWebhook` are referenced only by the route itself and `db/index.ts`. There is `CreditsControl.tsx` for credits but no `AlertsControl`/settings tab. The entire alerting feature is therefore unreachable without manual SQL or curl — it's built-but-unexposed. There is also no "send test" path (POST only sets/clears; no preview/dispatch), so an admin can't tell whether their URL actually delivers until a real regression fires days later.
- **Impact**: Every self-serve customer. A shipped, tested, multi-tenant alert layer delivers zero value because no one can turn it on. This is the single highest-leverage gap: unlocking the existing backend activates regression alerts, low-credit pushes, AND the weekly digest at once.
- **Fix sketch**: Add an `AlertsControl.tsx` client component (mirror `CreditsControl.tsx`) on the org settings/plan surface: input bound to `GET/POST /api/org/alerts`, inline validation echo, "Clear" button, and a "Send test alert" button. For test-send, add `?test=1` to the POST route (or a tiny `/api/org/alerts/test`) that builds a sample `AlertMessage` and calls `dispatchAlert`. ~0.5 day (backend done).

## 2. Single webhook channel only — no email or native Slack/Teams delivery
- **Severity**: High
- **Category**: feature
- **File**: src/lib/alerts.ts:317 (`dispatchAlert` — one fetch to one URL)
- **Scenario**: A non-technical eng leader wants the weekly digest in their inbox; a security lead wants critical regressions in a Microsoft Teams channel. Neither runs Slack incoming-webhooks, and forwarding a raw webhook payload isn't an option.
- **Gap**: `dispatchAlert` POSTs a Slack-shaped `{text, blocks}` body to exactly one resolved URL. Grep for `email|nodemailer|resend|sendgrid|smtp` finds only false positives (codeowners/members) — there is NO email channel and no channel abstraction. `alertWebhookUrl` is a single column; the message builders already emit a plain-text `text` fallback that an email/Teams adapter could reuse, but nothing consumes it.
- **Impact**: Broadens reach beyond Slack-native teams (email is universal; Teams is huge in enterprise) — directly expands the addressable market for the org/fleet tier and lifts digest open rates (the habit-loop the digest is designed to create).
- **Fix sketch**: Introduce a `Channel` abstraction (`{ kind: "slack"|"email"|"teams", target }`) and an array of sinks per org. Add an email adapter (Resend/SES) that renders `message.text` (HTML from blocks optional). Keep `resolveAlertWebhook` for back-compat. Schema: a `NotificationChannel` model or a JSON column on Organization. ~2–3 days.

## 3. Regression thresholds are hardcoded — no per-org sensitivity config
- **Severity**: High
- **Category**: feature
- **File**: src/lib/alerts.ts:38 (`DEFAULT_THRESHOLDS`), src/lib/scan-alerts.ts:60 (`detectRegression(diff)` called with no thresholds)
- **Scenario**: A volatile early-stage fleet is spammed by 5-point overall-drop alerts and wants to raise the bar to 10; a tightly-governed enterprise wants to be paged on any single-dimension slip of 8+. Today both get the same fixed `{ overallDrop: 5, dimensionDrop: 15 }`.
- **Gap**: `detectRegression` accepts a `RegressionThresholds` argument, but grep shows `DEFAULT_THRESHOLDS` / `overallDrop` / `dimensionDrop` are referenced ONLY in `alerts.ts` and its test — `scan-alerts.ts` calls `detectRegression(diff)` with the default and never threads org config. There is no DB column, no env override, no UI. The tunability the function was clearly designed for is dead.
- **Impact**: Reduces alert fatigue (the top reason teams mute alerting entirely) and lets high-rigor customers tighten sensitivity — a retention and trust lever for the paid fleet tier.
- **Fix sketch**: Add `alertOverallDrop`/`alertDimensionDrop` (nullable Int) to Organization; load in `checkAndAlertRegression` and pass to `detectRegression`. Surface alongside the webhook in the alerts settings panel (finding #1). Also add a per-org "minimum severity to alert" toggle (critical-only vs critical+warning). ~1 day.

## 4. No alert history / acknowledgement surface
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/scan-alerts.ts:64 (`recordAudit("scan.regression", …)` is the only persistence)
- **Scenario**: A leader sees a Slack regression ping, is mid-meeting, and wants to come back later to a list of "what fired this week, what's still unresolved, who acknowledged it." They also want to confirm the depletion alert from last Tuesday actually went out.
- **Gap**: Regressions write a `scan.regression` audit entry (grep confirms it's read nowhere outside the writer), but low-credit alerts (`maybeAlertLowCredits`) and digest sends record NOTHING. There is no alerts inbox/timeline, no ack/resolve state, and no "did this dispatch succeed" log. The audit viewer exists (`AuditLogViewer.tsx`) but isn't an alert-centric, ack-able view.
- **Impact**: Turns fire-and-forget pings into an accountable workflow (incident-style triage) — a clear differentiator for the fleet/governance buyer and a natural anchor for the dashboard's "live intelligence" story.
- **Fix sketch**: Add an `Alert` model (orgId, repo?, kind, severity, message, dispatchedOk, ackBy?, ackAt?, createdAt). Persist on every dispatch in `scan-alerts.ts` + digest route. Add `/api/org/alerts/history` + an "Alerts" tab listing recent alerts with an Acknowledge button. ~2 days.

## 5. Digest is one-size-fits-all — no per-org schedule, frequency, or content toggles
- **Severity**: Medium
- **Category**: feature
- **File**: vercel.json (`/api/cron/digest` fixed `0 13 * * 1`), src/app/api/cron/digest/route.ts:48
- **Scenario**: A team in APAC wants the digest Friday morning their time; another wants it monthly, not weekly; an exec wants only the score + top gap, not the full mover list.
- **Gap**: The cron fires every org at the same fixed Monday 13:00 UTC. Grep for `digestDay|digestSchedule|digestFrequency|digestEnabled` finds nothing — there is no per-org cadence, send-day, timezone, or opt-out, and no content/section toggles. An org with a sink gets the weekly digest whether it wants it or not.
- **Impact**: Better-timed, opt-in digests lift engagement and avoid the "unsubscribe by ignoring" failure mode; monthly cadence suits smaller fleets. Modest scope, real polish on the product's core habit loop.
- **Fix sketch**: Add `digestFrequency` ("weekly"|"monthly"|"off"), `digestDay`, optional `digestTimezone` to Organization; have the cron filter orgs by whether today matches their cadence. Surface in the alerts settings panel. ~1–1.5 days.

## 6. No per-repo or per-segment alert routing/subscriptions
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/db/org-alerts.ts:11 (org-level webhook only), src/lib/scan-alerts.ts:77 (`orgWebhook(opts.orgSlug)`)
- **Scenario**: A large fleet owner wants payments-service regressions to ping the payments team's channel and platform repos to ping the platform channel — not every regression dumped into one org-wide firehose.
- **Gap**: Routing resolves a single org webhook (`getOrgAlertWebhook(orgSlug)`); there is no per-repo or per-segment override and no concept of a subscriber. The codebase already has `Segment`/`RepoSegment` models and `segmentScope` (used for schedule policy in `org-watch.ts`), so the grouping primitive exists — but alerts don't use it. Alerting is strictly all-or-nothing per tenant.
- **Impact**: Routes the right signal to the right team in larger orgs — a meaningful scaling feature for the enterprise tier where one channel for 200 repos is unusable noise.
- **Fix sketch**: Add an optional `alertWebhookUrl` (or channel ref) on `Segment` and/or `Repository`; in `orgWebhook`, resolve repo → segment → org → global. Reuse the existing `segmentScope` plumbing. Pairs naturally with finding #2's channel array. ~2 days.

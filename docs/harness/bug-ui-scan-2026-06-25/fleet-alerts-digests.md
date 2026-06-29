# Fleet Alerts & Digests — Bug + UI Scan
> Context: Fleet Alerts & Digests (Org Scanning & Fleet Rollups)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. "Send test" tests the stored/global sink, not the URL just typed
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/app/api/org/alerts/route.ts:64-66 · src/components/org/AlertsControl.tsx:101-104
- **Value**: impact 7 · effort 3 · risk 2
- **Scenario**: An admin opens the Alerts popover, types a brand-new Slack webhook into the field, and clicks "Send test" before clicking Save. `test()` POSTs only `{ org, test: true }`; the route's test branch then calls `getOrgAlertWebhook(body.org)` which reads the **previously stored** webhook (or, if none, falls back to the global `ALERT_WEBHOOK_URL`). If a global sink is configured, the test delivers there and the UI shows "Test alert delivered ✓" — so the admin believes the URL they just typed works. If there's no stored/global sink it says "No sink configured" even though they typed one. Either way the test verifies the wrong thing.
- **Root cause**: The test action was designed as "send to the org's resolved sink" but the popover's whole job is to validate a *candidate* URL the user is still editing; the in-form value is never threaded into the request.
- **Impact**: Success theater — the one button whose entire purpose is to confirm routing gives false confidence (or a false negative). A typo'd webhook ships "verified", and real regression/digest alerts then silently go nowhere.
- **Fix sketch**: Have `test()` send the current `webhookUrl` field; in the route's test branch, if a `webhookUrl` is present, run it through `validateAlertWebhookUrl` and dispatch to *that* URL instead of the stored one. Alternatively disable "Send test" until the form is saved and label it "Send test to saved sink".

## 2. Save button is disabled whenever the webhook field is blank, blocking threshold-only edits
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/components/org/AlertsControl.tsx:176 · src/app/api/org/alerts/route.ts:74-78,106-122
- **Value**: impact 6 · effort 2 · risk 1
- **Scenario**: An org relies on the deployment-wide `ALERT_WEBHOOK_URL` and never sets a per-org webhook (field stays blank). The admin wants to tighten regression sensitivity (e.g. overallDrop 5→3). The Save button is `disabled={busy !== null || !webhookUrl.trim()}`, so with a blank URL it is permanently disabled and the threshold change can never be persisted — even though the backend explicitly supports a thresholds-only update (`hasThresholds` without `hasWebhook`).
- **Root cause**: The disabled-guard conflates "is there a webhook to save" with "is there anything to save"; thresholds are second-class in the gate.
- **Impact**: Regression sensitivity is un-tunable through the UI for any org using the global sink — a backend capability with no reachable UI path.
- **Fix sketch**: Enable Save when the webhook OR a threshold field has a value/change; only require a non-empty URL when the user is actually setting (not clearing) a per-org webhook.

## 3. Weekly digest has no last-sent guard — cron retry/overlap resends to every org
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/app/api/cron/digest/route.ts:50-127 · src/lib/alerts.ts:50-52
- **Value**: impact 6 · effort 5 · risk 3
- **Scenario**: The handler loops all orgs sequentially, each doing several awaited DB rollups, under `maxDuration = 300`. With enough orgs it can time out partway (some orgs already dispatched), or Vercel can retry the invocation, or two schedules can overlap. There is no per-org `lastDigestAt` / idempotency key, so on the second run every already-notified org receives the weekly digest **again**. The code comment at alerts.ts:50-52 admits there's no stored last-sent timestamp.
- **Root cause**: "Adaptive cadence (notify on news)" was chosen to avoid storing state, but dispatch has no at-most-once protection against re-invocation.
- **Impact**: Duplicate weekly digests erode trust in the exact push channel the feature is built to make habit-forming; a leader who gets the same digest twice starts filtering it.
- **Fix sketch**: Stamp a per-org `lastDigestAt` (or an idempotency key per `(org, weekStart)`) and skip orgs already sent within the current window before dispatching.

## 4. Alert config popover (role="dialog") has no focus management or trap
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/org/AlertsControl.tsx:119-124,24-36
- **Value**: impact 5 · effort 4 · risk 2
- **Scenario**: Opening the chip renders an element with `role="dialog"` / `aria-label="Alert routing"`, but focus is never moved into it, the webhook input isn't auto-focused, and Tab is not trapped — so keyboard/screen-reader users get no announcement that a dialog opened and can Tab straight back into the page behind it. (Escape-to-close and outside-click-to-close are handled, which is good.)
- **Root cause**: The popover declares the dialog ARIA contract but implements only dismissal, not the focus half of that contract.
- **Impact**: Keyboard and assistive-tech users can't reliably reach or operate the alert settings; the dialog role overpromises.
- **Fix sketch**: On open, move focus to the first field (or the dialog container) and restore it to the trigger on close; constrain Tab within the popover while open (or use an existing dialog/popover primitive).

## 5. Digest "this week" is a rolling 7-day window, not the dashboard's period boundary
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/app/api/cron/digest/route.ts:51,99-120
- **Value**: impact 4 · effort 4 · risk 2
- **Scenario**: The window is hand-rolled as `{ start: new Date(Date.now() - 7*86_400_000), end: null }`, while the rest of the fleet uses canonical period helpers (src/lib/window.ts, src/lib/org/period.ts). The digest message labels deltas "this week" and links to `/org/<slug>/executive`, but the executive page may compute its period on calendar/period boundaries — so the "+N this week" a leader reads in Slack can disagree with the numbers they see after clicking through.
- **Root cause**: Two independent definitions of "the week" — the cron's rolling 168h vs the dashboard's period module.
- **Impact**: Mild but recurring confusion / perceived inaccuracy when the digest figure doesn't match the linked briefing.
- **Fix sketch**: Derive the digest window from the shared period helper so the push and the dashboard it links to agree on the same boundaries.

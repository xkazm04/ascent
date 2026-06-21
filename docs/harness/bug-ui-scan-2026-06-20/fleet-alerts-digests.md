> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

# Fleet Alerts & Digests — combined bug+ui scan

## 1. Digest movement-gate fires on pure-noise weeks (regressers not noise-filtered)
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: logic / false-positive notification
- **File**: src/app/api/cron/digest/route.ts:82
- **Scenario**: A week where the whole fleet only wobbled scan-to-scan: every repo moved within ±2 points (statistically indistinguishable from model jitter per `@/lib/maturity/noise`). A couple happen to land net-negative (e.g. dOverall −1, −2), so they fall into `movers.regressers` (which partitions purely on sign — see `org-insights.ts:buildMove` / its tests, no noise filter). The digest fires for that org.
- **Root cause**: `digestHasSignal` is meant to stay silent on noise so leaders don't filter out the push. The gate is applied asymmetrically: `gainersBeyondNoise` correctly filters with `!isWithinNoise(m.dOverall)`, but `regressions: movers?.regressers?.length ?? 0` counts *every* regresser, including within-noise ones. `digestHasSignal` returns true on `regressions > 0`, so a noise-only week still sends — and `buildFleetDigestMessage` then renders those −1/−2 repos under "Regressions:", training exactly the inbox-filter the gate was built to avoid.
- **Impact**: Recurring false-signal digests; the "send only on real news" contract is broken on the regression side. Erodes trust in the one push leaders rely on.
- **Fix sketch**: Mirror the gainers logic: `regressions: (movers?.regressers ?? []).filter((m) => !isWithinNoise(m.dOverall)).length`. Optionally also filter the `regressers` list passed to `buildFleetDigestMessage` so noise repos aren't rendered.

## 2. Digest dispatch has no fetch timeout and no abort signal — one hung webhook stalls the whole cron
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: reliability / resource exhaustion
- **File**: src/app/api/cron/digest/route.ts:111
- **Scenario**: One org configures a webhook host that accepts the TCP connection but never responds (slow/black-holed Slack-compatible sink). `dispatchAlert(msg, { webhookUrl })` is awaited inside the sequential per-org loop with no `signal` and `dispatchAlert`'s `fetch` has no timeout, so the request hangs. Every later org in the loop is blocked behind it; the route burns toward `maxDuration = 300` and is killed mid-fleet.
- **Root cause**: `dispatchAlert` already accepts `opts.signal` (the regression path threads one through), but the digest never supplies one, and there is no per-request deadline. The loop is serial, so a single slow tenant becomes a head-of-line block for all subsequent tenants.
- **Impact**: A single misbehaving tenant webhook silently denies the weekly digest to every org processed after it, with no error surfaced for the dropped ones.
- **Fix sketch**: Create an `AbortController` per dispatch with a `setTimeout(() => ctrl.abort(), ~10s)` and pass `signal: ctrl.signal`; clear the timer in a `finally`. (Optionally bound total work with `mapPool` instead of a serial loop.)

## 3. Failed digest dispatches are silently uncounted — no way to distinguish "no signal" from "webhook is 500ing"
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / observability
- **File**: src/app/api/cron/digest/route.ts:111
- **Scenario**: An org's webhook returns 500 (or the network throws). `dispatchAlert` catches it, logs, and returns `false`. The cron only does `if (await dispatchAlert(...)) sent += 1;` — a `false` increments nothing, is not added to `errors`, and is not counted in `skippedNoSink`/`skippedFlat`. The response `{ orgs, sent, skippedNoSink, skippedFlat, errors }` shows that org nowhere.
- **Root cause**: The boolean from `dispatchAlert` is treated as "sent or don't care"; the failed-delivery case (sink configured, message had signal, POST rejected) has no counter and the error was swallowed inside `dispatchAlert` rather than re-surfaced to the loop.
- **Impact**: Operators see `{ sent: 0 }` and cannot tell a genuinely flat fleet from a fleet whose alert sink is broken. Broken alerting stays invisible — the exact failure mode this layer exists to prevent.
- **Fix sketch**: Track `failed` (increment when `dispatchAlert` returns false after `isAlertConfigured` passed) and include it in the JSON; ideally have the digest catch/record the dispatch failure reason per org.

## 4. AlertsControl can't save threshold-only changes — Save is gated on a non-empty webhook
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: missing functionality / form gating
- **File**: src/components/org/AlertsControl.tsx:176
- **Scenario**: An admin runs a deployment-wide global `ALERT_WEBHOOK_URL` and just wants to tighten this org's regression sensitivity (e.g. overall drop 3 instead of 5) while leaving the per-org webhook blank to inherit the global sink. They edit the threshold fields and click Save — but Save is `disabled={busy !== null || !webhookUrl.trim()}`, so it is greyed out whenever the webhook box is empty.
- **Root cause**: The disabled rule assumes every save includes a webhook, but the backend explicitly supports a threshold-only POST (`hasThresholds` branch, independent of `hasWebhook`). The UI makes the supported operation unreachable, and `save()` always sends `overallDrop`/`dimensionDrop`, so the only way to change thresholds is to also (re)enter a webhook URL.
- **Impact**: Per-org regression sensitivity is unconfigurable via the UI for any org relying on the global sink — a built-but-unwired backend capability.
- **Fix sketch**: Enable Save when the webhook is non-empty OR a threshold field differs from its loaded value (e.g. `!webhookUrl.trim() && !thresholdsDirty`). Send only the fields that changed.

## 5. `creditsAlertThreshold()` of 0 disables the digest credit heads-up entirely (silent)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / config foot-gun
- **File**: src/app/api/cron/digest/route.ts:78
- **Scenario**: An operator sets `CREDITS_ALERT_THRESHOLD=0` (a deliberately-honored value per `creditsAlertThreshold` + its tests) intending "alert only at depletion". The digest's runway check is `credit.balance <= creditsAlertThreshold() * 2` → `balance <= 0`. A metered org sitting at balance 1–4 (about to brick its scheduled scans) is never flagged `creditLow`, so `digestHasSignal` gets no credit boost and the standing "Credits remaining" line is omitted right when it matters most.
- **Root cause**: The digest reuses the per-scan crossing threshold (whose 0 means "only fire at zero") as a *runway* multiplier; multiplying 0 by 2 collapses the early-warning band to nothing instead of falling back to a sane runway floor.
- **Impact**: Prepaid orgs lose the weekly low-balance heads-up precisely in the depletion window the feature targets — silent churn the digest was meant to prevent.
- **Fix sketch**: Use a dedicated non-zero runway floor for the digest, e.g. `const floor = Math.max(creditsAlertThreshold(), DEFAULT) * 2` or a separate constant, so a 0 crossing-threshold doesn't zero out the digest warning band.

## 6. `validateAlertWebhookUrl` blocks IPv4 private ranges but not IPv6 ULA/link-local literals
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: security / SSRF gap
- **File**: src/lib/alerts.ts:326
- **Scenario**: An admin (or a compromised admin token) stores `https://[fd00::1]/hook` or `https://[fe80::1]/hook` as the org webhook. The server then POSTs org fleet data to that address on every regression, low-credit crossing and weekly digest.
- **Root cause**: The private-host guard enumerates IPv4 literals (`127.`, `10.`, `192.168.`, `169.254.`, `172.16–31.`) and the single IPv6 loopback `[::1]`, but not IPv6 unique-local (`fc00::/7` → `fd…`) or link-local (`fe80::/10`) literals. The "validate outbound URLs built from caller input" rule the function documents is only half-applied to IPv6.
- **Impact**: An https IPv6 private/link-local literal passes validation and becomes an outbound POST target — a narrow SSRF-style data-exfil/internal-probe vector (admin-gated, hence Low).
- **Fix sketch**: Reject hostnames starting `[fc`, `[fd`, `[fe8`, `[fe9`, `[fea`, `[feb` (ULA + link-local), alongside the existing `[::1]` check.

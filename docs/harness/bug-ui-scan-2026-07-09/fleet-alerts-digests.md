# Fleet Alerts & Digests — bug-hunter + ui-perfectionist scan

> Context: Fleet Alerts & Digests (group: Org Scanning & Fleet Rollups)
> Files scanned: 6
> Total: 7 findings (Critical: 0, High: 1, Medium: 4, Low: 2)

## 1. Alert-config audit entries are unattributable under the ACTIVE auth wall
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dead-code-authz
- **File**: src/app/api/org/alerts/route.ts:97
- **Scenario**: A signed-in admin (Supabase login) sets/clears the org webhook or thresholds. The route records the audit entry with `actorId: session?.login` where `session = await getSession()` (lines 115-119, 134-138).
- **Root cause**: `getSession()` reads the DORMANT custom-OAuth session — `getSessionState()` returns `null` when `!isAuthConfigured()`, which is exactly the canonical Supabase deployment (custom OAuth off, `authGateEnabled()` on, as `requireOrgRole` itself documents). The active identity is `getViewer()`, never consulted here. So `session` is always null and `actorId` is always null.
- **Impact**: Every `org.alerts.webhook` / `org.alerts.thresholds` audit row in production has a blank actor — the "who changed the channel-posting secret" the SEC-#1 comment claims to capture is silently lost. Forensics/compliance gap on a security-sensitive mutation.
- **Fix sketch**: Source the actor from the active wall: `const viewer = await getViewer(); ... actorId: viewer?.login ?? session?.login`. Mirror `requireOrgRole`'s `authGateEnabled()` branch.

## 2. Cron secret is accepted as a `?key=` query param (leaks into logs)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: secret-exposure
- **File**: src/app/api/cron/digest/route.ts:60
- **Scenario**: `if (auth !== \`Bearer ${secret}\` && key !== secret)` — a caller may authenticate with `/api/cron/digest?key=<CRON_SECRET>` instead of the `Authorization` header. Vercel Cron only ever uses the header, so the query path is a pure add-on attack surface.
- **Root cause**: Assumption that a URL query param is a safe secret channel. Query strings are captured verbatim by Vercel/CDN access logs, upstream proxies, and `Referer` headers on any linked resource.
- **Impact**: If anyone triggers the digest with `?key=`, the cron secret — which authorizes pushing fleet data to external sinks — is written to durable logs. The `!==` compare is also non-constant-time (minor, network jitter dominates).
- **Fix sketch**: Drop the `key` query fallback; require `Authorization: Bearer`. If a query trigger is truly needed, compare with `crypto.timingSafeEqual` and document the exposure.

## 3. Digest at-most-once guard is check-then-act — overlap/crash duplicates or drops
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/app/api/cron/digest/route.ts:109
- **Scenario**: The guard reads `getAuditLog(... action: DIGEST_SENT_ACTION, since: windowStart)` (line 109), sends, then stamps `recordOrgAudit(DIGEST_SENT_ACTION...)` AFTER a 2xx (line 173). Two overlapping invocations (platform retry while a multi-minute run is still in flight, or a double-fired schedule) both read "not sent" before either stamps → both dispatch → duplicate digest to the same org. Separately, a crash between the successful POST (169) and the stamp (173) re-sends on the next run.
- **Root cause**: TOCTOU — the audit log is used as an idempotency key with no lock/unique constraint, so the read-then-write window is unguarded across concurrent handlers.
- **Impact**: The exact "make the push habit-forming, never cry twice" contract breaks under retry/overlap — duplicate emails erode trust. The comment concedes the crash-gap as at-least-once; the overlap case is undocumented.
- **Fix sketch**: Stamp BEFORE dispatch (accept at-most-once) or add a unique `(orgId, action, weekStart)` row inserted transactionally; treat a duplicate-key as "already sent" and skip.

## 4. Regression alerts have no cooldown — a flapping repo re-alerts every scan
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: alert-storm
- **File**: src/lib/alerts.ts:72
- **Scenario**: `detectRegression` is called per scan (daily rescan cron + every push webhook) diffing fresh vs the previously-persisted report. A repo whose overall oscillates ≥ `overallDrop` (e.g. 60→54→60→54) fires an `overall-drop` alert on every down-cycle, indefinitely — likewise a level that flaps L4↔L3.
- **Root cause**: The header comment's "each crossing fires once with no dedupe state" holds ONLY for unit-sized credit debits (monotonic). Regressions carry no last-alerted state, cooldown, or hysteresis — the detector is memoryless and the caller (`scan-alerts.ts`) never dedupes.
- **Impact**: A genuinely unstable repo (score bouncing above the ±2 noise band) spams the org's Slack channel, training the very inbox-filter the digest movement-gate was designed to avoid.
- **Fix sketch**: Gate dispatch on a cooldown / last-alerted-verdict (reuse the audit trail: skip if an identical `scan.regression` code fired for this repo within N hours, or require the score to recover past the threshold before re-arming).

## 5. `isLowCreditsCrossing` silently depends on unit-sized debits
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: assumption-landmine
- **File**: src/lib/alerts.ts:265
- **Scenario**: `balanceAfter === 0 || balanceAfter === threshold`. Correct today because the only caller debits one credit at a time (`maybeAlertLowCredits`, unit debits pass through every integer). Add any batch debit, a proportional charge, or an admin adjustment that jumps the balance past both `threshold` and `0`, and the depletion alert never fires.
- **Root cause**: An equality (landing-on) test standing in for a crossing (passed-through) test — load-bearing on the "debits are unit-sized" invariant that lives in a different module.
- **Impact**: The prepaid-churn "silent moment" the code exists to prevent returns undetected — scans quietly stop and the org only discovers it via a later 402.
- **Fix sketch**: Take `balanceBefore` too and test a true crossing: `balanceBefore > threshold && balanceAfter <= threshold` (and the `> 0 → <= 0` depletion case).

## 6. Save/test result messages are not announced to screen readers
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/org/AlertsControl.tsx:279
- **Scenario**: `{notice && <p ...>{notice}</p>}` and `{error && <p ...>{error}</p>}` render the async outcome of Save / Send test / Clear, but neither `<p>` is a live region. The component otherwise invests heavily in a11y (focus trap, restore-on-close), so this gap is conspicuous.
- **Root cause**: Assumption that a visually-inserted paragraph is perceivable; a keyboard/SR user who pressed "Save" gets no announcement of "Saved." or the error.
- **Impact**: SR users can't tell whether saving the webhook succeeded or failed — a silent failure for exactly the assistive-tech users the focus work targets.
- **Fix sketch**: Wrap the outcome in `<p role="status" aria-live="polite">` (and `aria-live="assertive"` / `role="alert"` for the error), or a single visually-updating live region.

## 7. Dirty-tracking enables Save on a pristine form; stale notice persists on reopen
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: dirty-tracking
- **File**: src/components/org/AlertsControl.tsx:144
- **Scenario**: `canSave = webhookUrl.trim() !== "" || thresholdsChanged`. An org with a stored webhook opens the popover and, with nothing changed, Save is enabled; clicking it re-writes thresholds and records an audit entry for a no-op. Also, `notice`/`error` are never reset on close, so a prior "Saved." reappears when the popover is next opened (the lazy-load `if (!open || loaded) return` never re-runs). Client threshold inputs carry `min/max` but `save()` sends `Number(value)` unclamped, relying on the server 400.
- **Root cause**: "Dirty" is approximated by "webhook non-empty" rather than "webhook changed OR thresholds changed"; popover-close does no state reset.
- **Impact**: Confusing enabled-Save with no pending change, spurious audit rows, and a stale success banner on reopen — minor polish erosion.
- **Fix sketch**: `canSave = webhookTouched || thresholdsChanged`; clear `notice`/`error` in the close path (or on open); optionally surface an inline range hint before submit.

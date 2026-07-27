# Fleet Alerts & Digests — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Transient DB error misroutes a tenant's digest to the operator's global sink — and burns the week's claim
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/api/cron/digest/route.ts:119`
- **Scenario**: The digest loop resolves the sink with `getOrgAlertWebhook(org).catch(() => null)`. A transient DB error on that one read makes an org that HAS its own webhook look identical to "no webhook configured": `null` flows into `isAlertConfigured(null)` / `dispatchAlert({ webhookUrl: null })`, both of which fall back to the global `ALERT_WEBHOOK_URL` (`src/lib/alerts.ts:380-385`). The digest — the org's fleet scores, top movers, credit balance — POSTs to the operator's channel. Worse, `claimOrgAuditOnce` succeeds first, so the window is claimed and the *correct* sink never receives that week's digest (the claim is only released on dispatch failure, and the misrouted dispatch returns true).
- **Root cause**: `.catch(() => null)` conflates "lookup failed" with "org has no webhook", and the global-fallback design in `resolveAlertWebhook` treats null as an intentional single-tenant configuration. The file header promises "routed per tenant so each customer receives its own fleet intelligence" — this path breaks that promise silently.
- **Impact**: Tenant fleet intelligence delivered to the wrong (operator) channel on a flaky DB week, plus a dropped digest for the tenant with no retry — the two failure modes the claim/release machinery was built to prevent.
- **Fix sketch**: Distinguish error from absence: `getOrgAlertWebhook(org).catch(() => { throw ... })` — let the per-org try/catch count it in `errors` and skip the org (self-heals next run since no claim was taken). Alternatively return a sentinel (`{ ok: false }`) and skip before the claim. Only a genuine `null` (org row read OK, column null) should reach the global fallback.

## 2. Per-org "Regression sensitivity" thresholds silently don't apply to the weekly digest
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/components/org/shared/AlertsControl.tsx:211-249` (vs `src/app/api/cron/digest/route.ts:152` and `src/lib/scan-alerts.ts:60-61`)
- **Scenario**: The popover intro says the webhook receives "regression, low-credit, and weekly-digest alerts", then immediately offers "Regression sensitivity (points)" fields — a reasonable admin concludes the thresholds tune what lands under "Regressions:" in the digest too. They don't: `getOrgAlertThresholds` is consumed only by the per-repo path (`scan-alerts.ts:60`), while the digest gates gainers/regressers on the *global* `isWithinNoise` band and never reads the org's thresholds.
- **Root cause**: Two regression definitions coexist (per-repo alert threshold vs digest noise band) and the decision to keep the digest on the global band is recorded nowhere — not in the UI copy, not in the digest route, not in org-alerts.ts.
- **Impact**: An org that raises `overallDrop` to 20 to quiet a flappy fleet still gets every ±3-point mover listed as a digest "Regression"; an org that lowers it to 2 sees repos alert individually but never appear in the digest. Confusing, erodes trust in the control ("I changed it and nothing happened").
- **Fix sketch**: Either scope the UI copy honestly ("applies to per-repo regression alerts") and add one sentence to the digest route header documenting the deliberate split, or thread `getOrgAlertThresholds` into the digest's regressers filter (use `max(orgOverallDrop, noiseBand)` for the listing cut-off).

## 3. Low-credit crossing detection rests on an unenforced "debits are unit-sized" invariant
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/alerts.ts:334-336`
- **Scenario**: `isLowCreditsCrossing(balanceAfter, threshold)` fires only when the balance lands *exactly* on `threshold` or exactly on 0. The doc comment states "Debits are unit-sized (one credit per scan)" — the entire dedupe-free design (each crossing fires once) hangs on that, but nothing enforces it: no assertion at the debit site, no test coupling the credit layer's debit size to this predicate, and any future bulk operation (multi-repo scan batch, priced re-scan costing >1, an admin balance adjustment) can step over the threshold without ever equaling it.
- **Root cause**: A cross-module invariant (credits layer debit granularity → alerts layer equality check) is documented only as a comment on the consumer, so the producer can change independently and the alert dies silently.
- **Impact**: The prepaid model's "silent churn moment" alert (the code's own words) silently never fires; autoscans stop with no warning — the exact failure the alert exists to prevent, and one that no test would catch.
- **Fix sketch**: Make the predicate range-based: fire when the balance crosses the line, i.e. `balanceBefore > threshold && balanceAfter <= threshold` (and `balanceBefore > 0 && balanceAfter <= 0`), taking `balanceBefore` from the debit site it already knows. That removes the invariant entirely instead of guarding it; keep the once-per-crossing property since a crossing still happens at most once per direction change.

## 4. "Test alert delivered ✓" on an unsaved candidate URL + dismiss-on-outside-click silently discards the edit
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/org/shared/AlertsControl.tsx:174-179` (dismiss: lines 37-49)
- **Scenario**: An admin pastes a new webhook, clicks "Send test", sees the green "Test alert delivered ✓", and — task apparently complete — clicks elsewhere on the page. The popover closes on any outside mousedown or Escape with no dirty-state guard and no draft retention; the URL was never saved (test intentionally dispatches to the candidate without storing it), so regressions and the Monday digest keep flowing to the old/global sink.
- **Root cause**: The success notice for *test* reads like the success notice for *save* ("delivered ✓" is a terminal-sounding confirmation), and the dialog's close paths don't distinguish a dirty form from a clean one.
- **Impact**: A plausibly common admin flow ends with routing unchanged while the admin believes it's configured — discovered only when a real regression lands in the wrong channel weeks later.
- **Fix sketch**: When the form is dirty (`webhookTouched || thresholdsChanged` — already computed), (a) suffix the test notice: "Test alert delivered ✓ — not saved yet", and (b) keep Escape/outside-click from silently discarding: either retain the draft state on reopen (don't reset on close) or require a second Escape / show an "Unsaved changes" hint. Also consider disabling Save when nothing changed (`canSave` is currently true whenever a webhook merely exists).

## 5. Digest percentile renders broken ordinals ("21th pctile", "1th pctile") in an executive-facing message
- **Severity**: Low
- **Category**: visual-inconsistency
- **File**: `src/lib/alerts.ts:274`
- **Scenario**: `const pctile = d.percentile != null ? \` · ${d.percentile}th pctile\` : ""` hard-codes the "th" suffix. Corpus percentiles ending in 1/2/3 (except 11/12/13) — 1, 2, 3, 21, 22, 23, 31, 41, 51, 61, 71, 81, 91… — render as "21th", "52th"-style wrong ordinals ("52th" is fine, but "52nd"'s siblings 21/22/23 etc. are not).
- **Root cause**: Magic suffix instead of an ordinal helper; the digest is the one artifact leaders see without opening the app, and no test pins the percentile line's text.
- **Impact**: A typo-grade blemish in the highest-visibility, least-correctable surface (a sent Slack message can't be hot-fixed), undermining the polish of an executive digest whose entire job is credibility.
- **Fix sketch**: Add a tiny `ordinal(n)` helper next to `signed()` (`n % 100 in 11..13 ? "th" : {1:"st",2:"nd",3:"rd"}[n % 10] ?? "th"`), use it in `pctile`, and cover 1/2/3/11/12/13/21/100 in `alerts.test.ts` alongside the existing builder tests.

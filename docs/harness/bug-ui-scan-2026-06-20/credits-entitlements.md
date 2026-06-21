> Total: 6 findings (0 critical, 2 high, 3 medium, 1 low)

# Credits & Entitlements — combined bug+ui scan

## 1. Credit reconciliation silently drops ledger rows past the newest 200, understating debits/grants/net
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: financial-reporting-correctness
- **File**: src/lib/db/credits.ts:262
- **Scenario**: An org on Team (500 scans/mo) runs daily autoscans across a large watched fleet. Each metered scan writes a `scan` ledger row, plus dedup/mock scans write `refund` rows — easily 20-40 rows/day. The `/usage` page requests a 30-day reconciliation; `getCreditReconciliation` calls `getCreditLedger(orgSlug, 200)`, which `take`s only the newest 200 rows (`orderBy createdAt desc`), then date-windows them. Any rows beyond the most-recent 200 are never fetched, so `debited`, `granted`, `refunded`, and `net` reflect only a partial slice of the window.
- **Root cause**: Reconciliation reuses the UI "recent ledger" reader (hard-capped at 200) as its data source instead of aggregating over the full window. The 200 cap is correct for a "recent activity" list but wrong for a financial sum over an N-day window that can contain far more than 200 movements.
- **Impact**: The billing/usage page shows materially understated credit consumption and net change for active fleets — a money-facing report that quietly disagrees with the true ledger. Reconciliation against Polar top-ups (the documented purpose, USE-4) becomes unreliable exactly for the high-volume orgs that most need it.
- **Fix sketch**: Aggregate server-side over the actual window rather than over a fixed row cap — e.g. `creditLedger.aggregate`/`groupBy` with `where: { orgId, createdAt: { gte: cutoff } }` summing positive (split refund vs grant by reason) and negative deltas; or page through all in-window rows. Drop the dependency on the 200-row recent-list reader for the sum.

## 2. Refund grants are not idempotent — a retried transaction can refund the same scan twice
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: credit-grant-idempotency
- **File**: src/lib/db/credits.ts:79
- **Scenario**: On dedup/mock/failed scans the scan paths call `grantCredits(org, 1, { reason: "refund" })` with NO `externalId`. `grantCredits` wraps its `$transaction` in `withRetry`, which re-runs the whole closure on any error classified retryable (serialization/OCC conflict, or a connection blip whose message matches "please retry"/"write conflict"). The idempotency machinery (`externalId` fast-path + unique-constraint catch) only protects grants that pass an `externalId`; refunds pass none, so a re-executed closure simply appends a second `+1` ledger row and increments the balance again.
- **Root cause**: Idempotency is opt-in via `externalId`, but the highest-frequency grant caller (per-scan refunds, fired from concurrent `mapPool` lanes against Aurora DSQL where OCC conflicts/retries are expected, not exceptional) never supplies one. A money-increasing operation under an auto-retry wrapper has no dedup key.
- **Impact**: Over-refunding inflates an org's balance, handing out free private scans — a slow credit leak that worsens precisely under the concurrency the retry layer exists to handle.
- **Fix sketch**: Give refunds a stable `externalId` (e.g. `refund:<scanId>` or `refund:<repoFullName>:<headSha>`) so a retry/redelivery is a no-op via the existing unique-constraint path; or make `grantCredits` refund mode caller-keyed. At minimum, document that any non-idempotent `grantCredits` call is unsafe under `withRetry`.

## 3. consumeScanCredit can charge a credit that should have been covered by the monthly allowance (boundary race)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: metering-accuracy
- **File**: src/lib/db/credits.ts:178
- **Scenario**: The allowance gate is a soft read: `decideScanCharge` compares `countMeteredScansThisMonth` against `scanAllowance` outside the debit transaction. The code comment acknowledges the race can free one extra scan, but the opposite direction also exists: between this read and the atomic decrement, concurrent lanes (the `mapPool` batch in org/scan, or overlapping cron passes) can each independently read `usageThisMonth` just under the allowance, all decide `"allowance"` for some and `"credit"` for others depending on interleaving, and a scan that was within allowance ends up debiting a prepaid credit (or vice-versa). The decision is made on a stale month count that no transaction re-validates.
- **Root cause**: The allowance/credit boundary is resolved by a non-transactional pre-check while only the credit decrement is concurrency-safe. There is no atomic "consume one allowance slot" counter, so the allowance-vs-credit split is best-effort under concurrency.
- **Impact**: An org near its monthly allowance boundary can be charged real credits for scans the plan should have covered (or get extra free ones). Small per-incident, but it's silent money movement and undermines the "free while under allowance" promise.
- **Fix sketch**: Either accept and document the boundary slop explicitly as a known tolerance, or make the allowance consumption atomic (a per-month counter row decremented in the same transaction as the credit decision), so the allowance-vs-credit choice can't drift under concurrency.

## 4. getCreditReconciliation classifies any positive delta whose reason contains "refund" as a refund — reason text is the only signal
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: ledger-classification
- **File**: src/lib/db/credits.ts:269
- **Scenario**: Refund vs grant is split purely by `/refund/i.test(e.reason)`. A manual owner grant whose free-text reason happens to mention "refund" (e.g. an adjustment note "refund for downtime", entered via the grant endpoint which forwards `reason`) is bucketed as `refunded`, not `granted`; conversely a genuine refund recorded with any other reason is counted as a top-up `granted`. The buckets feed the usage page's "spent vs returned vs purchased" breakdown.
- **Root cause**: There is no structured `kind`/`type` column on the ledger; the reconciler infers semantics from human-entered reason strings, so classification is only as disciplined as the free-text.
- **Impact**: Misclassified rows skew the reconciliation breakdown (refunded vs granted), making the billing summary subtly wrong and unauditable against Polar without manual interpretation.
- **Fix sketch**: Add an enumerated ledger column (`scan` | `refund` | `grant` | `adjustment` | `topup`) set at write time by `consumeScanCredit`/`grantCredits`, and classify on it instead of regex over `reason`. Keep `reason` as the human note only.

## 5. Out-of-credits warning only appears at zero, while the system alerts at a low-water threshold of 5
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: low-credit-state
- **File**: src/components/org/CreditsControl.tsx:108
- **Scenario**: The chip's warning/amber treatment and the "Out of credits" copy are gated on `low = balance <= 0`. Meanwhile the backend (`maybeAlertLowCredits` / `creditsAlertThreshold`, default 5) considers an org "low" at a balance of 5 or below and pushes a depletion alert. A user with 3 credits sees a normal (non-amber) chip with no in-dashboard heads-up, then hits a hard 402 a scan or two later despite the system already having flagged them low.
- **Root cause**: The dashboard's low-credit visual threshold (0) is decoupled from the server's low-credit alert threshold (5), so the UI under-warns relative to the product's own definition of "low".
- **Impact**: Owners get no proactive in-app low-balance nudge before depletion; the only in-dashboard signal is the all-or-nothing "out of credits" at zero. Mild UX gap on a billing-adjacent control.
- **Fix sketch**: Surface a distinct "running low" amber state when `balance > 0 && balance <= threshold` (pass the threshold from the server, or mirror the default of 5) in addition to the `<= 0` "out of credits" state, so the chip warns before the paywall.

## 6. Top-up popover stays open with stale "0 credits" copy after a grant fails silently to a non-numeric balance
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: error-feedback / optimistic-state
- **File**: src/components/org/CreditsControl.tsx:74
- **Scenario**: `grant()` POSTs and, on a response that is `ok` but whose body lacks a numeric `balance` (e.g. a proxy/HTML error page, a 200 with an unexpected shape), takes the `!res.ok || typeof data.balance !== "number"` branch and sets a generic "Top-up failed." error — but the displayed balance and the "out of credits" warning are NOT refreshed from the server. The user sees the error yet the chip/copy still reflect the pre-grant balance, with no way to confirm whether anything actually moved. Because refunds/grants are not idempotent (finding #2), a user who retries after this ambiguous failure can double-apply.
- **Root cause**: The control trusts the response body for state and has no reconcile-from-server fallback on a partial/ambiguous success; the error path neither re-fetches the authoritative balance nor disables retry until reconciled.
- **Impact**: Ambiguous failure feedback on a money action; encourages a retry that, given the non-idempotent grant path, can mint extra credits. UX + correctness coupling.
- **Fix sketch**: On any non-clean grant response, re-fetch `/api/org/credits` to show the authoritative balance, and message "couldn't confirm — check recent activity" rather than a blanket "failed". Combine with an idempotency key on the grant request so a retry is safe.

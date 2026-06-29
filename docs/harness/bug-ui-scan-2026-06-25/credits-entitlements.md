# Credits & Entitlements — Bug + UI Scan
> Context: Credits & Entitlements (Billing, Credits & Metering)
> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)

## 1. consumeScanCredit debit is non-idempotent under withRetry (double-charge / false-deny)
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: race-condition
- **File**: src/lib/db/credits.ts:201-235 (debit tx + ledger create), contrast 86-92 (grant's synthesized externalId)
- **Value**: impact 8 · effort 3 · risk 4
- **Scenario**: A metered scan calls `consumeScanCredit`, wrapped in `withRetry`. Against Aurora DSQL the `$transaction` commits but the COMMIT ack is lost / surfaces as a retryable blip (the exact "commit-ambiguity" case the grant path was hardened against — see the comment at lines 86-91). `withRetry` (client.ts:256-280) re-runs the whole closure: `updateMany ... scanCredits > 0` decrements a SECOND credit and `creditLedger.create` appends a SECOND `delta:-1` row. The org is charged twice for one scan. If the balance was exactly 1, the retry's conditional decrement finds `scanCredits = 0` → `count === 0` → returns `{ ok:false, balance:0, charged:false }`, so a scan that WAS actually paid is reported back as denied (402 / no refund).
- **Root cause**: `grantCredits` defends against withRetry re-application by synthesizing `auto:${randomUUID()}` and relying on the `externalId` unique constraint to collapse a retry (credits.ts:92). The debit path uses the same `withRetry` but its `creditLedger.create` passes **no** externalId, and `externalId` is `String? @unique` (schema.prisma:92) where NULLs never collide in Postgres — so nothing dedups a re-applied debit. The refund (+1) path is idempotent; the symmetric debit (−1) path is not.
- **Impact**: money error — customers over-charged credits on DB-retry windows; ledger reconciliation (`getCreditReconciliation`) drifts; at balance=1 a paid scan is mis-reported as unpaid.
- **Fix sketch**: give the debit a stable idempotency key the unique index can catch — pass `externalId: scan:${ctx.scanId}` when a scanId exists, or synthesize a per-invocation `auto:${uuid}` exactly as `grantCredits` does, and swallow the P2002 by re-reading the post-debit balance. That makes a re-applied debit impossible regardless of the retry trigger.

## 2. Credits chip claims "out of credits / scans paused" at balance 0 even when monthly allowance still covers scans
- **Lens**: ui-perfectionist
- **Severity**: high
- **Category**: visual-consistency
- **File**: src/components/org/CreditsControl.tsx:108 (`const low = balance <= 0`), 117-124 (amber chip), 138-142 ("private scans are paused"); props 28-42
- **Value**: impact 7 · effort 4 · risk 3
- **Scenario**: A Free org (10 free scans/mo) or Pro org (100/mo) that has bought zero prepaid credits but used only 3 of its monthly allowance has `balance === 0`. The chip renders amber and the popover shows "Out of credits — private scans are paused until you top up." But per the hybrid model, scans are NOT paused — `consumeScanCredit` returns `charge === "allowance"` (free) and `checkScanEntitlement` returns `allowed: true, withinAllowance: true` (credits.ts:197, entitlement.ts:44-50). The user is told they must pay when their plan still includes free scans.
- **Root cause**: `CreditsControl` only receives `initialBalance` + `unlimited`; it has no knowledge of `scanAllowance`/`usageThisMonth`, so it equates "balance 0" with "blocked." The allowance dimension of the billing model never reached this surface.
- **Impact**: misleading money-facing UX — nudges users toward unnecessary top-ups/upgrades and falsely signals a paused service; erodes trust in the meter.
- **Fix sketch**: pass `allowanceRemaining` (already computed by `checkScanEntitlement`) into the component; treat `paused` as `balance <= 0 && allowanceRemaining <= 0`. When allowance remains, show "N free scans left this month" instead of the amber "paused" warning.

## 3. Reconciliation misclassifies refunds as grants when the reason string lacks "refund"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/db/credits.ts:288-296 (esp. 292-293, `/refund/i.test(e.reason)`)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: `getCreditReconciliation` buckets every positive delta as `refunded` iff its `reason` contains the substring "refund", else `granted`. The refund is written by the scan/cron caller (out of this context) with no enforced reason contract. If a dedup/degrade refund is ever stamped with a reason like "dedup", "reverted", or "scan", it silently lands in `granted` — overstating grants and understating refunds on the money-facing /usage reconciliation, while `net` stays correct so nothing looks broken.
- **Root cause**: classification is a free-text regex over an un-typed `reason` column shared across producers (`scan`/`grant`/`adjustment`/`polar`/`refund`), with no constant or enum binding the refund producer to the classifier.
- **Impact**: inaccurate financial reporting on /usage; reconciliation can't be trusted to spot an over-refund leak (which is itself the bug class in finding #1).
- **Fix sketch**: export a `REASON.REFUND` constant (or a `kind` enum column) shared by the refund writer and this reader, and classify on it rather than a substring; add a test that the refund producer's reason actually matches the classifier.

## 4. Credits popover dialog has no focus management and no ledger loading/error state
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/org/CreditsControl.tsx:51-63 (handlers), 66-72 (ledger fetch), 127-132 (`role="dialog"`)
- **Value**: impact 5 · effort 4 · risk 2
- **Scenario**: Opening the popover sets `role="dialog"` but never moves focus into it; on Escape (line 56) focus is not returned to the trigger button, so a keyboard/screen-reader user is dropped back at `<body>`. Separately, the lazy ledger fetch swallows every failure — a 503 (no DB), 403 (denied), or network error all resolve to `setLedger([])` (lines 69-71), and there is no loading spinner. The user sees the "Recent activity" block silently absent with no way to distinguish "no activity yet" from "load failed."
- **Root cause**: the popover was built as a styled div with `role="dialog"` semantics but without the focus-trap/restore behavior a dialog role promises; the ledger fetch collapses all non-OK/error outcomes into the empty-success state.
- **Impact**: keyboard/AT users lose their place; failed ledger loads masquerade as an empty ledger (success theater) on a money screen.
- **Fix sketch**: focus the dialog (or its first control) on open and restore focus to the trigger on close/Escape; track a `ledgerError`/`loading` state and render a one-line retry/skeleton instead of silently rendering nothing.

## 5. Monthly-credit estimate overstates cost by ignoring the plan's free allowance
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/lib/credit-estimate.ts:20-29 (`estimateMonthlyCredits`), 9-14 (copy)
- **Value**: impact 4 · effort 5 · risk 2
- **Scenario**: `estimateMonthlyCredits` sums watched-repo run rates (daily≈30, etc.) and the connect/onboarding surfaces present it as "prepaid credits this watch+schedule will draw." But a metered scan is free until the org exceeds its monthly allowance (Free 10, Pro 100, Team 500 — plans.ts:25-66). A Pro org watching 3 daily repos shows ≈90 credits/month when all 90 fall inside its 100 free scans (actual draw: 0). The figure systematically overstates the spend commitment for any non-Enterprise org with allowance.
- **Root cause**: the estimator was given only watch/schedule rows, not the org's plan allowance and month-to-date usage, so it can't subtract the free band. (The header comment does label it an "upper-bound estimate," which softens but doesn't remove the misleading nudge on a spend-decision control.)
- **Impact**: overstated cost can deter users from enabling watches/schedules they're entitled to for free; weakens the credibility of the commitment surfaces.
- **Fix sketch**: accept `allowanceRemaining` (from `checkScanEntitlement`) and return `max(0, runs − allowanceRemaining)` as the credit estimate, with the raw run count shown separately as "scheduled runs"; keep the "upper-bound" caveat for the overflow portion only.

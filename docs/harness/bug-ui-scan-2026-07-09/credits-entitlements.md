# Credits & Entitlements — bug-hunter + ui-perfectionist scan

> Context: Credits & Entitlements (group: Billing, Credits & Metering)
> Files scanned: 9
> Total: 7 findings (Critical: 0, High: 0, Medium: 3, Low: 4)

Note: the credit-accounting core (grant/debit idempotency, balance-clamp, ledger `balanceAfter`
integrity, reconciliation bucketing) is genuinely well-hardened and heavily pinned by tests — no
Critical/High survives reading. The findings below are a narrow migration-era money bug, one
money-surface staleness bug, one accessibility gap, and polish/consistency Lows.

## 1. clawbackOrderRefund double-claws refunds that straddle the externalId-key migration
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: idempotency-drift
- **File**: src/lib/db/credits.ts:223
- **Scenario**: Order X gets a partial Polar refund under the OLD code (which wrote a per-ORDER key `polar-refund:<orderId>`, no trailing colon — see the docstring at :196-198 and `sumRefundClawback` at :426 that still matches it). The deployment upgrades. A later, larger refund event for X arrives and `clawbackOrderRefund` runs.
- **Root cause**: The `prior` aggregate computes `alreadyClawed` with `externalId: { startsWith: `polar-refund:${orderId}:` }` (WITH the colon), so it can't see the legacy no-colon row. `sumRefundClawback` deliberately matches both forms, proving legacy rows are a real concern — but this hot-path aggregate doesn't, so the two readers of the same data disagree.
- **Impact**: `alreadyClawed` under-counts → `marginal` over-counts → the order's first refund share is clawed back a second time, removing up to that many still-held credits the customer paid for (clamped only at 0). Money loss to the customer, silent.
- **Fix sketch**: Mirror `sumRefundClawback`'s matcher in the aggregate: `where: { orgId, OR: [{ externalId: `polar-refund:${orderId}` }, { externalId: { startsWith: prefix } }] }`, or just call `sumRefundClawback` for `alreadyClawed` so both paths share one definition of "already clawed".

## 2. Popover fetches the authoritative balance, then throws it away — chip stays stale after scans spend credits
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale-data
- **File**: src/components/org/CreditsControl.tsx:94
- **Scenario**: User loads an org page (chip painted from SSR `initialBalance`), runs several private scans elsewhere in the session that debit credits, then opens the credits popover. The open-effect fetches `/api/org/credits`, whose response includes the fresh `balance`, but `.then((d) => setLedger(d?.ledger ?? []))` consumes only `d.ledger` and discards `d.balance`.
- **Root cause**: `balance` state is seeded once from `initialBalance` and only mutated by local grants (:113); the one place that re-reads the truth from the server ignores it.
- **Impact**: On a money surface, the big "{balance} private scans remaining" (:169) and the paused/allowance banners keep showing a stale, too-high number, and the freshly-loaded ledger's newest `balanceAfter` visibly contradicts it. Users under-estimate their spend.
- **Fix sketch**: In the same `.then`, reconcile the chip: `if (typeof d?.balance === "number") setBalance(d.balance)` (and optionally the allowance), so opening the popover self-heals the displayed balance.

## 3. "Out of credits / paused" state on the chip is signalled by color alone
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/org/CreditsControl.tsx:149
- **Scenario**: An org exhausts its allowance and credits (`paused === true`, :138). The trigger button’s label stays exactly "{balance} credits"; the only change is border/text switching slate→amber (:150-152).
- **Root cause**: The paused affordance on the collapsed trigger is purely a color swap — no text, icon, or ARIA. The explanatory copy exists only inside the popover (:172-176), which a user must first open.
- **Impact**: Colorblind and screen-reader users get no cue that private scanning is paused until they discover and open the popover — a WCAG 1.4.1 (use-of-color) gap on a billing-critical status.
- **Fix sketch**: When `paused`, add a visible marker (e.g. a warning glyph or " · paused" suffix) and an `aria-label` like `` `${balance} credits — out of credits, scanning paused` ``; keep the amber styling as reinforcement, not the sole signal.

## 4. Stale grant error persists across popover close/reopen
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/org/CreditsControl.tsx:237
- **Scenario**: A top-up fails, setting `error` (:110); the user closes the popover and reopens it later without retrying. The old "Top-up failed." (:237) is still rendered because `error` is never cleared on open/close.
- **Root cause**: The open/close effect (:62) manages focus and listeners but doesn’t reset transient `error`; only a subsequent `grant()` clears it (:101).
- **Impact**: A phantom failure message on a money popover for an action the user didn’t just take — confusing, erodes trust.
- **Fix sketch**: In the `open` effect, `if (open) setError(null)` (or clear both `error` and `ledgerError` on close).

## 5. GET /api/org/credits resolves the org ~4× and reads credit state twice per request
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: redundant-query
- **File**: src/app/api/org/credits/route.ts:18
- **Scenario**: Every credits GET runs `getCreditState(org)` directly AND `checkScanEntitlement(org)`, which itself calls `getCreditState(org)` again plus `countMeteredScansThisMonth(org)`; `getCreditLedger(org, 50)` resolves the org once more — four `organization.findUnique` lookups and two identical state reads for one read.
- **Root cause**: Two helpers that each independently re-resolve the org are composed rather than sharing one loaded state. The response even mixes `state.balance` (read A) with `allowanceRemaining` derived from read B, so a debit landing mid-request makes the two subtly disagree.
- **Impact**: Extra DB round-trips on a per-member-hit endpoint; a minor internal inconsistency window. Low.
- **Fix sketch**: Load `getCreditState` once and pass it into a pure entitlement calc (or add an overload of `checkScanEntitlement` that accepts a preloaded state + usage), so one org resolution feeds all three outputs.

## 6. checkScanEntitlement ignores orgExists → an unknown org reports as entitled
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: validation-gap
- **File**: src/lib/entitlement.ts:40
- **Scenario**: For a deleted/typo'd slug, `getCreditState` returns `{ balance:0, plan:"free", orgExists:false }`. `checkScanEntitlement` never inspects `orgExists`, so with usage 0 < the free allowance it returns `allowed:true, withinAllowance:true` — a phantom org looks entitled.
- **Root cause**: The read gate treats "no such org" identically to "real free org with headroom", unlike the write gate `consumeScanCredit` (credits.ts:303) which surfaces `orgExists:false` and denies.
- **Impact**: Read-side inconsistency only (the sole route caller is behind `requireOrgRead`, and the money-moving write path denies), so no exploit — but it can render a bogus "entitled" state for an org that no longer exists. Low.
- **Fix sketch**: Thread `orgExists` through `ScanEntitlement`; when `state.orgExists === false`, return `allowed:false` (or a distinct `unknownOrg` flag) so read and write gates agree.

## 7. Recent-activity ledger silently truncated to 5 of the 50 fetched, with no overflow affordance
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: overflow-affordance
- **File**: src/components/org/CreditsControl.tsx:259
- **Scenario**: The popover fetches up to 50 ledger rows (route.ts:20) but renders `ledger.slice(0, 5)` with no count, "+N more", or link — a user reconciling a charge sees only the newest five and has no cue more exist.
- **Root cause**: A hardcoded 5-row cap on a money history with no "view all" path to the full ledger/usage page.
- **Impact**: Users can’t audit older credit movements from here and may not realize the list is truncated. Low.
- **Fix sketch**: Add a "View all activity →" link (to `/usage`) or a "+{ledger.length - 5} more" line when `ledger.length > 5`.

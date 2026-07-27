# Credits & Entitlements — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Credits chip self-heals `balance` but freezes `allowanceRemaining` at SSR, so the paused/allowance messaging can be wrong all session
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/org/shared/CreditsControl.tsx:98` (also lines 32, 142–144)
- **Scenario**: The popover-open fetch of `/api/org/credits` deliberately reconciles the stale chip balance from `d.balance` (the comment explains why), but the same response also carries `allowanceRemaining` — and the component throws it away. `allowanceRemaining` stays whatever the server rendered at page load. `paused = balance <= 0 && freeScansLeft <= 0` and `coveredByAllowance` are derived from that frozen value.
- **Root cause**: The staleness fix (line 93–98) was applied to only one of the two server-derived inputs of the paused/allowance state machine.
- **Impact**: An org at balance 0 that burns its last free monthly scans mid-session keeps showing "N free scans left — scans keep running" while /api/scan is actually returning 402; conversely, after the UTC month rollover the chip keeps crying "out of credits — paused" and nudges an unnecessary top-up. This is exactly the false signal the `coveredByAllowance` comment (line 139–141) says the control must not emit — it just re-emerges via staleness.
- **Fix sketch**: In the fetch handler, alongside `setBalance(d.balance)`, hoist `allowanceRemaining` into state and set it from `d.allowanceRemaining ?? 0` (the route serializes Infinity as null, but null only occurs with `unlimited`, which renders a different branch). Seed the state from the prop.

## 2. Owner "adjustment" grants are silently clamped — the API reports success with no hint that only part of the delta applied
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/app/api/org/credits/grant/route.ts:47-52` (clamp at `src/lib/db/credits.ts:153-154`)
- **Scenario**: The route accepts negative amounts (reason auto-mapped to "adjustment") for manual reconciliation. `grantCredits` clamps a debit to the available balance (`Math.max(delta, -org.scanCredits)`) and, when the balance is already 0, applies nothing at all — yet the route returns `{ ok: true, balance }` in every case. An operator reconciling -500 against a balance of 30 gets `ok: true, balance: 0` and cannot tell whether 500, 30, or 0 credits were actually removed without reading the ledger.
- **Root cause**: The clamp semantics are documented on `grantCredits` (a deliberate ledger-honesty fix), but the HTTP contract was never extended to surface the applied delta; the docblock `POST ... -> { ok, balance }` promises nothing about partial application.
- **Impact**: Manual reconciliation (the endpoint's stated purpose) can silently under-apply; books balanced against an external system (Polar disputes, support credits) drift with no error signal. The UI's grant path only ever sends positive amounts, so nothing exercises or reveals this today.
- **Fix sketch**: Have `grantCredits` return `{ balance, appliedDelta }` (or the route re-derive it), include `appliedDelta` in the response, and document the zero-application case (`appliedDelta: 0` when debiting an empty balance). One line in the route docblock stating "negative amounts are clamped to the available balance" would cover the contract half.

## 3. Money-model comments hardcode a Free allowance of 10 that drifted from the real value (5), and "upper-bound" is untrue for 31-day months
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/lib/credit-estimate.ts:48-49` (also `src/lib/entitlement.ts:29`, `src/lib/credit-estimate.ts:10,14`)
- **Scenario**: `estimateMonthlyCredits`'s docblock states the allowance band as "(Free 10, Pro 100, Team 500)" and `entitlement.ts:29` reasons about "its 10 monthly free scans". The single source of truth (`src/lib/plans.ts` `PLAN_FEATURES.free.includedCredits`) is **5** — even the marketing blurb says "5 scans a month". Separately, `MONTHLY_RUNS.daily = 30` is presented everywhere (including the user-facing `CREDIT_ESTIMATE_NOTE`) as an "upper-bound estimate", but a daily schedule in a 31-day month runs 31 times, so the figure is not actually an upper bound.
- **Root cause**: Allowance values were duplicated into prose instead of referenced; `daily: 30` was chosen as a round average and then labeled with a stronger guarantee ("upper-bound") than it provides.
- **Impact**: These are the comments future maintainers (and prompt-driven tooling) trust when touching billing math — a reader "fixing" code to match "Free 10" would double the free tier. The upper-bound claim can under-quote a user's committed spend by 1 credit/repo in 31-day months on the exact surface designed to make "the spend decision informed".
- **Fix sketch**: Replace hardcoded tier numbers in prose with a reference ("see PLAN_FEATURES / scanAllowance()"), or cite the current values with a "source of truth" pointer. Either bump `daily` to 31 (a true upper bound) or soften the copy to "typical month ≈30 runs" and drop "upper-bound" from the daily claim.

## 4. Monthly allowance resets at UTC calendar-month start — undocumented, and misaligned with subscription anniversaries
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/lib/db/credits.ts:283-287`
- **Scenario**: `countMeteredScansThisMonth` windows usage from `Date.UTC(year, month, 1)`. Two consequences are nowhere recorded or surfaced: (a) users in western timezones see their allowance "reset" mid-evening on the last day of the month (or believe it hasn't reset when it has); (b) Pro/Team are Polar subscriptions billed on the purchase anniversary, so an org subscribing on the 20th gets a full 100-scan allowance for 10 days, then a fresh one on the 1st — the "monthly allowance" a customer pays for is decoupled from the month they're billed for. Neither /pricing, the CreditsControl allowance message ("N free scans left this month"), nor CREDIT_ESTIMATE_NOTE says when "this month" begins.
- **Root cause**: Calendar-month-UTC was the cheapest window to compute from `Scan.scannedAt` (no schema change), but the choice and its trade-offs vs. billing-cycle anchoring were never written down (contrast with the thoroughly documented soft-allowance overshoot in `consumeScanCredit`).
- **Impact**: Support ambiguity ("my allowance didn't reset"), a gameable first-month double allowance on paid tiers, and a silent behavior change risk if someone later "fixes" the window to billing-cycle without knowing the reconciliation/UI assume calendar months.
- **Fix sketch**: Add a docblock paragraph stating the deliberate choice (UTC calendar month; not anchored to the subscription cycle; acceptable double-allowance on first partial month) and mirror one clause into user-facing copy, e.g. "resets on the 1st (UTC)" in the allowance message and pricing FAQ.

## 5. Unlimited chip and credits trigger explain themselves via `title` only; grant errors aren't announced
- **Severity**: Low
- **Category**: a11y
- **File**: `src/components/org/shared/CreditsControl.tsx:128-136` (also 170, 258)
- **Scenario**: The `unlimited` branch renders a static `<span title="Enterprise plan — private scans are unlimited">` — `title` tooltips are unreachable by keyboard and touch users, and a non-focusable span means screen readers get only "Credits · Unlimited" with no explanation. The main trigger likewise carries meaning only in `title="Prepaid private-scan credits"`. Meanwhile the grant failure message (`{error && <p ...>}`) has no `aria-live`, although the neighboring ledger states were carefully given `aria-live="polite"` — a screen-reader user who presses +50 and fails hears nothing.
- **Root cause**: The a11y hardening pass (Escape-focus return, WCAG 1.4.1 paused marker, ledger live regions) stopped short of the unlimited branch and the mutation error path.
- **Impact**: Inconsistent access to the same money information: sighted mouse users get explanations and instant failure feedback; keyboard/AT/touch users get a bare number and silent failures on a payment-adjacent action.
- **Fix sketch**: On the unlimited span, put the explanation in visible text or `aria-label` on a focusable element (or an sr-only span). Add `aria-live="polite"` (or `role="alert"`) to the grant error paragraph, matching the ledger pattern, and `aria-busy={busy}` on the grant button group.

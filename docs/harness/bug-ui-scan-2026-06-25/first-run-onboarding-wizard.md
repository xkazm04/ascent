# First-Run Onboarding Wizard — Bug + UI Scan
> Context: First-Run Onboarding Wizard (Onboarding, Shell & AI Standard)
> Total: 5 findings (0 critical, 1 high, 2 medium, 2 low)

## 1. Credit-skipped repos leave ghost "scanning…" rows and a stuck progress bar on the done screen
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/components/onboarding/importScan.ts:96-109 · src/components/onboarding/OnboardingFlow.tsx:294-300 · src/components/onboarding/OnboardingScanRow.tsx:39-44
- **Value**: impact 7 · effort 3 · risk 2
- **Scenario**: A real scan (App path) runs because `credit.balance > 0`, but the balance is smaller than the number of selected repos (e.g. balance 3, 10 repos picked). The import route caps the batch and emits `send("notice", { reason: "insufficient_credits", … })` (route.ts:184) plus, per overflowing repo, `send("repo", { repo, skipped: "insufficient_credits" })` (route.ts:204) — a `repo` event carrying *no* `level` and *no* `error`. Onboarding's SSE parser only handles `repo`/`result`/`error` (and `notice` is dropped entirely), so each skipped repo is folded into state as `{ repo, level: undefined, overall: undefined, error: undefined }`.
- **Root cause**: The completion counter `Object.values(next).filter((r) => r.level || r.error).length` (OnboardingFlow.tsx:297, mirrored in OnboardingScanStep.tsx:52) only counts rows that have a level OR an error. A skipped row has neither, so it never counts as "done"; ScanRowView (OnboardingScanRow.tsx:42) renders any level-less, error-less row as the perpetual "scanning…" state. `result` still fires, so phase flips to `done`.
- **Impact**: On the completed "Scan complete" screen the progress bar is permanently stuck below 100% (e.g. 30%) and N repos show a forever "scanning…" label, with zero explanation that they were skipped for lack of credits. A confusing, broken-looking core payoff moment, and the credit-shortfall reason is silently swallowed.
- **Fix sketch**: In importScan.ts surface `skipped` (treat a `repo` event with `skipped` as a terminal row state, e.g. `error: "Skipped — out of credits"`) and forward the `notice` event via a new callback. Count skipped rows toward `completed`, and render a distinct "skipped" row style instead of "scanning…".

## 2. Recurring prepaid-credit cost is disclosed on the always-free public-handle preview funnel
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/onboarding/OnboardingSelectStep.tsx:140-160 (cost block) · :41 (monthlyCredits)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: A signed-out / no-App user types a public handle (e.g. `vercel`) and selects 10 repos. The cost disclosure renders unconditionally whenever `selected.size > 0`, showing "Scanning also watches these 10 repos with a weekly autoscan ≈ **40** prepaid credits/month". But the public-handle path forces `mock` (preview) and has no credit account (`credit` is null), so the import route computes `metered = !mock && org !== "public"` → for a preview import `mock` is true ⇒ never metered, never charges a credit.
- **Root cause**: The disclosure is gated only on selection count, not on whether this run is actually metered (App path with credits). It conflates "we set watch:true" with "this costs prepaid credits", which is only true on the metered App path.
- **Impact**: Money confusion — a free-funnel user is told they're committing to ~40 prepaid credits/month for a flow that never debits credits, which can scare users off the free preview that is the product's top-of-funnel.
- **Fix sketch**: Only render the prepaid-credit figure when the scan will be metered (App path: `sourceInstallId && credit`); on the public/preview path either omit the credit figure or reword to "free preview — install the App for metered live scans".

## 3. Real-scan gate ignores free monthly allowance, downgrading Free-tier private scans to preview
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/components/onboarding/canRunReal.ts:22 · src/components/onboarding/OnboardingFlow.tsx:206-213,280
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: A Free-tier org installs the App and onboards. It has 0 *purchased* credits but unused monthly free scans. `canRunRealScan` requires `credit.balance > 0`, and the `/api/org/credits` response only carries `balance`/`unlimited` (no `allowanceRemaining`), so onboarding runs a PREVIEW (mock). Yet the import route's capacity is `balance + allowanceRemaining` (route.ts:143) and `checkScanEntitlement` would have allowed a real scan against the allowance.
- **Root cause**: The onboarding "money gate" is conservatively keyed on purchased balance only, but the server's real entitlement also includes the included free allowance — the two notions of "has headroom" diverge.
- **Impact**: The highest-value activation moment (first real scan of a private repo) is silently downgraded to mock for exactly the Free-tier orgs the funnel targets; users only ever see "preview" scores despite being entitled to real ones, undercutting the value prop.
- **Fix sketch**: Have `/api/org/credits` also return `allowanceRemaining` and let `canRunRealScan` treat `unlimited || balance > 0 || allowanceRemaining > 0` as runnable (the route already refunds/handles partial shortfall once finding #1 is fixed).

## 4. Invite-by-Enter is not guarded against in-flight requests (double submission)
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/components/onboarding/OnboardingScanStep.tsx:203 · :64-66
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: On the done state (App path) the teammate-handle input fires `onKeyDown={(e) => e.key === "Enter" && invite()}`. The Invite *button* is disabled while `inviteBusy`, but the Enter path is not — `invite()` only early-returns on empty `login`/`inviteOrg` (line 65-66), not on `inviteBusy`. Mashing Enter (or Enter then click) before `setHandle("")` runs fires multiple concurrent POSTs for the same handle.
- **Root cause**: Busy/disabled state is enforced on the button's `disabled` prop only, not inside the action, so the keyboard entry point bypasses it.
- **Impact**: Duplicate `/api/org/members` POSTs; harmless if the endpoint is idempotent, but wasteful and can produce duplicate audit entries / `onInvited` double-counts (inflating the checklist invite counter).
- **Fix sketch**: Add `if (inviteBusy) return;` at the top of `invite()`, and ignore Enter while busy (`!inviteBusy && invite()`).

## 5. Capped repo rows are removed from the keyboard tab order, hiding the "limit reached" reason
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/onboarding/OnboardingSelectStep.tsx:85-91
- **Value**: impact 3 · effort 3 · risk 1
- **Scenario**: Once `selected.size >= maxSelect`, every unselected repo button gets `disabled={capped}` (plus `aria-disabled` and a `title`). A native `disabled` button is unfocusable, so a keyboard/SR user who has hit the 10-repo cap can no longer Tab onto the remaining repos to discover *why* they're greyed out — the explanatory `title`/"limit reached" text is only reachable by sighted mouse users.
- **Root cause**: Using the real `disabled` attribute (not just `aria-disabled`) to convey "at cap" trades keyboard discoverability for a visual affordance; the swap-to-select intent ("deselect one to swap") is invisible to keyboard navigation.
- **Impact**: Keyboard/SR users at the cap perceive the rest of the list as simply gone, with no path to understand the constraint — a navigation dead-end at the core selection step.
- **Fix sketch**: Drop the native `disabled` on capped rows (keep `aria-disabled` + the title), and on click of a capped row either no-op with a brief announced message or surface the cap notice in the existing live region so the constraint is conveyed to assistive tech.

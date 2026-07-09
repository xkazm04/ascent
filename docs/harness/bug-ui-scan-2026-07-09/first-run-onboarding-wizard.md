# First-Run Onboarding Wizard — bug-hunter + ui-perfectionist scan

> Context: First-Run Onboarding Wizard (group: Onboarding, Shell & AI Standard)
> Files scanned: 12
> Total: 7 findings (Critical: 0, High: 0, Medium: 5, Low: 2)

## 1. Recurring-cost disclosure ignores the free allowance the money-gate itself counts
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: money-disclosure
- **File**: src/components/onboarding/importCost.ts:26
- **Scenario**: A Free-tier org with `balance:0` but `allowanceRemaining:10` picks 10 repos. `canRunRealScan` returns `true` (canRunReal.ts:23 counts `allowanceRemaining > 0` as headroom), so a REAL scan runs — but SelectStep shows "≈40 prepaid credits/month · balance: 0 — covers under a month; autoscans pause at zero" (OnboardingSelectStep.tsx:42,162-164).
- **Root cause**: `importWatchMonthlyCredits` = `count × 4` with NO allowance netting, unlike the sibling `estimateMonthlyCredits` (credit-estimate.ts:41-45) which subtracts `allowanceRemaining`. The `credit` prop type also drops `allowanceRemaining` entirely (OnboardingSelectStep.tsx:28).
- **Impact**: Overstates cost and shows a false "pauses at zero" alarm to exactly the users the gate just qualified for free scans — scares them off the funnel. importCost.ts's documented invariant ("cost shown == cost the POST charges") is false whenever allowance > 0.
- **Fix sketch**: Thread `allowanceRemaining` into the SelectStep `credit` prop and subtract it (reuse `estimateMonthlyCredits`); suppress `underAMonth` when allowance covers the cadence.

## 2. Every scan silently commits a weekly watch — the public "free preview" hides it
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-side-effect
- **File**: src/components/onboarding/importScan.ts:78
- **Scenario**: A user scans a public handle. SelectStep reassures "Free preview — no prepaid credits are used" (OnboardingSelectStep.tsx:168-171) with no recurring-commitment copy, yet the POST hardcodes `watch:true, schedule:"weekly"` for *every* scan including previews (`startScan` never passes `watch`).
- **Root cause**: `runImportScan` has no `watch:false` path; the server still runs `setRepoWatch` + `setRepoSchedule("weekly")` under `if (watch)` (api/org/import/route.ts:242-245). The server even comments about a "watch=false public funnel" (route.ts:260) that onboarding never actually sends.
- **Impact**: Anonymous "free preview" users are silently subscribed to weekly autoscans on repos they don't own and were told carried no commitment; watchlist/schedule rows accrue undisclosed.
- **Fix sketch**: Pass `watch:false` (or a disclosed opt-in) on the preview/public path; only commit the weekly watch on the metered App path where it's disclosed.

## 3. Pick step has no focus target, so returning to step 1 drops focus to <body>
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: focus-management
- **File**: src/components/onboarding/useOnboardingFlow.ts:82
- **Scenario**: User clicks "Back" (OnboardingFlow.tsx:100), "Scan another" (OnboardingFlow.tsx:121), or a list fails and bounces to pick (useOnboardingFlow.ts:157). The phase-change effect calls `flowRef.current.querySelector("[data-step-heading]").focus()`.
- **Root cause**: SelectStep (OnboardingSelectStep.tsx:46) and ScanStep (OnboardingScanStep.tsx:102) carry `data-step-heading`, but PickStep carries none — the page `<h1>` lives outside the flow root. So focus moves nowhere and falls to `<body>` while the live region still announces "Step 1 of 3".
- **Impact**: Keyboard/SR users lose their place on every return to step one — the exact failure the wizard's own a11y machinery was built to prevent.
- **Fix sketch**: Add `data-step-heading tabIndex={-1}` to an in-flow PickStep heading (e.g. a visually-hidden or the "GitHub organization" label), matching the other two steps.

## 4. `startScan` has no in-flight guard — a double-click double-submits the import
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: double-submission
- **File**: src/components/onboarding/useOnboardingFlow.ts:247
- **Scenario**: On a fast double-click of "Scan {n} repos" (OnboardingSelectStep.tsx:127, disabled only on empty selection), both clicks land on the still-mounted button before `setPhase("scanning")` re-renders it away, invoking `startScan` twice.
- **Root cause**: No re-entrancy lock (no `if (phase === "scanning") return`, no submit ref). The second call creates a second `AbortController` and overwrites `abortRef.current` (line 256-257), orphaning the first stream — Cancel and unmount can only abort the latest.
- **Impact**: Two concurrent POSTs to `/api/org/import`; on the metered path both open a credit-reserve window (route.ts:216) before dedup-refund can cover the duplicate, and one stream becomes unstoppable.
- **Fix sketch**: Guard the entry (`if (phase !== "select") return`) or set a `submitting` ref set at the top of `startScan` and cleared in `finally`.

## 5. Immediate per-repo scan credit draw is never disclosed at the commit button
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: money-disclosure
- **File**: src/components/onboarding/OnboardingSelectStep.tsx:148
- **Scenario**: On the App path the cost line discloses only the recurring watch ("≈N credits/month"). The click itself reserves ~1 credit per repo up front (route.ts:216), so scanning 10 repos spends up to 10 credits *now* — a figure shown nowhere.
- **Root cause**: The disclosure derives only from `importWatchMonthlyCredits` (the recurring cadence); the one-time scan spend for the repos being committed is omitted, and an under-balance org silently gets the rest returned as "skipped — out of credits" on the done screen.
- **Impact**: A metered user commits an immediate credit spend they were never quoted at the decision point; the word "also" implies a prior cost that's never stated.
- **Fix sketch**: Add "This scan draws up to {selected.size} credits now" beside the recurring line, and warn when `balance < selected.size`.

## 6. Disabled "Scan" button shows no reason
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: disabled-affordance
- **File**: src/components/onboarding/OnboardingSelectStep.tsx:127
- **Scenario**: After "Clear", the "Scan 0 repos" button greys out (`disabled` + `opacity-50`) with no title, hint, or `aria` explanation of why.
- **Root cause**: Only `disabled={selected.size === 0}` is applied — no visible/announced reason, in contrast to the thoughtful `aria-disabled` + `title` "limit reached" treatment on the capped repo rows just above (lines 88-92).
- **Impact**: A user who deselects everything sees a dead button and no "select at least one repository" cue.
- **Fix sketch**: Add a `title`/inline hint ("Select at least one repository") when `selected.size === 0`, mirroring the capped-row pattern.

## 7. Invite error isn't announced and diverges from the danger token
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: visual-consistency
- **File**: src/components/onboarding/OnboardingScanStep.tsx:235
- **Scenario**: An invite failure renders `<p class="...text-orange-300">` with no `role`, while every other error in the flow uses `role="alert"` + `text-danger-soft` (OnboardingScanStep.tsx:155, OnboardingPickStep.tsx:243). The "Added as viewer" success (line 231) is likewise silent.
- **Root cause**: The invite panel hand-rolls its own error/success styling instead of reusing the flow's alert pattern and design token.
- **Impact**: SR users get no announcement of an invite failure or success, and the color drifts off the shared danger token — a small but real inconsistency on a first-run surface.
- **Fix sketch**: Add `role="alert"` and use `text-danger-soft`; wrap the success line in a polite live region (or reuse the existing `announce`).

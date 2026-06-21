> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

# First-Run Onboarding Wizard — combined bug+ui scan

## 1. No focus management or live announcement across wizard step transitions
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/onboarding/OnboardingFlow.tsx:322
- **Scenario**: A keyboard/screen-reader user clicks an installed org in `InstallationPicker` (or "List repos", or "Back"). The clicked control unmounts when `phase` flips (pick→select→scanning→done), focus silently falls back to `<body>`, and nothing is announced. The select step's `<h1>Choose repositories</h1>` is never focused and there is no live region for the pick→select transition (the only `aria-live` region lives inside `ScanStep`, so the pick→select and select→pick moves are silent).
- **Root cause**: The flow swaps whole phase subtrees on a state change but never moves focus to the new step's heading nor announces the step change — the standard multi-step-wizard requirement. `animate-phase-in` is purely visual.
- **Impact**: Screen-reader and keyboard users lose their place on every step change and get no feedback that a step advanced; the most disorienting failure mode in a guided wizard.
- **Fix sketch**: Give each step heading `tabIndex={-1}` + `ref`, and on phase change focus it (in an effect keyed on `phase`); add a shared polite live region at the flow root that announces "Step 2 of 3: Choose repositories", etc., so all transitions (not just scanning) are announced.

## 2. Installation/suggested-org load errors steal focus to the unrelated handle input
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility/error-handling
- **File**: src/components/onboarding/OnboardingPickStep.tsx:201
- **Scenario**: A user clicks an org in `InstallationPicker` or `SuggestedOrgs`; the fetch in `loadInstallationRepos`/`loadRepos` fails, so `OnboardingFlow` sets `error` and reverts `phase` to "pick". The error is rendered only inside `PickForm` (`role="alert"`), and `PickForm`'s effect `if (error) inputRef.current?.focus()` yanks focus to the *text handle input* — a control the user never interacted with — implying the typed-handle field is what failed.
- **Root cause**: A single `error` string is shared by three different entry points (installation button, suggested-org button, handle form), but the error UI and its focus-return are hard-wired to the handle form only.
- **Impact**: Confusing/misleading error attribution; keyboard focus jumps away from the picker the user actually used, with no error shown near it.
- **Fix sketch**: Render the error at the flow/pick-step level (above all three pickers), and only auto-focus the input when the error originated from a form submit (track the error source), otherwise leave focus on the activating button.

## 3. Two competing `<h1>` elements on the onboarding page
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility/semantics
- **File**: src/components/onboarding/OnboardingSelectStep.tsx:45
- **Scenario**: `onboarding/page.tsx` renders `<h1>Scan your organization</h1>` (line 60), and the active step also renders an `<h1>` ("Choose repositories" / "Scanning repositories" / "Scan complete"). Both are in the DOM at once, so the document has two top-level headings.
- **Root cause**: The page owns a page-title h1 while each step also claims h1, with no demotion of the step headings to h2.
- **Impact**: Broken heading outline; screen-reader heading navigation and SEO/landmark tooling see two document titles. Minor but a clear semantics defect for a hardened repo.
- **Fix sketch**: Demote the per-step headings (`SelectStep`, `ScanStep`, `PickStep` sub-cards) to `<h2>`/`<h3>` under the single page `<h1>`, or drop the page h1 and let the step own it.

## 4. "Scan another" leaves stale per-org state (credit / previewScan / invitedCount / announce)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: state-management
- **File**: src/components/onboarding/OnboardingFlow.tsx:377
- **Scenario**: After completing an App-path scan of org A, "Scan another" resets `phase, repos, selected, rows, error, sourceInstallId` but NOT `credit` (still `{org:"a", balance, unlimited}`), `previewScan`, `invitedCount`, `announce`, `org`, or `sourceLabel`. If the user then re-enters the *same* org A as a public handle, `credit.org === sourceLabel` is true again, so the select step shows org A's prepaid balance and "covers under a month" warning even though the public-handle path can never spend those credits (`canRunRealScan` still returns false because `sourceInstallId` is null — so no mis-billing — but the disclosure is wrong).
- **Root cause**: The reset is a hand-maintained allowlist of fields rather than a full state reset; org-scoped fields that survive can be re-matched by a same-named source.
- **Impact**: Misleading credit/cost disclosure (shows a balance and a "pauses at zero" warning for a scan that won't draw credits); residual `invitedCount`/`announce` leak across runs. No billing impact (gated by `sourceInstallId`).
- **Fix sketch**: In `onScanAnother` also clear `credit`, `previewScan` (back to true), `invitedCount`, `announce`, `org`, `sourceLabel` — or reset all wizard state via a single initializer.

## 5. Checklist "next step" is only conveyed visually — missing `aria-current`
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/onboarding/OnboardingChecklist.tsx:47
- **Scenario**: The first not-yet-done step (`nextIdx`) is highlighted with an accent border + a visual "next" pill, but the pill text is sighted-only and the list item carries no `aria-current`. A screen-reader user reading the `<ol>` gets no signal which step is the recommended next action, and the numeric/✓ status circle is `aria-hidden`, so done/undone state isn't exposed either.
- **Root cause**: Completion and "next" state are rendered as decorative styling on `aria-hidden` glyphs without programmatic equivalents.
- **Impact**: The activation checklist's core affordance (here's your next move; here's what's done) is invisible to assistive tech.
- **Fix sketch**: Add `aria-current="step"` to the next item, and convey done/undone via visible text or an `aria-label`/visually-hidden span (e.g. "Completed:" / "To do:") rather than only the `aria-hidden` ✓/number.

## 6. Persisted resume snapshot can re-enter "select" for a scan that already ran server-side
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: state-management
- **File**: src/components/onboarding/OnboardingFlow.tsx:108
- **Scenario**: The resume snapshot persists while `phase !== "done"` and is only cleared on the `done` state. If a real App-path scan begins (credits reserved/charged server-side in `/api/org/import`) and the user refreshes before the terminal `result` event, the snapshot survives and `resumeFrom` re-enters the *select* step with the same picks — inviting the user to scan again, with no indication the prior run already executed/charged on the server.
- **Root cause**: Resumability is keyed purely on the client phase; the snapshot is never invalidated when a scan was actually dispatched (no started-scan marker), so an in-flight/interrupted real scan looks identical to "never scanned".
- **Impact**: Possible duplicate scan dispatch and duplicate watch-commit / credit draw on resume after an interrupted real scan (server dedup on unchanged commit refunds mitigates, but the UX implies a fresh start). Low because the server refunds deduped runs.
- **Fix sketch**: Stamp the snapshot when a scan is dispatched (e.g. `dispatchedAt`/repos) and, on resume of a dispatched-but-unfinished run, land on a "your last scan may still be running — view dashboard / rescan" state rather than a clean select step.

# First-Run Onboarding Wizard — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 9

## 1. An `error` SSE event with a clean stream end strands the wizard on "scanning" forever
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: step-machine / scan kickoff error handling
- **File**: src/components/onboarding/OnboardingFlow.tsx:281 (with src/components/onboarding/importScan.ts:113-120)
- **Scenario**: The import route streams a terminal `event: error` (e.g. partial failure, server-side abort, credit-meter rejection mid-stream) and then closes the body normally. `runImportScan` invokes `cb.onError(...)`, the read loop sees `done`, and returns `{ ok: true }`.
- **Root cause**: `onError` (line 281) only calls `setError(message)` — it never advances or resets `phase`. Because the stream completed without a `result` event, `outcome.ok` is `true`, so the `if (!outcome.ok)` recovery branch (lines 284-291) that would `setPhase("select")` is skipped. The machine is left in `"scanning"` with no `onResult` ever firing.
- **Impact**: The user is stuck on the scanning screen indefinitely: the progress bar never reaches 100%, the "Cancel" button stays as the only action, and there is no "Scan complete" / "done" transition. The error text shows but the flow is dead — a refresh is the only escape. This is the single most likely real-world dead-end because `error` events are exactly the failure path.
- **Fix sketch**: Treat a stream that ends after an `error` event as terminal-failure. Either have `runImportScan` return `{ ok: false, message }` when it saw an `error` event before `done` (track a `sawError` flag, prefer it over `{ ok: true }`), or in `onError` also `setPhase("select")` so the user can retry. Don't leave phase on `"scanning"` when no `result` will arrive.

## 2. Credit fetch race: clicking "Scan" before credits resolve silently downgrades a paid org to a preview
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: concurrent kickoff race / preview-vs-real drift
- **File**: src/components/onboarding/OnboardingFlow.tsx:255 (race with 176-185)
- **Scenario**: On the App path, `loadInstallationRepos` lists repos and *fire-and-forgets* the `/api/org/credits` fetch (lines 176-185, comment: "must never block the repo list"). The repo list usually returns first, so the user sees the select step and can click "Scan" before the credit response lands. At that moment `credit` is still `null`.
- **Root cause**: `canRunReal = !!sourceInstallId && !!credit && credit.org === sourceLabel && (credit.unlimited || credit.balance > 0)` (line 255). With `credit === null` the expression is `false`, so `setPreviewScan(true)` and `runImportScan({ mock: true })` — a deterministic *preview* — runs even though the org actually has credits and would qualify for a real scan.
- **Impact**: A paying, App-installed org that scans quickly gets fake preview scores plus the amber "These are preview scores" banner, with no way to know a real scan was available. It only works if they happen to wait for an invisible background fetch. Non-deterministic, hard to reproduce, and it undermines the core value (real maturity numbers) at the highest-intent moment.
- **Fix sketch**: When `sourceInstallId` is set but `credit` hasn't resolved yet, either disable/spinner the Scan button until the credit probe settles, or `await` the credit lookup inside `startScan` before computing `canRunReal` (with a short timeout fallback to preview). Don't decide real-vs-preview on a value that may simply not have arrived yet.

## 3. No cross-step progress indicator or `aria-current` on the pick → select → scan machine
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: wizard step indicator / a11y
- **File**: src/components/onboarding/OnboardingFlow.tsx:319-385 (each phase renders standalone, no stepper)
- **Scenario**: The wizard has three real steps (`pick` → `select` → `scanning/done`) but renders each phase as an independent screen. There is no "Step 2 of 3" indicator, no breadcrumb, and nothing marked `aria-current="step"`. The only progress affordances are the *within-scan* bar (ScanStep) and the *post-scan* checklist — neither communicates position in the wizard itself.
- **Root cause**: The phase machine swaps whole sub-components with no shared chrome conveying "where am I / how many steps remain."
- **Impact**: Users (and screen-reader users especially) have no sense of how long the flow is or where they are; "Back" from select feels like leaving rather than stepping back one. This is a standard multi-step-wizard expectation the context explicitly calls out ("track checklist progress so a new user reaches a useful report fast").
- **Fix sketch**: Add a thin shared stepper in `Shell` (or above each phase) listing the three steps with the active one marked `aria-current="step"` and a visual fill, mapping `pick/select/scanning|done` → 1/2/3.

## 4. Focus is never moved to the new step on phase transitions (focus management gap)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / focus management
- **File**: src/components/onboarding/OnboardingFlow.tsx:339-385; src/components/onboarding/OnboardingSelectStep.tsx:43-48; src/components/onboarding/OnboardingScanStep.tsx:88-108
- **Scenario**: Moving pick → select (after clicking a repo source) and select → scanning (after "Scan") swaps the rendered content, but keyboard focus stays on the now-unmounted/previous control or falls back to `<body>`. The select and scan steps render a fresh `<h1>` but neither receives focus, and there is no live announcement of the step change (only the *scan-progress* live region in ScanStep, which doesn't fire on entry).
- **Root cause**: Only `PickForm` manages focus, and only on `error` (OnboardingPickStep.tsx:201-203). No step component focuses its heading or an `tabIndex={-1}` landmark on mount.
- **Impact**: Screen-reader and keyboard users get no signal that the step changed and lose their place; after clicking "Scan" they have no idea the scan view appeared. Inconsistent with the deliberate focus-on-error handling already present, so it reads as an oversight.
- **Fix sketch**: On each phase's mount, focus the step `<h1>` (give it `tabIndex={-1}`) or an `aria-live` heading region, so the new step title is announced and tab order resets to the top of the step.

## 5. Invite "Enter" key bypasses the busy/empty guards the button enforces
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: per-control disabled/loading consistency
- **File**: src/components/onboarding/OnboardingScanStep.tsx:202 (vs button at 207-213)
- **Scenario**: The invite input's `onKeyDown` fires `invite()` on Enter with no guard, while the Invite button is correctly `disabled={inviteBusy || !handle.trim()}`. Pressing Enter while a previous invite is in flight (or with whitespace-only input) re-enters `invite()`.
- **Root cause**: `onKeyDown={(e) => e.key === "Enter" && invite()}` (line 202) doesn't mirror the button's `inviteBusy`/empty checks. `invite()` itself guards empty (`if (!login ...) return`) but not `inviteBusy`, so a fast double-Enter can fire two concurrent POSTs to `/api/org/members`.
- **Impact**: Minor — duplicate invite POSTs and inconsistent affordance (the disabled button implies "can't submit," yet Enter can). Same-handle dedupe in `setInvited` limits visible damage, but distinct fast Enters still double-fire.
- **Fix sketch**: Guard the keydown: `e.key === "Enter" && !inviteBusy && handle.trim() && invite()`, and/or early-return in `invite()` when `inviteBusy`.

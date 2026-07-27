# First-Run Onboarding Wizard — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Transient credit-read failure silently downgrades a paying org's scan to preview, with misleading recovery copy
- **Severity**: High
- **Category**: trade-off-undocumented
- **File**: `src/components/onboarding/useOnboardingFlow.ts:179` (also `canRunReal.ts:29-30`, `OnboardingScanStep.tsx:167-170`)
- **Scenario**: On the App path, the credit read (`/api/org/credits`) is `.catch(() => null)`. If it fails transiently (network blip, 500, cold start), `startScan` awaits `creditReady`, gets `null`, `canRunRealScan` returns false, and the scan runs as a mock preview — even for an org with plenty of purchased credits. The done-screen banner then tells the user: "For live numbers, install the GitHub App and run a real scan" — but they *did* install the App and *do* have credits.
- **Root cause**: Fail-closed-to-preview is a deliberate billing safety choice (never charge on unknown balance), but the trade-off is undocumented at the UX layer: the preview banner assumes the only reasons for a preview are "no App" or "no credits", and no error/retry path exists for "balance unknown".
- **Impact**: A paying customer's first scan — the activation moment — silently produces fabricated numbers with instructions that don't apply to them. There is no signal that anything went wrong and no way to retry the credit read short of restarting the flow.
- **Fix sketch**: Track a distinct `creditUnknown` state when the fetch rejects (vs. resolves with 0/absent). Before scanning with `creditUnknown`, either retry the read once, or surface a small inline notice on the select step ("Couldn't read your credit balance — this scan will run as a free preview. Retry") and vary the done-screen preview banner copy for this cause.

## 2. Checklist marks "Set a watch schedule" done on the preview funnel where no watch was ever set
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/onboarding/OnboardingFlow.model.ts:61`
- **Scenario**: `buildChecklistSteps` returns `{ label: "Set a watch schedule", done: scanned, ... }` where `scanned = phase === "done"`. But `importScan.ts:80` only enrolls the weekly watch when an `installationId` is present — the public-handle preview funnel explicitly sends `watch:false` (by design, to avoid silently subscribing anonymous users). So the public-funnel done screen shows "Set a watch schedule ✓" for a schedule that was deliberately not created.
- **Root cause**: The checklist derivation assumes "scan done ⇒ watch committed", which was true when the POST hardcoded `watch:true`; the later watch-opt-out fix for the preview funnel changed that invariant but the checklist wasn't updated to match.
- **Impact**: The activation checklist — whose entire premise (per its header comment) is "completion derived from signals the app already has" — lies on the top-of-funnel path, and users skip the real /connect step because the wizard told them it's done. Same-file inconsistency: the App path *is* auto-watched but gets identical treatment, so neither branch's state is actually inspected.
- **Fix sketch**: Derive it from the same predicate as the POST: `done: scanned && Boolean(sourceInstallId)` (mirroring `watch = Boolean(installationId)`), keeping the `/connect` href as the next action for the preview funnel. Ideally thread the actual `watch` decision out of `runImportScan` rather than re-deriving.

## 3. "Scan another" resets only half the wizard state — stale credit snapshot and invite count leak into the second run
- **Severity**: Medium
- **Category**: edge-case-gap
- **File**: `src/components/onboarding/OnboardingFlow.tsx:139-146`
- **Scenario**: `onScanAnother` resets `repos/selected/rows/error/sourceInstallId` but not `credit`, `creditReady`, `previewScan`, or `invitedCount`. Re-picking the *same* installed org: `loadInstallationRepos` refires the credit fetch, but `startScan:264` prefers the already-settled `credit` state (`credit.org === sourceLabel` matches) — a snapshot taken *before* the first metered scan drained the balance/allowance. The cost disclosure (`SelectStep:47`) and the money-gate both run on pre-scan numbers. `invitedCount` also survives, so "Invite your team" arrives pre-checked on a run where nobody was invited.
- **Root cause**: The reset list was written for the visible per-run state (rows, selection); the money/checklist state introduced later (credit caching, ONB-1's `creditReady`, invite tracking) was never added to it.
- **Impact**: Second-run cost copy can understate the recurring charge (allowance shown as still available), and the gate can green-light a "real" scan on an org the first run just drained (server-side metering saves the money, but the user sees repos skipped "out of credits" they were just quoted as affordable). Checklist honesty degrades on repeat use.
- **Fix sketch**: Add a `resetRun()` in the hook that clears `credit`, `creditReady.current`, `previewScan`, `invitedCount`, `creditSkipped` alongside the existing resets, and have `onScanAnother` call it. Alternatively, prefer the fresh `creditReady` promise over cached `credit` state in `startScan` whenever a new load has fired.

## 4. Two `<h1>`s per page: the page title and each wizard step both render h1
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/app/onboarding/page.tsx:62` (with `OnboardingSelectStep.tsx:51`, `OnboardingScanStep.tsx:102`, `OnboardingPickStep.tsx:45`)
- **Scenario**: The server page renders `<h1>Scan your organization</h1>`; every step component then renders its own `<h1 data-step-heading>` ("Choose a source" / "Choose repositories" / "Scan complete"). Select/scan phases show two h1s in the document simultaneously; checklist and panels below use `h2`, so the outline is h1 → h1 → h2.
- **Root cause**: The step-transition focus-target work (ONB a11y #1) added headings inside the flow without reconciling against the page-level h1 the flow is nested under.
- **Impact**: Screen-reader users navigating by heading level get an ambiguous document outline (which h1 is "the page"?); WCAG best-practice / axe "page must not have multiple h1" flags. The focus-management itself is good — only the level is wrong.
- **Fix sketch**: Demote the three step headings to `<h2>` (keeping `data-step-heading`, `tabIndex={-1}`, and the sr-only treatment on pick); focus behavior and announcements are unchanged. Visual size classes stay as-is since they're explicit (`text-2xl font-bold`).

## 5. Invite-teammate input skips the wizard's own error-association and focus-ring conventions
- **Severity**: Low
- **Category**: visual-inconsistency
- **File**: `src/components/onboarding/OnboardingScanStep.tsx:214-227`
- **Scenario**: The org input in `PickForm` sets `aria-invalid` + `aria-describedby` pointing at its error, refocuses on error, and uses the shared `focus-ring` class — the established pattern in this flow. The invite input on the done screen does none of that: `inviteErr` renders as a detached `role="alert"` paragraph, the input has no `aria-invalid`/`aria-describedby`, no error refocus, and neither the input nor the Invite button carries `focus-ring` (default outline only).
- **Root cause**: The invite panel was added later (peak-motivation invite feature) and hand-rolled its form controls instead of following the conventions PickForm had already established.
- **Impact**: SR users who tab back to the input after a failed invite hear nothing about the failure; keyboard users get an inconsistent (browser-default) focus treatment on the one form that grants org access. Same wizard, two different form-error contracts.
- **Fix sketch**: Mirror PickForm: `aria-invalid={inviteErr ? true : undefined}`, `aria-describedby="invite-error"` on the input, `id="invite-error"` on the alert, focus the input when `inviteErr` lands, and add `focus-ring` to the input and button.

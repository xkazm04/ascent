# Practices, Governance & Adoption — Bug + UI Scan
> Context: Practices, Governance & Adoption (Org Dashboard & Analytics)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Fleet rollout silently drops repos past the 25-repo cap
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/app/api/practices/apply-batch/route.ts:23,76-77,107 + src/components/org/PracticeApply.tsx:38,54-74
- **Value**: impact 7 · effort 3 · risk 2
- **Scenario**: A practice has 50 gap repos. The user expands "Roll out to the fleet (50 repos)", the checkbox set defaults to all 50 (`PracticeApply.tsx:38` / select-all at :188), and clicks "Open draft PRs across 50 repos →". The route does `const batch = parsed.slice(0, MAX_BATCH)` with `MAX_BATCH = 25` and returns `{ results, attempted: 25, skipped: 25 }`. `applyBatch()` reads only `data.results` (`PracticeApply.tsx:68`) and renders 25 success rows; `skipped` is never surfaced.
- **Root cause**: The server caps the batch and reports `skipped`, but the client contract ignores it — success theater. Worse, `gapRepoRefs` is sorted by score descending, so `slice(0,25)` keeps the *highest-scoring* (least-needy) failing repos and silently drops the 25 *worst* ones — the exact repos the rollout is meant to fix.
- **Impact**: Half the fleet gets no remediation PR while the UI implies full coverage; the un-fixed (and most-deficient) repos keep failing the gate with no signal to the operator.
- **Fix sketch**: Surface `skipped` in the UI ("25 of 50 opened — 25 over the per-batch cap, re-run for the rest"), and either auto-chunk the selection client-side into ≤25 batches or disable selecting more than `MAX_BATCH`. Prefer keeping the lowest-scoring repos when truncating.

## 2. Preview can be applied to a different repo than the one previewed
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/components/org/PracticeApply.tsx:76-95,120-135
- **Scenario**: User selects repo A and clicks "Preview starter" (a network call to `/api/practices/generate`). While it is in flight the `<select>` is *not* disabled (only the preview button is, via `busy !== null`). User switches to repo B — `onChange` runs `setArtifact(null)` so the apply button hides. Then A's preview resolves and calls `setArtifact(data.artifact)` / `setOpen(true)`, re-showing the apply button with **A's** previewed artifact while `repo` now equals **B**. Clicking "Open draft PR →" posts `{ repo: B }`, opening a PR in B that can differ from the A preview the user just read (different language commands, description).
- **Root cause**: The async preview response isn't guarded against the current `repo`, and the dropdown stays interactive during the fetch — a classic stale-response race.
- **Impact**: The artifact a user reviews and approves is not necessarily the one that lands; for a customer-repo write this is a trust/correctness defect.
- **Fix sketch**: Disable the `<select>` while `busy !== null`, and/or capture `repo` at request time and ignore the response if it no longer matches current state (or store the previewed repo alongside the artifact and gate apply on equality).

## 3. Repo `<select>` has no accessible name
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/org/PracticeApply.tsx:120-135
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: The repo-picker `<select>` that controls which repo a practice PR targets has no `<label htmlFor>`, no `aria-label`, and no `aria-labelledby`. The nearby "Apply to a repo" text is a `<div>`, not a programmatic label. A screen-reader user hears only "combobox" with no purpose, on a control that drives a write to a customer repo.
- **Root cause**: Visual-only labeling (a styled `<div>` heading) instead of a programmatic association — WCAG 4.1.2 / 1.3.1.
- **Impact**: Keyboard/AT users cannot tell what the control selects; for an action that opens PRs, mis-selection risk is real.
- **Fix sketch**: Add `aria-label="Repository to apply this practice to"` (or wrap with a real `<label>`). The expand toggles (`PracticeApply.tsx:166,180`) should also carry `aria-expanded`.

## 4. Failing/green-path lists are capped (12/8) with no "+N more", contradicting the count tiles
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/app/org/[slug]/governance/page.tsx:62,102-128 + src/lib/org/governance.ts:196-197
- **Scenario**: A fleet with 30 failing repos shows the tile "Failing: 30" (`page.tsx:62`, from `g.failing = failures.length`, full count at `governance.ts:193`), but the "Failing repos" card renders only `g.failures` which is `.slice(0, 12)` (`governance.ts:196`), and "Cheapest path to green" only `.slice(0, 8)` (`:197`). There is no "showing 12 of 30" / "+18 more" affordance.
- **Root cause**: The detail lists are truncated server-side for payload size, but the truncation isn't communicated and the headline count is the untruncated total — the two read as inconsistent.
- **Impact**: Operators see a count they can't reconcile with the list ("where are the other 18 failing repos?"), eroding trust in the governance view and hiding remediable repos.
- **Fix sketch**: Add a footer like "Showing worst 12 of 30 — see Repositories for the full list" (and similar for green-path), or expose the remaining count so the cap is honest.

## 5. AI-adoption tiles colored with the maturity score scale read low adoption as alarm-red
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: visual-consistency
- **File**: src/app/org/[slug]/adoption/page.tsx:42,47
- **Scenario**: "Org AI commit share" and "AI-active contributors" are colored via `scoreHex(a.orgAiShare)` / `scoreHex(a.contributors.aiActiveShare)` — the same red→green ramp used for 0–100 *maturity scores*. An org early in AI adoption (e.g. 8% share) renders the headline number in alarm-red, the same hue used elsewhere to flag failing/error states, even though low adoption here is an expected baseline, not a defect.
- **Root cause**: Reusing the maturity-score color function for a metric whose low end is "early", not "bad" — semantic overload of the score palette.
- **Impact**: Misleads the reader into treating a normal early-adoption number as a red-alert problem; inconsistent meaning of red across the dashboard.
- **Fix sketch**: Use a neutral/sequential single-hue ramp for adoption metrics (or the BAND palette already defined at `adoption/page.tsx:13`), reserving the red→green scoreHex ramp for actual maturity scores.

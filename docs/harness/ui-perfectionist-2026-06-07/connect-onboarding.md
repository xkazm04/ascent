# UI Perfectionist — GitHub App, Connect & Onboarding

> Total: 7
> Severity: critical 0 · high 3 · medium 3 · low 1
> Scope: 4 files (GitHub App, Connect & Onboarding)

## 1. No global progress indicator on the connect page — the funnel's first step has no sense of "step 1 of N"
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/app/connect/page.tsx:38`
- **Scenario**: A brand-new workspace lands on `/connect` (the entry of the activation funnel) to install the GitHub App. The page header (`Connect GitHub` eyebrow + `Scan your private repositories`) gives a title but no positional cue, while the sibling `/onboarding` page renders a full `OnboardingChecklist` with a progress bar and a "next" badge.
- **Root cause**: `connect/page.tsx` was built as a flat document — it stacks discovery, re-sync, install CTA, and repo lists with no step model. The activation checklist component (`src/components/onboarding/OnboardingChecklist.tsx:17`) already exists and computes completion from real signals (`hasInstallation`, etc.), but connect never imports it.
- **Impact**: The connect → onboarding journey feels like two unrelated pages rather than one guided flow. The user can't tell that installing the App is step 1 of a path that leads to scanning, which weakens the activation funnel exactly where confidence matters most.
- **Fix sketch**: Render the same `OnboardingChecklist` at the top of `connect/page.tsx` (it's server-safe and already derives state from the session). At minimum, add a shared step indicator component so both `/connect` and `/onboarding` show consistent "Install → Pick → Scan" progress chrome.

## 2. Connect and onboarding headers diverge in type scale and entrance, breaking cross-page chrome consistency
- **Severity**: high
- **Category**: visual-consistency
- **File**: `src/app/connect/page.tsx:41`
- **Scenario**: Navigating between `/connect` and `/onboarding` (the two halves of the same first-run funnel). Both use the identical `SiteHeader` / `max-w-3xl px-5 py-10` shell and the same `text-[11px] uppercase tracking-[0.3em] text-accent` eyebrow, so the user expects matching page titles.
- **Root cause**: The connect H1 is `text-2xl font-bold` (`connect/page.tsx:41`) while the onboarding H1 is `text-3xl font-bold` (`src/app/onboarding/page.tsx:32`). Connect's intro wrapper uses `animate-fade-up` with `mt-1`/`mt-2` spacing; onboarding's uses `animate-fade-up mb-8` (`onboarding/page.tsx:30`). The two headers were authored independently against the same eyebrow token.
- **Impact**: Title size jumps a step between two pages in the same flow, and the bottom rhythm differs (`mb-8` vs none). It reads as a subtle layout shift, undermining the polish of the most-scrutinized funnel.
- **Fix sketch**: Pick one H1 scale (recommend `text-3xl` to match onboarding, the more prominent funnel hub) and apply it to both. Standardize the header block spacing (`mb-8`) on both pages, or extract a shared `<FunnelHeader eyebrow title body />` component so the two can't drift again.

## 3. Repo-picker error and empty states use raw `red-*`/hand-rolled cards instead of the canonical tokens/`EmptyState`
- **Severity**: high
- **Category**: design-system
- **File**: `src/components/connect/InstallationRepos.tsx:192`
- **Scenario**: The repo picker hits a fetch failure (`status: "error"`), an installation with zero accessible repos (`view.repos.length === 0`, line 196), or a filtered-to-empty result (`filtered.length === 0`, line 260). All three are core states of the repo picker the task calls out.
- **Root cause**: The error card is hand-rolled with `border-red-500/30 bg-red-500/5 text-red-300` (line 192) while the connect page's own error banner uses the design tokens `border-danger/30 bg-danger/5 text-danger-soft` (`connect/page.tsx:50`). The two empty cards (lines 198, 261) are bespoke `bg-slate-900/40` boxes that bypass the canonical `EmptyState` component (`src/components/EmptyState.tsx`), which the project mandates for notice/empty states.
- **Impact**: Error styling is inconsistent within the same connect page (raw red vs `danger` token), so a deployment that retunes `--color-danger` (`src/app/globals.css:16`) will leave this banner stranded on the old red. The empty states also lack the icon/title/action affordance `EmptyState` provides, so the "no repos" dead-end gives no visible next step (e.g. an "Adjust access on GitHub" action button).
- **Fix sketch**: Swap the error banner classes to the `danger` token triplet to match `connect/page.tsx`. Route the two empty states through `EmptyState` (icon + title + body + an action linking to the GitHub install/manage URL) so the zero-repo case offers a clear recovery action instead of plain prose.

## 4. The select-phase repo list has no individual focus-visible ring, unlike every other interactive control in the flow
- **Severity**: medium
- **Category**: polish
- **File**: `src/components/onboarding/OnboardingFlow.tsx:371`
- **Scenario**: Keyboard-navigating the most important interaction in onboarding — picking which repos to scan. Each repo is a full-width `<button>` toggle.
- **Root cause**: These row buttons rely only on `hover:border-slate-700` / `checked` border styling (lines 378-384) and omit the `focus-ring` utility that the project standardizes for visible keyboard focus (`src/app/globals.css:86`). Sibling buttons in the same component — `InstallationPicker` (line 592), `SuggestedOrgs` (line 660), the Scan/Back buttons (lines 411, 417), and the pick-form chips (line 717) — all include `focus-ring`.
- **Impact**: A keyboard or screen-reader user tabbing through the repo list gets no visible focus indicator on the primary selection control, an accessibility regression and an inconsistency with the rest of the flow.
- **Fix sketch**: Add the `focus-ring` class to the repo row button `className` (line 378). It's a one-token addition that matches the established pattern and the radius via `border-radius: inherit`.

## 5. The repo "Scan" CTA competes with the row's checkbox/schedule controls — CTA prominence is muddy in the connect picker
- **Severity**: medium
- **Category**: visual-consistency
- **File**: `src/components/connect/InstallationRepos.tsx:294`
- **Scenario**: Viewing the connect repo list, each row packs four interactive elements on one line: a `watch` checkbox label (line 294), a schedule `<select>` (line 304), and the filled accent `Scan` link (line 318), all in a `flex-wrap` row.
- **Root cause**: The row uses `gap-x-4 gap-y-2` flex-wrap (line 272) with three controls of similar visual weight crammed after the repo name. On narrow widths these wrap unpredictably, and the small `watch`/`select` controls sit immediately beside the filled accent button so the primary action doesn't read as clearly dominant. The onboarding picker, by contrast, keeps each row to a single tap-target.
- **Impact**: The primary "Scan" action lacks breathing room and the row reads as a dense control strip rather than a scannable list with one clear CTA, slowing the user's eye in the activation list.
- **Fix sketch**: Group the secondary controls (`watch` + schedule) in a sub-container with a divider or right-align the `Scan` CTA with `ml-auto`, so the filled button is visually separated as the row's primary action. Consider extracting a `RepoRow` component shared with the onboarding select row to standardize control grouping.

## 6. Mixed border-radius / panel scale between the connect cards and the onboarding panels
- **Severity**: medium
- **Category**: design-system
- **File**: `src/app/connect/page.tsx:123`
- **Scenario**: Comparing the discovery/install cards on `/connect` with the equivalent panels on `/onboarding` in the same funnel.
- **Root cause**: Connect's section/notice cards use `rounded-xl` (`connect/page.tsx:64, 123, 183`), while the onboarding panels — `InstallationPicker`, `SeededOrgBanner`, `SuggestedOrgs`, `PickForm` — all use `rounded-2xl` (`OnboardingFlow.tsx:578, 609, 643, 688`). The two pages were styled to different corner-radius scales for the same conceptual "panel."
- **Impact**: The corner radius visibly changes between the connect "Discovered from your GitHub" card and the onboarding installation card even though they present the same kind of content, a small but noticeable inconsistency in a side-by-side funnel.
- **Fix sketch**: Standardize on one panel radius (recommend `rounded-2xl` for top-level panels, `rounded-xl` for inner rows) and apply consistently across both files. Encoding this as a single `Panel`/card primitive (or a documented radius token in `globals.css`) prevents future drift.

## 7. Scan-progress percentage isn't surfaced as text; only a raw `completed/total` fraction shows
- **Severity**: low
- **Category**: polish
- **File**: `src/components/onboarding/OnboardingFlow.tsx:463`
- **Scenario**: During the scanning phase, the gradient progress bar animates while the visible label shows only `{completed}/{scanTotal}` (e.g. "3/10"). The computed `pct` (line 431) drives the bar width and the `aria-valuenow`, but is never shown to sighted users as a percentage.
- **Root cause**: `pct` is calculated and used for `width`/aria but the adjacent text node renders the fraction only (line 464). The `CapPill` in the select phase similarly shows "X/MAX selected" without a percent, so this is a consistent — but minimal — readout choice.
- **Impact**: Minor: the fraction is honest but the eased bar can read as "stuck" between updates on slow scans; a percent gives a finer-grained sense of motion. Low priority polish, not a clarity blocker.
- **Fix sketch**: Optionally append `· {pct}%` to the progress label (line 464) or animate a count-up. Purely additive — keep the fraction as the primary readout since it maps to the row list.

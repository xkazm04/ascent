# Repo Report Shell & Tabs — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

**Context-map drift confirmed**: `ReportTabBar.tsx` and `ReportSkeleton.tsx` no longer exist. The tab switcher migrated to the shared `SideNav`/`navItem` rail (`src/components/ui/SideNav.tsx`), and the skeleton was replaced by the instant `ReportMasthead` Suspense fallback in `src/app/report/[owner]/[repo]/page.tsx`. The `ReportTab` type now lives in `ReportView.tsx:20`. `ColdScanGate.tsx` is uncommitted user WIP — finding #1 is WIP-dependent and audited as-is.

## 1. Cold-scan gate silently drops the pinned commit — "Scan now" on a `@sha` permalink scans HEAD under the pinned URL
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/report/[owner]/[repo]/page.tsx:111` (and `src/components/report/ColdScanGate.tsx:14` — WIP file)
- **Scenario**: A shared permalink `/report/{owner}/{repo}@{headSha}` with no persisted snapshot renders `<ColdScanGate repo={repoRef} />`, where `repoRef` is `${owner}/${name}` — the parsed `sha` (available in scope at line 107) is discarded. The gate's copy says "No report yet for owner/name" (no sha), and clicking "Scan {repo} now" mounts `ReportClient` which scans HEAD. The browser URL still reads `…@{sha}`, so the rendered HEAD report masquerades as the pinned-commit report; re-sharing that URL propagates the mismatch.
- **Root cause**: `parseRepoParam` splits `name`/`sha`, but only `getScanReportByCommit` consumes the sha on this path; the cold fallback rebuilds the repo ref without it. Contrast with `FreshnessControl.tsx:44`, which was explicitly fixed to preserve `@headSha` for exactly this class of bug (its comment: "Re-test on a pinned permalink abandoned the historical sha").
- **Impact**: Wrong-commit report presented under a commit-pinned URL — undermines the whole "stable, shareable, pinned" contract the file's header comment promises. Low frequency (cold + pinned) but high confusion when hit.
- **Fix sketch**: Thread the sha through: `<ColdScanGate repo={sha ? `${repoRef}@${sha}` : repoRef} />` (the scan API already accepts `owner/name@sha` per FreshnessControl), or — if scanning an arbitrary historical sha isn't supported — say so in the gate copy ("This link pins {sha7}; a fresh scan will score the current HEAD") and strip `@sha` from the URL via `history.replaceState` when the scan starts. Flagged WIP-dependent: ColdScanGate.tsx is uncommitted.

## 2. The report's tab set is defined twice in ReportView — `validTabs` and `tabs` must be kept in sync by hand
- **Severity**: Medium
- **Category**: component-extraction
- **File**: `src/components/report/ReportView.tsx:134` and `:149-155`
- **Scenario**: `validTabs` (URL-param validation, line 134) and `tabs` (rendered nav labels, lines 149-155) each independently enumerate `scoring | dimensions | roadmap | sandbox` plus the conditional `contributors`, with the `showActivity` gate expressed twice in two different styles (spread-with-`as const` vs `push`). The clamp effect at line 160 then validates against `tabs` while the URL parser validates against `validTabs`.
- **Root cause**: The tab list was inlined when the old `ReportTabBar` was dissolved into SideNav; no single source of truth was extracted alongside the `ReportTab` type that did survive (line 20).
- **Impact**: Adding/removing/gating a tab requires touching two parallel lists in one 200-line component; a miss produces either a dead `?tab=` deep link (in `validTabs` but not rendered) or a rendered tab whose URL param silently resets to Scoring on refresh (in `tabs` but not `validTabs`). Invisible until someone shares a link.
- **Fix sketch**: One array `const TABS: {id: ReportTab; label: string; when?: (ctx) => boolean}[]`, filter once on `showActivity`, and derive both the id list and the nav items from it (`validTabs = tabs.map(t => t.id)`).

## 3. "confidence 85%" chip is the only header chip with no explanation, and the chips that have one use title-only tooltips
- **Severity**: Medium
- **Category**: a11y
- **File**: `src/components/report/ReportHeader.tsx:86-88` (chip row `:52-88`)
- **Scenario**: The header chip row explains the archetype (`title={ARCHETYPE_HINT[...]}` + `cursor-help`), the demo chip, and the Bedrock chip — but the confidence chip renders bare `confidence {n}%` with no title, no cursor-help, and no link. A first-time reader (the exact persona the adjacent "How scoring works →" link targets) can't tell what the number expresses (evidence coverage? model self-report? sample size) or whether 60% means "distrust this report". Meanwhile the chips that DO explain themselves rely solely on `title=`, which never fires for keyboard or touch users.
- **Root cause**: Chips were added incrementally; only some got hints, and the hint mechanism chosen (native `title`) is hover-only. Confidence is computed upstream but its meaning is recorded nowhere user-facing in this surface.
- **Impact**: The report's own credibility signal is unexplained — the one number most likely to be challenged in a shared report. Touch/keyboard users additionally lose the archetype and Bedrock-privacy explanations entirely.
- **Fix sketch**: Give the confidence chip a one-line hint (and ideally an anchor into `/about#confidence`); replace or supplement `title=` on all chips with an accessible pattern already in the codebase (visible-on-focus tooltip, or `aria-describedby` + sr-only text) so hints work for hover, focus, and touch.

## 4. Empty-state's primary "Try again" is the action guaranteed to fail when the repo genuinely can't be read
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/report/ReportClientStatus.tsx:234-241`
- **Scenario**: For a 404/private repo (`connect: true`), `Empty` renders three actions: "Try again" (primary, re-navigates to the same `/report?repo=` URL), "Private repo? Connect GitHub", and "Back home". The `connect` prop's own doc comment states "a retry with the same input can't succeed" — yet retry remains the visually primary button, ahead of the one action that can actually resolve the situation.
- **Root cause**: One `Empty` component serves both transient failures (network/timeout, where retry is right) and permanent ones (not found/private), and the action ordering/primacy doesn't branch on which class it is.
- **Impact**: The most prominent affordance in the private-repo dead end loops the visitor back into the same failure — burns a scan attempt's worth of waiting, buries the real fix, and reads as the product not understanding its own error.
- **Fix sketch**: When `connect` is true, make "Connect GitHub" the primary action and demote or drop "Try again" (or relabel it "Scan a different repo" pointing at `/?scan=1`). Retry stays primary only for the transient taxonomy (`timeout`/`interrupted`/`network` from `classifyScanAbort`).

## 5. Contributors list is hard-capped at 8 with no truncation indicator, and the magic number is undocumented
- **Severity**: Low
- **Category**: magic-number
- **File**: `src/components/report/ContributorsPanel.tsx:22` (label width `:26`)
- **Scenario**: `contributors.slice(0, 8)` renders at most 8 rows. Nothing tells the reader the list was cut — a repo with 20 sampled contributors shows 8 bars titled "Recent contributors" as if that were everyone, skewing the panel's implicit claim about the team's AI-attribution spread. The `8` carries no comment (unlike this codebase's house style, where caps like the nav badge's `99+` are reasoned inline). Secondary: the `w-40` login column truncates long logins with no `title` attribute, so the full name is unrecoverable.
- **Root cause**: A display cap added for layout economy without recording why 8, and without the "and N more" affordance the truncation implies.
- **Impact**: Mild data dishonesty on the Contributors tab (the tab only exists when this data is the point), plus an unreadable long-login edge case.
- **Fix sketch**: Name the constant (`const MAX_CONTRIBUTOR_ROWS = 8; // layout budget — sampled history rarely exceeds this`) and append a muted `+N more sampled` line when `contributors.length > 8`; add `title={c.login}` on the truncated span.

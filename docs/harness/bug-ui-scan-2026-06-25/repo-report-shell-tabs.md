# Repo Report Shell & Tabs — Bug + UI Scan
> Context: Repo Report Shell & Tabs (Reporting & Visualization)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. Pinned permalink page re-implements ReportShell — drops `id="main"` (dead skip link) and drifts width
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y / visual-consistency
- **File**: src/app/report/[owner]/[repo]/page.tsx:68 (vs src/components/report/ReportShell.tsx:12)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: A keyboard/screen-reader user lands on a shared permalink `/report/acme/widgets`, focuses the global "Skip to content" link (`layout.tsx:77`, `href="#main"`) and presses Enter — nothing happens, because this page hand-rolls `<main className="mx-auto w-full max-w-5xl px-5 py-10">` with **no `id="main"`**. Separately, the identical `ReportView` renders at `max-w-6xl` on the live `/report?repo=` route (it goes through `ReportShell`) but at `max-w-5xl` here, so the report visibly changes width when you move between a live scan and its pinned permalink.
- **Root cause**: `ReportShell` exists precisely to be the "one source of truth" for the report frame (its own doc comment warns the pages "could drift on width/padding"), yet this permalink route renders its own `SiteHeader`/`<main>`/`SiteFooter` instead of using it.
- **Impact**: Broken skip-to-content affordance on a primary, publicly-shared route (a11y regression); inconsistent content width between two views of the same report.
- **Fix sketch**: Wrap the permalink body in `<ReportShell>` (it already renders header/footer + `id="main"` + `max-w-6xl`), or at minimum add `id="main"` and align the width token. This makes the whole class of frame-drift impossible by construction.

## 2. Re-test that returns no activity data strands the user on a blank "Contributors" panel
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption / edge-case
- **File**: src/components/report/ReportView.tsx:162-176,226
- **Value**: impact 5 · effort 3 · risk 3
- **Scenario**: User opens the "Contributors" tab (it only appears when `showActivity` is true), then clicks "Re-test". The in-place re-scan keeps `ReportView` mounted and swaps in a new `report` whose `prStats.analyzed === 0` and whose only contributor is `unknown`. Now `showActivity` flips to `false`: the SideNav drops the Contributors item (no nav button is `active`) **and** the content area renders nothing — `tab` is still `"contributors"`, but `showActivity && tab === "contributors"` is false and no other branch matches. The user sees an empty panel with no selected section.
- **Root cause**: `tab` state is never reconciled against the currently-available tab set; the rendered tab list is derived from `report` but the selection isn't.
- **Impact**: Dead-end blank UI after a legitimate action; looks broken.
- **Fix sketch**: In an effect (or during render) clamp `tab` back to `"scoring"` whenever the active tab isn't in the current `tabs` list, e.g. `if (!tabs.some(t => t.id === tab)) setTab("scoring")`.

## 3. History & recommendations are never re-fetched after an in-place re-test → stale roadmap
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/components/report/ReportView.tsx:47-75
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: User clicks "Re-test"; the SSE re-scan completes and `report` updates with new scores/recommendations, but the history+recommendations effect depends only on `[repo.owner, repo.name]` (line 75), which don't change. So `recs` and `scans` keep the values fetched on first mount. The Roadmap tab keeps rendering the **old** `RecommendationTracker` items even though the fresh scan produced new recommendations, and the "What changed →"/compare affordances gate on the stale `scans` length.
- **Root cause**: The effect treats history/recs as a function of repo identity only, but a re-test changes the underlying data for the same repo (`report.scannedAt` changes while owner/name don't).
- **Impact**: Roadmap/recommendations silently disagree with the just-computed report; users act on outdated guidance.
- **Fix sketch**: Add `report.scannedAt` (or `report.overallScore`) to the dependency array so the effect re-fetches after a re-test settles.

## 4. A malformed `/api/recommendations` response is mislabeled as "Couldn't load history"
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/components/report/ReportView.tsx:50-70
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: Both endpoints are fetched with `Promise.all`, then `r.json()` (recommendations, line 65) is parsed inside the same `try`. If the recommendations payload is malformed/non-JSON — or that fetch network-fails while history was fine — the shared `catch` (lines 66-70) runs `setHistError(true)`, so the Trend panel shows "Couldn't load history — showing this scan only" even though history loaded fine. The recommendation failure itself is swallowed with no user signal.
- **Root cause**: Two independent data sources share one `try`/`catch` and one error flag (`histError`); a recs-side failure pollutes the history disposition.
- **Impact**: Misleading error copy; the genuine recs failure is invisible. Low because both hit the same origin so they usually share fate.
- **Fix sketch**: Settle the two fetches independently (`Promise.allSettled`, or separate try/catch per source) and give recommendations its own failure state instead of folding it into `histError`.

## 5. Pinned-permalink "Re-test" silently abandons the pinned commit and re-scans HEAD via full URL
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/components/report/FreshnessControl.tsx:33
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: On a server-rendered pinned report (`/report/acme/widgets@<oldSha>`, no `onRetest` callback) the control renders an `<a>` to `retestHref = /report?repo=${encodeURIComponent(report.repo.url)}&fresh=1`. This (a) uses `report.repo.url` (a full `https://github.com/...` URL) rather than the `owner/name[@sha]` form every other link in this context uses, relying on `?repo=` URL-normalization, and (b) carries no `@sha`, so "Re-test" silently navigates away from the pinned commit the user was viewing and rescans the latest HEAD — with no indication the commit changed.
- **Root cause**: The fallback href is built from `repo.url` and omits `repo.headSha`, unlike the PDF/skill links a few lines up in `ReportHeader` which preserve `@headSha`.
- **Impact**: A user comparing a specific historical commit loses the pin on re-test and may not notice they're now looking at a different commit; inconsistent repo-ref format across the feature.
- **Fix sketch**: Build the href from `${owner}/${name}${headSha ? "@"+headSha : ""}` for consistency, and decide intentionally whether re-test should re-pin the same sha or clearly signal "scanning latest" when it doesn't.

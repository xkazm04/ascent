# Repo Report Shell & Tabs — bug-hunter + ui-perfectionist scan

> Context: Repo Report Shell & Tabs (group: Reporting & Visualization)
> Files scanned: 18 (2 scoped files — ReportTabBar.tsx, ReportSkeleton.tsx — were deleted; the tab switcher migrated to SideNav)
> Total: 7 findings (Critical: 0, High: 0, Medium: 6, Low: 1)

## 1. `loading.tsx` re-defeats the documented "no skeleton blink" masthead-streaming design
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/app/report/[owner]/[repo]/loading.tsx:1
- **Scenario**: A user clicks a shared `/report/{owner}/{repo}` permalink. Next.js sees `loading.tsx` and wraps the whole segment in a Suspense boundary rendering the full-page `PageSkeleton`. Only after the page shell resolves does it swap to `ReportMasthead` (the repo-title fallback in page.tsx), then the body streams in — a two-stage skeleton→masthead→body blink.
- **Root cause**: page.tsx:70-72 explicitly documents "There is no loading.tsx for this segment: the Suspense fallback IS the instant masthead" — but a `loading.tsx` exists and re-exports `PageSkeleton`, so Next's segment-level loading UI overrides the carefully-authored inner Suspense fallback. The two contradict.
- **Impact**: The exact "full-page skeleton that blinks and then swaps" the author engineered around; a layout shift on the app's most-shared URL, and `ReportMasthead`'s `loading` branch becomes partially dead.
- **Fix sketch**: Delete `loading.tsx` (let page.tsx's inner `<Suspense fallback={<ReportMasthead loading/>}>` be the only fallback), or make `loading.tsx` render the same masthead skeleton so there's no visual discontinuity.

## 2. "Re-test" spends a scan / weekly-quota slot on a single click with no confirmation
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: destructive-action
- **File**: src/components/report/FreshnessControl.tsx:67
- **Scenario**: On a rendered report the "Re-test" pill sits next to "Export PDF" / "Onboarding skill". A single click calls `onRetest` (live view → `useReportScan.retest()` bumps `retestNonce`, forcing `fresh=1`) or navigates to `/report?repo=…&fresh=1` (permalink). `fresh=1` bypasses the report cache and forces a re-score when HEAD has moved — a multi-minute LLM run — and counts against the anonymous weekly public-scan allowance.
- **Root cause**: The cold-permalink path is guarded (ColdScanGate confirms before a first scan, per ColdScanGate.tsx), but Re-test assumes a re-scan is always cheap. It is only cheap when HEAD is unchanged (304); a moved HEAD or an exhausted quota makes a misclick irreversible.
- **Impact**: Money/quota loss — a misclick burns an anonymous user's limited free scan or triggers an unwanted multi-minute re-score; no undo.
- **Fix sketch**: Gate `onRetest`/the `fresh=1` link behind a lightweight confirm ("Re-scan HEAD? This uses one of your weekly scans"), or peek HEAD first and only prompt when the sha actually moved.

## 3. `ReportErrorBoundary` is sticky — it never resets when the report/repo changes
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/components/report/ReportErrorBoundary.tsx:20
- **Scenario**: `ReportView` throws once on a bad field for repo A. The boundary catches it and renders the "couldn't be displayed" card. The user then re-tests (same repo, good data) or the parent re-renders with a fresh report — but `state.error` persists, so `render()` keeps returning the error UI regardless of the new children. The only escape is the "Try again" button, which in ReportClient (ReportClient.tsx:46 passes no `onRetry`) falls back to `window.location.reload()`.
- **Root cause**: The class boundary has no `getDerivedStateFromProps`/`resetKeys` and no `key`, so it cannot clear its error when the underlying data that caused it is replaced. It assumes the only recovery is an explicit button press.
- **Impact**: A transient render error is stuck on screen until a full page reload, discarding in-page scan state (progress, quota banner, active tab).
- **Fix sketch**: Give the boundary a `resetKeys={[repoFull, report.scannedAt]}` and clear `error` in an update when a key changes, or key the boundary itself (`<ReportErrorBoundary key={repoFull}>`).

## 4. URL-backed tab state re-runs the server component's DB reads on every section switch of a permalink
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: performance
- **File**: src/components/report/ReportView.tsx:139
- **Scenario**: On a pinned permalink, clicking a section (Dimensions/Roadmap/…) calls `setTab` → `router.replace(`${pathname}?tab=…`, {scroll:false})`. Because `/report/[owner]/[repo]/page.tsx` is `force-dynamic` and its server component consumes `searchParams` (resolveReportOrg + the DB reads in `ReportPermalinkBody`: `getScanReportByCommit`, `getRepoPassport`, `getSkillHistory`), changing any search param — including `tab`, which the server never reads — re-executes the whole server tree per click.
- **Root cause**: Tab selection (pure client UI state) was put in `searchParams` for shareability, but on a `force-dynamic` route every `searchParams` mutation is a server round-trip; the design assumes `router.replace` is client-only.
- **Impact**: 3 redundant DB reads + a full RSC re-stream on each tab click on the app's primary surface; wasted DB load and a subtle re-render flash. (The `/report?repo=` client route is unaffected — its report is client state.)
- **Fix sketch**: Keep tab in `history.replaceState` / a hash rather than `router.replace`, or hoist the report data so the server segment doesn't re-read on a `tab`-only change (e.g. read tab in a client-only boundary and memoize the server fetch).

## 5. Section switcher is a `<nav>`, not a tabs widget — no `aria-controls`, focus move, or change announcement
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/report/ReportView.tsx:162
- **Scenario**: The section switcher renders `SideNav` → `NavItem` `<button aria-current="true">` (navItem.tsx:83), and the panels are plain `<section aria-label>` / `<div>` (ScoringTab.tsx:39, ContributorsPanel.tsx:14). A screen-reader/keyboard user activating "Roadmap" gets no `aria-controls` link to the panel, no focus move into the new content, and no live-region announcement that the view changed — the panel silently swaps while focus stays on the button.
- **Root cause**: The migration off `ReportTabBar` (ScoringTab.tsx:34-37 documents dropping the tabpanel ARIA) left a functional `nav`+`aria-current` pattern but no programmatic button→panel association or focus management for an in-place content swap.
- **Impact**: Non-visual users can't tell a section switch took effect; degraded a11y on the core product surface. (Not broken — buttons are focusable/operable — but below the tabs-pattern bar.)
- **Fix sketch**: Either adopt the WAI-ARIA tabs pattern (`role="tablist"`/`tab`/`tabpanel`, `aria-controls`, roving-tabindex arrow nav) or, keeping the nav, add `aria-controls` on each button, an `id` on each panel, and move focus (or announce via a polite live region) on switch.

## 6. Long owner/repo title has no truncation — can overflow the header on mobile
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: responsiveness
- **File**: src/components/report/ReportHeader.tsx:30
- **Scenario**: A repo at GitHub's limits (39-char owner + 100-char name) renders in the `<h1 className="mt-2 text-2xl font-bold">{repo.owner}/{repo.name}</h1>` with no `truncate`/`min-w-0`/`break-words`. In the `flex flex-wrap justify-between` header (and the identical `ReportMasthead` h1 at page.tsx:151), a very long name overflows its column or forces the freshness/export controls to wrap awkwardly on narrow screens.
- **Root cause**: The title is assumed short; neither the wrapping constraint (`min-w-0` on the flex child) nor a `truncate`/`break-all` is present, so the intrinsic width of a long slug wins.
- **Impact**: Horizontal overflow / cramped control row on mobile for long repo names; minor visual polish issue.
- **Fix sketch**: Add `min-w-0` to the title's flex column and `break-words` (or `truncate` with a `title` attr) on the `<h1>`; mirror it in `ReportMasthead`.

## 7. Permalink org resolution relies on the dormant legacy session, so an owner can't view their own private-repo report
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: authz-inconsistency
- **File**: src/app/report/[owner]/[repo]/page.tsx:27
- **Scenario**: `resolveReportOrg` gates the explicit `?org=` hint with `canReadOrg` (the ACTIVE Supabase wall, authz.ts:113 `authGateEnabled()`), but its default/fallback path uses `readableOrgForOwner(owner)` (auth.ts:336), which resolves the org purely from the **legacy** GitHub-App JWT session (`getSession().installations`). Under the active Supabase regime that legacy session is dormant, so `readableOrgForOwner` returns `"public"` for everyone — including the repo's own owner viewing `/report/{owner}/{repo}` without an `?org=` hint. `getScanReportByCommit` then finds no public-org row and returns null → the viewer hits `ColdScanGate` instead of their pinned private report.
- **Root cause**: Two authorization systems are mixed on one resolution path — the hint uses the active gate, the fallback uses the dead-code (`getSession`) gate. The design assumes the legacy installation session is still authoritative.
- **Impact**: Functional (fails safe — no disclosure): an org owner can't reach their own persisted private report via the clean permalink and is nudged into an unnecessary re-scan. (Confirmed the disclosure direction IS closed: scans-read.ts:780 refuses to serve a private repo out of the public org, and the DB read is org-scoped — so no anonymous/OG-image private leak.)
- **Fix sketch**: Resolve the readable org through the active gate (derive from `canReadOrg`/Supabase org membership) rather than `readableOrgForOwner`/`getSession`, so an authenticated member's private report resolves without needing `?org=`.

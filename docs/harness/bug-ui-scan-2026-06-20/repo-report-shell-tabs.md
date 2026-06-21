> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

# Repo Report Shell & Tabs — combined bug+ui scan

## 1. Orphaned `tabpanel` role + dangling `aria-labelledby` after the SideNav migration
- **Severity**: High
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/report/ScoringTab.tsx:40
- **Scenario**: `ReportView` switched its tab switcher from `ReportTabBar` (the real WAI-ARIA `role="tablist"`/`role="tab"` widget) to `SideNav` — a `<nav>` of `aria-current="page"` buttons (ReportView.tsx:161-163, 189). But `ScoringTab` still renders `role="tabpanel" id="report-panel-scoring" aria-labelledby="report-tab-scoring"`. `ReportTabBar` is no longer rendered anywhere (ReportView.tsx:12 imports only the `ReportTab` *type*), so the element `report-tab-scoring` does not exist in the DOM.
- **Root cause**: The tabpanel ARIA was authored for the tablist widget; the migration to SideNav left the panel-side ARIA behind. A `role="tabpanel"` with a dangling `aria-labelledby` and no associated `role="tab"`/`role="tablist"` is an incomplete/broken tabs pattern.
- **Impact**: Screen readers announce a "tab panel" that has no controlling tab and a label pointing at a missing id — confusing, and an automated a11y audit (axe/Lighthouse) flags the dangling IDREF. The other panels (roadmap/sandbox/contributors) carry NO `role="tabpanel"` at all, so the report is also inconsistent.
- **Fix sketch**: Either restore the `ReportTabBar` tablist widget, or drop the tabs ARIA from `ScoringTab` entirely (it is now a nav-driven section, not a tabpanel). If keeping SideNav, remove `role="tabpanel"`/`aria-labelledby`/`id="report-panel-scoring"` and treat each section as a labelled `<section aria-label>`; apply the same treatment uniformly across all four panels.

## 2. Stale tab selection leaves a blank content area after an in-place Re-test
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: tab-state
- **File**: src/components/report/ReportView.tsx:213,149-160
- **Scenario**: User on a report whose scan surfaced contributors selects the "Contributors" tab (`tab === "contributors"`). They click "Re-test" (FreshnessControl → `onRetest` → ReportClient bumps `retestNonce`). The new report comes back with no contributors / no PR stats (e.g. a fresh commit with only the bot, or PR analysis off), so `showActivity` becomes `false` and the "Contributors" SideNav item disappears (line 160). `ReportView` is the same instance (not remounted/keyed in ReportClient.tsx:292), so `tab` state stays `"contributors"`.
- **Root cause**: The contributors panel is gated `showActivity && tab === "contributors"` (line 213) while the other branches are not, and `tab` is never reconciled when the set of available tabs shrinks. None of the four `tab === ...` branches then match a rendered panel.
- **Impact**: The right-hand content area renders empty — a dead, contentless report body with no selected nav item — until the user manually clicks another section. Looks broken.
- **Fix sketch**: After computing `tabs`, reconcile selection: `useEffect(() => { if (!tabs.some(t => t.id === tab)) setTab("scoring"); }, [tabs, tab])`, or fall the render through to scoring when the active tab isn't in `tabs`.

## 3. Scan-error notice is not announced to assistive tech (no live region/alert role)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/report/ReportClient.tsx:262-271
- **Scenario**: The loading view has a polite live region (ReportClientStatus.tsx:128) so each phase is announced. But when the scan settles into `status: "error"` it swaps to `<Empty>` (EmptyState), whose message renders in a plain `<p>` (EmptyState.tsx:61) with no `role="alert"`/`aria-live`. A screen-reader user who heard "Asking Gemini…" then hears nothing — the spinner just silently vanishes and is replaced by static text they must hunt for.
- **Root cause**: `EmptyState` is a generic static notice; the error transition out of a live-region loading state has no announcement of its own.
- **Impact**: Screen-reader users get no notification that the scan failed (timeout/interrupted/network/quota) — a silent failure for AT.
- **Fix sketch**: Wrap the error branch in an `aria-live="assertive"` / `role="alert"` container, or add an `alert?`-style role option to `EmptyState` and use it for the scan-error path.

## 4. "Try again" after an error re-navigates to the identical URL and may not re-run the scan
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/report/ReportClientStatus.tsx:205-210
- **Scenario**: A `/report?repo=X` scan fails (network/interrupted). The `Empty` error state offers "Try again" → `href={/report?repo=X}` — the exact same URL the user is already on. Clicking a Next `<Link>` to the current URL doesn't change `searchParams`, so `ReportClient`'s effect deps `[repo, fresh, retestNonce]` are unchanged and the effect does not re-run; the failed state can persist.
- **Root cause**: The retry is modeled as navigation to an unchanged URL rather than re-triggering the scan; nothing in the dependency set changes.
- **Impact**: "Try again" can appear to do nothing after a transient failure — the user must hard-reload. Confusing dead-end on the recovery path.
- **Fix sketch**: Make the error "Try again" force a state change — append `&fresh=1` (changes `fresh` → re-runs), or surface a real retry callback through `Empty` that bumps `retestNonce` like the in-report Re-test does.

## 5. Permalink fallback to a live scan silently drops the pinned `@sha`
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/app/report/[owner]/[repo]/page.tsx:58-75
- **Scenario**: A shared permalink `/report/{owner}/{repo}@{sha}` whose snapshot isn't persisted (`pinned === null`) falls back to `<ReportClient repo={ref} />` where `ref = owner/name` — the parsed `sha` is discarded. The live scan then resolves the repo's *current* head, not the requested commit.
- **Root cause**: `parseRepoParam` extracts `sha`, but the live-scan fallback path only forwards `owner/name`; the live scanner also has no way to pin to a historical sha.
- **Impact**: A link that explicitly pinned an old commit silently shows a report for a different (current) commit, with no notice that the pinned commit couldn't be served. Misleading for a "permalink".
- **Fix sketch**: When `sha` is present but `pinned` is null, surface a small notice ("Snapshot for {sha} isn't stored — showing the latest scan") rather than silently swapping commits, or short-circuit to an explicit not-found/empty state for the pinned ref.

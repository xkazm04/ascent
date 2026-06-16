# Repo Report Shell & Tabs — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 2 / ui-perfectionist 3
> Files read: 15

## 1. Active tab can point at an unmounted panel → blank report body
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: tab state / conditional rendering
- **File**: src/components/report/ReportView.tsx:144 (and the guards at :181, :195, :203, :247)
- **Scenario**: User opens a report whose scan surfaced contributors/PR signals, so the `Contributors` tab is shown and selected. They click `Re-test` (`onRetest` → `setRetestNonce`), or a peeked/streamed re-score returns a report where `report.contributors` are all `"unknown"` and `prStats.analyzed === 0`. `showActivity` flips to `false`, the `Contributors` button disappears from the tab bar, but `tab` state is still `"contributors"`.
- **Root cause**: `const [tab, setTab] = useState<ReportTab>("scoring")` is never reconciled against the *current* `tabs` array. The contributors panel renders only under `showActivity && tab === "contributors"` (:203), so when `showActivity` is now false **and** `tab` is still `"contributors"`, none of the four panel `&&` branches match — the entire tabbed body renders nothing.
- **Impact**: The report shows header + caveats + tab bar (none highlighted) and then an empty gap before "Flagged for review"/footer. Looks broken, with no way to recover except a full reload. Same class of bug if `tabs` is ever reordered/trimmed for other reasons.
- **Fix sketch**: Derive a safe active tab: `const activeTab = tabs.some(t => t.id === tab) ? tab : "scoring";` and render against `activeTab`; or add an effect `useEffect(() => { if (!tabs.some(t => t.id === tab)) setTab("scoring"); }, [tabs, tab])`. Pass `activeTab` to both `ReportTabBar` and the panel guards.

## 2. Skeleton→report layout shift: narrow `max-w-md` fallback under a `max-w-5xl` report
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: loading layout shift
- **File**: src/app/report/page.tsx:19 and src/app/report/[owner]/[repo]/page.tsx:74 (with src/components/report/ReportSkeleton.tsx)
- **Scenario**: First paint / slow hydration shows `<div className="mx-auto w-full max-w-md py-12"><ReportSkeleton /></div>` — a narrow, centered, ~448px silhouette of a single score+bars stack. When `ReportView` hydrates it expands to the full `max-w-5xl` (1024px) multi-column report (header row, tab bar, grid cards). The visible content jumps from a centered narrow column to a full-width layout.
- **Root cause**: The Suspense/loading skeleton was sized for the old "Loading…" affordance (`max-w-md`) and never matched the real report's width or structure (no header silhouette, no tab-bar placeholder). The reused `Loading` view (ReportClientStatus.tsx:122) compounds this with its own `max-w-md` wrapper.
- **Impact**: Noticeable content reflow / CLS on every cold report load; the page "snaps" wider, undermining the comment's stated goal of showing the report's silhouette on first paint.
- **Fix sketch**: Render the skeleton at the report's real width (`max-w-5xl`, same `px-5` rhythm) and include a header-row + tab-bar placeholder so the silhouette occupies the same footprint the loaded report will. Keep the narrow variant only for the inline live-scan checklist if desired.

## 3. Inactive tabs carry `aria-controls` pointing at panels that aren't in the DOM
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: tab bar a11y (ARIA tabs pattern)
- **File**: src/components/report/ReportTabBar.tsx:55
- **Scenario**: Only the active panel is mounted (ReportView renders one `role="tabpanel"` at a time). Every tab button always sets `aria-controls={`report-panel-${t.id}`}`, so the three inactive tabs reference `report-panel-roadmap`, `report-panel-sandbox`, etc. — ids that do not exist in the document at that moment.
- **Root cause**: The component's own JSDoc claims "aria-controls references whichever panel is currently rendered," but the attribute is emitted unconditionally for all tabs while the panels are conditionally mounted. AT following an inactive tab's `aria-controls` lands on nothing (dangling IDREF); some screen readers announce the relationship as broken or skip it.
- **Impact**: Screen-reader users on inactive tabs get a broken/empty panel association; fails strict ARIA validation (idref must resolve). The roving-tabindex/keyboard parts are otherwise correct, so this is the one real gap in an otherwise solid tabs implementation.
- **Fix sketch**: Mount all four panels and toggle visibility with `hidden`/CSS so every `aria-controls` resolves (also lets the browser keep panel state). If single-mount is required, only set `aria-controls` on the active tab and drop it (or point it at the live panel) on inactive ones.

## 4. Error boundary "Try again" re-renders the same failing children → instant re-crash
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: error boundary correctness
- **File**: src/components/report/ReportErrorBoundary.tsx:31 (used at ReportView wrap, e.g. ReportClient.tsx:281 and [repo]/page.tsx:70)
- **Scenario**: A pinned/persisted report contains one field that slips past `parseScanReport` and throws during `ReportView` render. The boundary catches it. In the **server-pinned** path (`[owner]/[repo]/page.tsx:70`) and the **stale-salvage** path, `ReportErrorBoundary` is mounted with **no `onRetry`**, so `handleRetry` clears `state.error` and calls `window.location.reload()`.
- **Root cause**: For the pinned permalink the data is deterministic server-rendered output — reloading re-renders the identical bad `report`, so the boundary catches again immediately. "Try again" is an infinite-retry-on-identical-input loop; the only useful escape (re-scan fresh) isn't offered here.
- **Impact**: On a genuinely malformed persisted report the user is stuck in a reload→crash→reload cycle with no actionable exit. (The live ReportClient path is fine: its `onRetest` re-runs the SSE scan, producing different data.)
- **Fix sketch**: When no `onRetry` is supplied, don't reload — render a terminal CTA ("Scan this repo fresh" → `/report?repo=…&fresh=1`, and "Scan another repo" → `/`) plus the `error.digest`-style reference, mirroring the route-level `error.tsx`. Reserve `reset/reload` for cases where retrying can plausibly yield different data.

## 5. Freshness "Scanned … ago" ticker drifts on tab-visibility throttling and never realigns to wall clock
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: freshness control UX
- **File**: src/components/report/FreshnessControl.tsx:17
- **Scenario**: `setInterval(… , 30_000)` is the only re-render trigger. Browsers throttle/suspend timers in background tabs, and `freshness()` (lib/ui.ts:178) recomputes from `Date.now()` only when the component re-renders. After the tab is backgrounded for minutes, the chip can read a stale "4m ago" until the next fire, and the 30s cadence is coarse relative to the "just now"→"1m ago" boundary at 45s.
- **Root cause**: Re-render is tied to an interval tick rather than to actual elapsed wall-clock time or a visibility change; there's no `visibilitychange` re-sync, and the 30s period straddles the 45s "just now" cutoff so the first transition can lag ~30s.
- **Impact**: The freshness label — the control's entire reason to exist — can lie by up to a tick after backgrounding, the exact situation (returning to a long-open report) where users check it. Cosmetic but undercuts the "stays honest without a reload" promise.
- **Fix sketch**: Re-sync on focus/visibility: add a `visibilitychange`/`focus` listener that bumps the tick, and consider a shorter early cadence (e.g. 15s) so the "just now"→"1m" transition lands on time. No data fetch needed — just force a recompute when the user is actually looking.

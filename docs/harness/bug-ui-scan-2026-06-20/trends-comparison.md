> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

# Trends & Comparison — combined bug+ui scan

## 1. Trajectory forecast ignores the range toggle, contradicting the chart beside it
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: data-presentation-consistency
- **File**: src/app/trends/page.tsx:115
- **Scenario**: Open `/trends?repo=owner/repo` for a repo with months of history. The `forecast` (and the `Trajectory` "GPS" card it renders) is computed once, server-side, over the full 60-scan history. Below it, `DimensionTrends` renders an "Overall maturity" line chart that DOES slice by the 5d/30d/90d/All `RangeToggle`. Switch the toggle to "5d": the line chart narrows to the last 5 days, but the Trajectory card directly above keeps showing a slope/ETA fit over the entire history, with no label scoping it.
- **Root cause**: The forecast is a server prop computed before any client range exists; the range toggle lives entirely inside the client `DimensionTrends` and only re-slices the chart series. Two adjacent visualizations of "the trend" silently use different windows.
- **Impact**: A user reading "Climbing at +2.1/wk" beside a 5-day chart that looks flat (or vice-versa) gets contradictory signals from the same panel — erodes trust in the forecast.
- **Fix sketch**: Either label the Trajectory card explicitly ("fit over full history") so the scope is unambiguous, or move the forecast computation client-side (it's a pure function already imported as `forecastTrajectory`) and recompute it from `withinRange(history.scans, days)` so it tracks the active toggle.

## 2. /report/compare has no loading.tsx — blank await on navigation
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: loading-state
- **File**: src/app/report/compare/page.tsx:49
- **Scenario**: Navigate to `/report/compare?repo=owner/repo`. The server component awaits `getSessionState`, `readableOrgForOwner`, and `getScanComparison` (which loads two full ComparableScans + the whole scan list). During that round-trip the user sees a blank page / spinner-less stall. The sibling `/trends` route was given `src/app/trends/loading.tsx` (a skeleton silhouette, commented "RT#4"); compare was missed.
- **Root cause**: App Router only shows an instant skeleton when a `loading.tsx` exists for the route segment. The compare segment has none, so the streamed boundary falls through to a blank await.
- **Impact**: Inconsistent perceived performance vs the trends page; on a cold DSQL connection the compare page can stall visibly with no affordance.
- **Fix sketch**: Add `src/app/report/compare/loading.tsx` mirroring the compare layout (header row + picker bar + a couple of "What changed" card silhouettes), matching the existing `trends/loading.tsx` pattern.

## 3. Expired session turns "Export CSV" into a raw JSON 401 page
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / error-UX
- **File**: src/app/trends/page.tsx:145 (link) → src/app/api/history/route.ts:84
- **Scenario**: A user sits on `/trends` long enough for their Supabase session to expire, then clicks the "Export CSV ↓" anchor. It's a plain `<a href="/api/history?...&format=csv">`, so the browser navigates the top-level document to the API. With auth configured and no valid session, the route returns `NextResponse.json({ error: "Sign in to view history." }, { status: 401 })` — no `content-disposition`, no HTML. The browser replaces the trends page with rendered JSON `{"error":"Sign in to view history."}` and no download occurs.
- **Root cause**: The CSV export is a full-document navigation to an auth-gated JSON-erroring endpoint; the 401 (and the 503/500 branches) returns JSON, not a download or a redirect to sign-in.
- **Impact**: Confusing dead-end — the user loses their place on the trends page and lands on raw JSON instead of being prompted to re-auth. Data isn't lost, but the export silently fails into a broken-looking state.
- **Fix sketch**: Fetch the CSV via JS (client handler) and surface a re-auth toast on 401, or have the export branch return a 303 redirect to the sign-in flow (`/api/auth/login?next=…`) for navigations rather than a JSON 401; at minimum keep the user on a friendly page.

## 4. "All" range silently caps at the 60 newest scans
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: truthful-labeling
- **File**: src/app/trends/page.tsx:92 → src/components/report/DimensionTrends.tsx:41
- **Scenario**: A repo with >60 stored scans is opened on `/trends`. The server fetches `limit: 60`; the client dim lazy-load mirrors it with `limit = history.scans.length` (also 60). Selecting the "All" range and reading the header "N scans shown" reports at most 60, even though more history exists (the CSV export, by contrast, fetches up to 200). Nothing tells the user the chart/header is truncated to the newest 60.
- **Root cause**: The page's `limit: 60` is treated as "all" by the UI; the "All" toggle removes the date filter but not the row cap, and no copy distinguishes "all stored scans" from "the newest 60".
- **Impact**: A long-lived repo's earliest history is invisible on the trend page with no indication, while the CSV (200) and any future viewer disagree on what "All" means.
- **Fix sketch**: When `history.scans.length === 60` (the cap), append a hint to the "All" label or header ("newest 60") — or align the page limit with the CSV's 200 — so "All" is honest about the window.

## 5. Per-dimension breakdown can render 8 empty "—" cards as a successful "done" state
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: empty-state
- **File**: src/components/report/DimensionTrends.tsx:34-51, 152
- **Scenario**: The "By dimension" lazy-load fetches `/api/history` and runs the body through `parseRepositoryHistory`. If the body drifts such that every scan is dropped (e.g. all points fail the score/date guard) or all dimension rows are malformed, `parseRepositoryHistory` returns `{ scans: [] }` (by design it never throws). `setDimState("done")` still fires, so the grid renders all 8 dimension cards with `current === undefined` → "—" and empty `DimLine`s, presented as a completed breakdown — even though the overall chart above shows real points.
- **Root cause**: `loadDimensions` treats any non-throwing parse as success; it doesn't distinguish "loaded, but coercion emptied the series" from "loaded with data", so a degraded/empty parse masquerades as `done`.
- **Impact**: Silent data loss in the per-dimension view — the section looks intact (8 cards) but conveys nothing, with no error/retry, while the overall trend proves data exists.
- **Fix sketch**: After parsing, if `full.scans.length === 0` (or no dimension has any non-null point) while the overall series is non-empty, set `dimState` to `"error"` (reusing the existing Retry empty state) instead of `"done"`, so the mismatch surfaces an actionable state.

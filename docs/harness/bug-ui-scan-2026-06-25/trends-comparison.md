# Trends & Comparison — Bug + UI Scan
> Context: Trends & Comparison (Reporting & Visualization)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

This is a polished, well-tested context (compare.ts has an extensive unit suite; charts route every score through the NaN-guarded `vScale`/`xScale`; `parseRepositoryHistory` is a careful trust boundary). The findings below are mostly interaction-model / a11y gaps in the chart components, not logic defects in the diff engine.

## 1. Chart deep-link navigation is keyboard/SR-inaccessible; SVGs are role="img" yet clickable
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/report/TrendChart.tsx:139-148 ; src/components/report/DimLine.tsx:82-94
- **Value**: impact 6 · effort 5 · risk 3
- **Scenario**: A keyboard-only or screen-reader user lands on /trends. Each trend point deep-links to that scan's pinned report (plain click) and shift-click opens the GitHub commit. But the `<svg>` is declared `role="img"` and only wires `onPointerMove`/`onClick` — there is no `tabIndex`, no `role="button"`/`link`, and no `onKeyDown`. The element can never receive focus, so the entire "click a dot → open that scan" investigation loop is mouse-only. The sr-only `<table>` (TrendChart:251) exposes the *values* but none of the per-point links.
- **Root cause**: The charts were designed as a static `img` with a pointer-only enhancement layered on top; the deep-link feature was added to `onClick` without promoting the element to an interactive role or adding a keyboard path.
- **Impact**: WCAG 2.1.1 (Keyboard) + 4.1.2 (Name/Role/Value) failure; a core navigation affordance of the trends/dimension views is unreachable for keyboard and AT users.
- **Fix sketch**: Make each linked point a real focusable control — e.g. render an overlaid `<a href={point.href}>` per point (with the commit URL behind a secondary control), or give the svg `role="group"` and add focusable `<a>`/`<button>` children. At minimum, when a point is "active", expose its report link in the sr-only table as an `<a>` so the same target is reachable without a pointer.

## 2. On touch, tapping a chart to inspect a point immediately navigates away
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: mobile
- **File**: src/components/report/TrendChart.tsx:143-148 ; src/components/report/DimLine.tsx:89-94
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: On a phone, a tap fires `onPointerMove` (which sets the nearest point "active" and shows the tooltip) and then `onClick`. Because `activeHref` is now set, the same tap calls `router.push(activeHref)` and the user is whisked to that scan's report. There is no way on touch to *just read* a point's score/delta tooltip — every tap is also a commit to navigate.
- **Root cause**: The "click anywhere on the plot opens the hovered point" model (a deliberate large-hit-target choice for desktop hover→click) conflates inspect and navigate; on touch there is no separate hover phase, so the first interaction both selects and activates.
- **Impact**: Mobile users can't explore the trend without accidental navigation; the tooltip is effectively unusable on touch, degrading the primary mobile UX of the trends/dimension panels.
- **Fix sketch**: Distinguish a "reveal tooltip" tap from a "navigate" tap — e.g. require a second tap on an already-active point to navigate (tap-to-reveal, tap-again-to-open), or gate navigation to non-coarse pointers (`matchMedia('(pointer: fine)')`) and render an explicit "Open report →" link inside the tooltip for touch.

## 3. ScanComparePicker uses router.replace, contradicting its documented "back button works"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/report/ScanComparePicker.tsx:39-42 (see header comment lines 4-7)
- **Value**: impact 4 · effort 2 · risk 2
- **Scenario**: The component header states selection "lives entirely in the URL … so the panel is shareable and the back button works." But `go()` calls `router.replace`, which overwrites the current history entry instead of pushing one. A user who changes the baseline, then the compared scan, then the swap, and presses Back does *not* step back through those selections — Back jumps straight to whatever page preceded /report/compare. The stated "back button works" behaviour is silently absent.
- **Root cause**: `replace` was chosen (likely to avoid history spam) but the documented intent — undoable selection steps — requires `push`.
- **Impact**: Lost undo affordance for comparison selections; the documented behaviour and the code disagree, which will mislead the next maintainer. (Sharing still works; only Back/Forward stepping is broken.)
- **Fix sketch**: Switch `router.replace` to `router.push` so each (after, before) pair is its own history entry; or, if history-spam avoidance was the real goal, correct the header comment to say selections are not individually undoable.

## 4. "By dimension" scan-count label is taken from the overall series, not the per-dimension series actually plotted
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/components/report/DimensionTrends.tsx:150 (label) vs 97-117 (plotted rows)
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: The "By dimension" heading renders `{overallChrono.length} scans` — derived from the lightweight overall series the server passed. The small-multiples below plot `dimChrono`, which comes from the separately lazy-loaded `/api/history` payload (`full`). If a new scan lands between the SSR render and the client dim-fetch (or the DB clamps the limit differently), `full.scans.length` differs from `history.scans.length`, so the label overstates/understates the number of points actually drawn — the same class of "label vs. data" drift the `loadDimensions` comment (lines 38-42) tried to eliminate by aligning limits.
- **Root cause**: The count label reads from the overall series for first-paint convenience, but the dimension grid renders from a different, later-fetched dataset; the two are only *usually* the same length.
- **Impact**: Cosmetic-to-misleading count in a data view whose whole purpose is accuracy; low because the windows align in the common case.
- **Fix sketch**: Source the "By dimension" count from `dimChrono.length` (the series actually plotted) once `dimState === "done"`, falling back to the overall count only while loading.

## 5. withinRange retains points with an unparseable scannedAt in every range window
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/components/report/DimensionTrendsRange.tsx:18-21
- **Value**: impact 2 · effort 2 · risk 2
- **Scenario**: `withinRange` returns `true` for any scan whose `Date.parse(scannedAt)` is `NaN`, so a date-corrupt point is kept regardless of the active "5d/30d/90d" filter — the user cannot narrow it out of view. Such a point then renders as a dot whose x-axis label is blank (TrendChart `shortDate`/DimLine return `""` for NaN dates), and its tooltip date is empty — a floating, unplaceable point that also can't be excluded by tightening the range.
- **Root cause**: The "don't silently drop on NaN" guard is reasonable for the *all* view but wrong for a *time-windowed* view, where an undateable point has, by definition, no place in a date window.
- **Impact**: A rare malformed point sticks in every range and plots without a date label; minor because production DB timestamps are normally valid and `parseRepositoryHistory` already drops NaN-date points from API payloads (so this only bites the SSR-fed series or future drift).
- **Fix sketch**: When a `days` window is active, exclude NaN-date points (`return Number.isNaN(t) ? false : t >= cutoff`); keep the "keep all" behaviour only for `days === null`.

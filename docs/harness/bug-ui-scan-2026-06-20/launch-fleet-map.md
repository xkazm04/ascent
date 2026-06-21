> Total: 6 findings (0 critical, 1 high, 3 medium, 2 low)

# Launch Fleet Map — combined bug+ui scan

## 1. Manual scan repaints the score but leaves the 30-day "mover" ring/tooltip stale
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: data-consistency
- **File**: src/components/launch/applyScanEvent.ts:26
- **Scenario**: A user clicks "Scan" on an org. `applyScanEvent` lands the fresh `overall`/`level` on each repo star via `{ ...r, overall, level }`, but it never touches `dOverall`. The `dOverall` value still carries the 30-day delta that `/api/app/repos` computed against the OLD baseline (`getOrgMovers`). So a repo that just jumped from 40→70 in this scan keeps its pre-scan ring (e.g. a green "+2 30d" ring) drawn against a now-70 score — and `ConstellationField` even renders the directional ring/`+N 30d` tooltip (lines 134–137) off this stale delta. The new score and the movement indicator disagree until the next 90s `mergeStars` refresh re-pulls `dOverall`.
- **Root cause**: `applyScanEvent` treats `dOverall` as immutable, but the manual-scan score change is exactly the kind of movement `dOverall` is meant to represent; the SSE `repo` event (route.ts:151–158) carries no delta, so the field is silently left inconsistent with the just-painted score.
- **Impact**: Misleading movers overlay — a star can show a green "rising" ring while its score actually fell this scan (or vice-versa) for up to ~90s; the header `▲risers ▼fallers` Stat is likewise stale relative to the visible scores.
- **Fix sketch**: On a successful `repo` apply, recompute/neutralize the delta: set `dOverall` to `null` (suppress the ring until a real delta is re-fetched) or, if the prior `overall` is known, derive `dOverall = overall - prevOverall`. At minimum clear the ring when the score the ring is drawn against has changed.

## 2. Constellation SVG aria-label is wrong while loading and undercounts large orgs
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/launch/ConstellationField.tsx:89
- **Scenario**: The SVG `aria-label` is built from `repos.length`. But `repos` is `[]` for every non-`done` constellation (line 33), so while an org is charting, a screen reader announces "<org> constellation — 0 repositories" even though the org may have dozens. Conversely, when `status === "done"` with more than `MAX_STARS` (80) repos, `repos` is sliced to 80, so a 120-repo org announces "80 repositories" while the visible card footer correctly says "+40 more stars".
- **Root cause**: The label reuses the rendering-capped/empty `repos` array instead of the true count (`total` / `c.repos.length`), conflating "stars drawn" with "repositories in the org".
- **Impact**: Screen-reader users get a count that is either 0 (during load/error) or capped (large orgs), undermining the very link-exposing `role="group"` decision this component was hardened for.
- **Fix sketch**: Label from the true total and reflect status, e.g. `status === "done" ? `${total} repositories` : status === "loading" ? "charting…" : "unreachable"`; keep the singular/plural branch on `total`.

## 3. SSE scores for repos absent from the initial repo list are silently dropped
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/launch/applyScanEvent.ts:28
- **Scenario**: `applyScanEvent` only updates a star whose `fullName` already exists in `c.repos` (it maps over the existing array). `/api/org/scan` scans every *watched* repo (route.ts:34), while `/api/app/repos` lists installation-visible repos with a sort+merge. If a watched repo is not present in the map's seeded star set (e.g. access changed, or the lists diverge), its streamed `repo` event matches nothing and is a no-op — the scan's `result` reports it as "scanned" but no star ever brightens for it.
- **Root cause**: The apply step assumes the streamed repo set is a subset of the seeded set; there is no "append a new star" branch, so any out-of-set result vanishes.
- **Impact**: The map can under-report a scan ("scanned N" header climbs but fewer stars light), with no visible error — exactly the silent-failure class this file's own header warns against.
- **Fix sketch**: When no matching `fullName` is found inside the `done` org, append a new `RepoStar` (`{ fullName, name: fullName, private:false, overall, level, dOverall:null, watched:true }`) so streamed-but-unseeded results still surface.

## 4. Loading/error constellations expose no labelled status to assistive tech inside the SVG
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/launch/ConstellationField.tsx:111
- **Scenario**: While loading, the SVG renders only anonymous skeleton `<circle>`s (lines 112–120) and a decorative org core; the textual "charting…"/"unreachable" status lives in a separate `<div>` (lines 56–58) that is not associated with the map region, and combined with finding #2 the SVG itself announces "0 repositories". There is no `aria-busy`/live association tying the chart region to its loading or error state.
- **Root cause**: Status text is visual-only and the SVG's own label doesn't reflect non-`done` states, so the interactive map region reads as an empty, static group during the most state-changing moment.
- **Impact**: A screen-reader user cannot tell a charting org from an empty one, or learn that an org is "unreachable", from the map region itself.
- **Fix sketch**: Add `aria-busy={c.status === "loading"}` to the SVG and fold the status into its `aria-label` (see #2), or wrap the chart in a labelled region with `role="status"` for the loading/error text.

## 5. Unscanned repo stars link to a report that doesn't exist yet
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: ux
- **File**: src/components/launch/ConstellationField.tsx:144
- **Scenario**: Every `done`-org star renders an `<a href={reportPermalink(r.fullName)}>` regardless of scan state. A faint, never-scanned star (`overall == null`, tooltip "· not scanned") is still a live link to `/report/{owner}/{repo}`, which has no scan to show — clicking/activating it navigates to an empty/placeholder report.
- **Root cause**: The "a star is a link to its report" metaphor is applied uniformly, ignoring that an unscanned repo has no report destination.
- **Impact**: Dead-end navigation from the most prominent CTA-shaped affordance on the map; minor confusion, no data loss.
- **Fix sketch**: For `overall == null`, drop the `<a>` wrapper (render the bare `<circle>` with its `<title>`), or point the link at the org/connect scan flow instead of an empty report.

## 6. Stale fetch results can overwrite a constellation after the installation set changes
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/launch/FleetMap.tsx:38
- **Scenario**: `constellations` is lazy-initialized from `installations` once; the initial fetch effect (lines 80–107) and the 90s refresh (lines 112–140) both key updates by `inst.id`. If the `installations` prop ever changes after mount (e.g. an org is added/removed and the page re-renders without a full remount), the state is not reseeded — the effect's `controller.abort()` cancels in-flight fetches but the existing `constellations` array keeps the removed orgs and never adds the new ones (`setConstellations` only maps over current entries, never inserts).
- **Root cause**: State is derived from props exactly once; there is no reconciliation of `constellations` against a changed `installations` set.
- **Impact**: Rare in practice (the page is server-rendered per navigation, so the prop is usually stable), but a soft-navigation that swaps installations would leave a stale grid. No crash.
- **Fix sketch**: Reseed when the installation id-set changes — e.g. a `useEffect` keyed on a stable `installations` signature that rebuilds the `constellations` skeleton for added/removed orgs (preserving `done` data for surviving ids).

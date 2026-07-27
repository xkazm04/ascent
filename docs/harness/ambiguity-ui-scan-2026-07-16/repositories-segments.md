# Repositories & Segments — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

## 1. Leaderboard selection survives posture-filter navigation — bulk-add tags repos the user can no longer see
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/components/org/repositories/RepoLeaderboard.tsx:51`
- **Scenario**: `selected` is a `Set<string>` of fullNames that is never pruned when the `rows` prop changes. The posture chips (`page.tsx:122-141`) navigate with `router.push`-style `<Link>`s that re-render the server page but keep this client component mounted at the same tree position, so its state persists. Tick "select all" under `?posture=at-risk` (say 12 rows), click another chip (or "All"), tick a few more — the sticky bar now says "N selected" where N includes repos not present in the current table, and "Add" bulk-tags all of them. Inversely, `allSelected` (`selected.size === rows.length`) can be true-by-coincidence or never-true when stale names inflate the set, so the header checkbox misreports.
- **Root cause**: Selection state is deliberately keyed by fullName so *sorting* doesn't disturb it (documented at line 57-59), but the same reasoning was silently extended to *row-set changes* (posture/stack filter navigation), which was never decided — there's no effect reconciling `selected` against `rows`.
- **Impact**: Hidden writes: repos outside the visible, filtered set get tagged into a segment, which then silently skews the Overview segment filter and segment-vs-segment comparison. The user has no way to see what they're about to tag.
- **Fix sketch**: Prune on row change: `useEffect(() => setSelected(s => new Set([...s].filter(fn => rowNames.has(fn)))), [rows])` (or intersect at `addToSegment` time and report the intersection count). Alternatively key the component by the filter (`<RepoLeaderboard key={posture ?? "all"} …>`) to reset selection on scope change.

## 2. "Scan segment (N)" counts tagged repos, but the server scans only the *watched* intersection
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/components/org/repositories/SegmentActions.tsx:55`
- **Scenario**: `repos` passed to `SegmentActions` is every fullName tagged into the segment (`SegmentsSection.tsx:77-79`, inverted from `getRepoSegmentMap`, which has no watched filter). The button renders `Scan segment (7)` and seeds `ScanState.total = repos.length`. But `POST /api/org/scan` intersects `body.repos` with `listWatchedRepos(org)` (`scan/route.ts:46-53`), so unwatched tagged repos are silently dropped. With 7 tagged / 3 watched the button promises 7, briefly shows "Scanning 0/7…", then the SSE `total` snaps to 3. If *none* are watched, the user gets the actively misleading error "No watched repositories matched the scan scope (they may all be fresh)." Note the adjacent SegmentCard shows a *third* count (`repoCount` from the rollup's `watched OR has-scans` rows), so one card can display three different numbers for "this segment's repos."
- **Root cause**: Three layers each define "the segment's repos" differently (all tags / rollup rows / watched only) and the divergence is only documented in the tooltip's fine print ("Scan the watched repos in this segment"), not in the count or the progress math.
- **Impact**: The primary action's label overstates what it will do; the mid-flight total jump and the "may all be fresh" error erode trust in the whole segments surface.
- **Fix sketch**: Pass watched-ness down (the rollup rows already carry `watched`) and render `Scan segment (3 of 7 watched)`; seed `total` with the watched count and disable with an explanatory title when it's 0.

## 3. "Export CSV" silently ignores the active posture/stack filters it sits next to
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/app/org/[slug]/repositories/page.tsx:111`
- **Scenario**: The Export CSV link lives inside the same `SectionHeader` as the TechStackSelector and directly above the posture chips, but always hits `/api/org/repositories?org=…&format=csv`, which calls `getOrgRollup(org)` unscoped (`repositories/route.ts:23`). A user who filters to "At risk" + a stack group and clicks Export gets the entire fleet. The decision is recorded only as a code comment ("Tagging … and CSV stay full-fleet", page.tsx:71) — nothing in the UI says so, and the route's own header comment claims "the export reflects exactly what the Repositories tab shows," which is now false whenever a filter is active. The CSV also omits segment membership entirely, though segments are this page's organizing concept.
- **Root cause**: The posture/stack filters were added to the page after the export existed; the full-fleet trade-off was decided in a comment, not in the interface, and the route was never taught the same query params the page understands.
- **Impact**: "Send my boss the fleet" exports contradict the on-screen numbers (e.g. header says "12 of 80 repos in At risk", the file has 80 rows), a classic silent data-mismatch that gets discovered downstream in a spreadsheet.
- **Fix sketch**: Thread `posture`/`stack` (and optionally `segment`) through to the route and filter the rollup the same way the page does; until then, label the button "Export CSV (full fleet)" or append the active scope to the href. Add a `segments` column (`;`-joined names) from `getRepoSegmentMap`.

## 4. An unscanned/empty segment renders score "0" as if it were a real (terrible) score
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/org/repositories/SegmentsSection.tsx:33`
- **Scenario**: `summarizeSegmentFromRepos` (`segments.ts:259-271`) reduces a segment with zero scanned repos to `avgOverall: 0`, `posture: postureFor(0,0).id`. SegmentCard then renders a big `0` colored by `scoreHex(0)` (the worst-score red), a level chip for score 0, and an uppercase posture label — visually indistinguishable from a genuinely rock-bottom segment. The comparison tiles do the same (`b.avgOverall === 0` for an empty B side yields "Δ +87" against a healthy A). Only the small "0/3 scanned" line hints at the truth. The test suite even pins the 0 (`segments.test.ts:593-607`) as "a ZERO rollup" — the sentinel-vs-score ambiguity is baked in.
- **Root cause**: `0` is overloaded as both "no data" and "measured zero"; `SegmentSummary` has `scannedCount` available but the card/tiles never branch on it.
- **Impact**: A team that creates a segment and hasn't scanned yet sees an alarming red 0 / bottom posture, and comparisons against it produce meaningless deltas presented as insight — exactly the "comparison theater" the module's own comments warn about.
- **Fix sketch**: In SegmentCard and the comparison tiles, branch on `scannedCount === 0`: render an em-dash / "No scans yet" in muted slate (plus a "Scan segment" nudge), and suppress posture + delta rows when either side is unscanned.

## 5. API-level color/name normalization silently rewrites user intent (and unvalidated colors can break chip contrast)
- **Severity**: Low
- **Category**: edge-case-gap
- **File**: `src/lib/db/segments.ts:22`
- **Scenario**: `normalizeColor` maps any malformed color to the brand accent `#3b9eff` and `normalizeSegmentName` silently truncates at the magic `NAME_MAX = 60`. A `PATCH /api/org/segments/:id { color: "rebeccapurple" }` therefore *recolors the segment to blue* and returns `{ ok: true }` (`[id]/route.ts:27-28` also ignores `updateSegment`'s boolean); a 61+-char rename is truncated with no signal. Conversely, any *valid* hex is accepted — e.g. `#0b1220` — and `RepoTaggingList` renders active chips with hard-coded dark text `#04070e` on that background (`RepoSegmentsPanel.parts.tsx:268`), producing near-zero contrast; `SegmentSelector` has the same fixed `#04070e`-on-color assumption. The in-app PALETTE avoids this, but the API contract doesn't.
- **Root cause**: Sanitize-and-continue was chosen over reject-with-400, but the choice (and the 60-char bound, and the "palette colors are all light enough for dark text" assumption) is recorded nowhere the API consumer or a future UI can see.
- **Impact**: API/automation users get 200-OK responses that did something other than what they asked; a dark custom color yields unreadable segment chips (a11y regression the palette merely hides).
- **Fix sketch**: Return 400 from POST/PATCH for an invalid `color` or over-long `name` (the UI already constrains inputs, so this breaks nothing), or at minimum echo the normalized values in the response. For chips, compute text color from luminance (dark text only when the background clears ~4.5:1) instead of the fixed `#04070e`.

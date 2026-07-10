# Repositories & Segments — bug-hunter + ui-perfectionist scan

> Context: Repositories & Segments (group: Org Dashboard & Analytics)
> Files scanned: 13
> Total: 7 findings (Critical: 0, High: 0, Medium: 4, Low: 3)

Note on the headline risk: the IDOR surface is **clean**. `[id]/route.ts` derives the owning org from the
segment (`getSegmentOrgSlug`) and gates on the ACTIVE Supabase wall (`requireOrgAccess`/`requireOrgRole` →
`authGateEnabled()`); the `repos` and `repos/bulk` routes re-scope the segment to the caller's org inside
`setRepoSegment`/`setRepoSegmentsBulk` (`segment.findFirst({ id, orgId })` → 404/`-1` on mismatch). No
cross-tenant read/write/delete is reachable. Divide-by-zero on an empty segment is also guarded
(`roundedMean` is empty-safe; dim averages divide by `entry.n ≥ 1`). Those are reported as non-findings.
The scoped path `src/app/api/org/segments/[id]/bulk/route.ts` does **not** exist; the real bulk route is
`src/app/api/org/segments/[id]/repos/bulk/route.ts` (scanned).

## 1. Destructive segment delete fires with no confirmation
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: destructive-confirmation
- **File**: src/components/org/RepoSegmentsPanel.parts.tsx:40
- **Scenario**: On the Repositories tab a user aims for the small `✎` edit button and instead hits the `×`
  immediately to its right. `removeSegment` (RepoSegmentsPanel.tsx:94) fires `DELETE /api/org/segments/:id`
  at once; `deleteSegment` (segments.ts:90) wipes the segment AND every RepoSegment membership row.
- **Root cause**: Assumes an optimistic-drop-with-rollback is enough — but rollback only covers server
  FAILURE. A *successful* delete of a hand-curated segment (and all its tags) is irreversible, single-click,
  unconfirmed, with no undo.
- **Impact**: Silent loss of a segment and all its repo tags (which also feed the Overview filter and the
  comparison view). Felt by any admin who misclicks.
- **Fix sketch**: Gate `removeSegment` behind a confirm step (native `confirm()` or, better, an inline
  "Delete platform? N tags removed — [confirm]/[cancel]" affordance on the chip), matching the app's other
  destructive actions.

## 2. Compare picker allows selecting the same segment on both sides
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: duplicate-selection
- **File**: src/components/org/SegmentComparePicker.tsx:33
- **Scenario**: On the Segments tab both `<select>`s render the full options list with nothing disabled. A
  user picks "platform" in A and "platform" in B → URL `?a=X&b=X` → `compareSegments(slug, X, X)` compares a
  segment to itself: every delta renders `0`, and the tiles read "platform vs platform".
- **Root cause**: The server default logic avoids self-compare (`bParam !== aId`, SegmentsSection.tsx:101),
  but the client picker never prevents the user from actively choosing it — assumes A≠B without enforcing it.
- **Impact**: A confusing, meaningless all-zero comparison that looks like broken data. UX degradation.
- **Fix sketch**: In each `<option>`, `disabled={o.id === a}` on side B (and `=== b` on side A), or on B's
  change auto-swap when the picked id equals A. "Whole fleet" (side B) stays exempt.

## 3. Auto-add trusts a client-computed count and never reconciles with the server
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: success-theater
- **File**: src/components/org/RepoSegmentsPanel.tsx:212
- **Scenario**: `autoAdd` bumps `repoCount` by `addedRepos.length` — computed from LOCAL `membership` — then
  `await bulkTagRepos(...)` (line 214) and **discards** the server's authoritative `changed` count. If another
  session/tab already tagged some of those repos, the stale local `membership` counts them as new; the server
  `createMany({ skipDuplicates })` skips them, so the chip's `repoCount` drifts permanently high until a manual
  refresh. Unlike the sibling `RepoLeaderboard.addToSegment` (RepoLeaderboard.tsx:98), it also never calls
  `router.refresh()`, so the server-rendered leaderboard counts stay stale too.
- **Root cause**: Assumes the client's view of membership equals the server's; the bulk endpoint returns the
  real delta precisely because it doesn't.
- **Impact**: Inflated/incorrect segment repo counts (which feed the Overview filter and comparison) after any
  concurrent tagging. Success theater.
- **Fix sketch**: Reconcile to the returned count — `const changed = await bulkTagRepos(...)` then set count
  from `changed`, and `router.refresh()` after success as the leaderboard path does.

## 4. Same segment shows two different repo counts across the two tabs
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: data-consistency
- **File**: src/lib/db/segments.ts:268
- **Scenario**: A segment has 10 tagged repos, of which 3 are neither watched nor scanned. The chip on the
  Repositories tab shows `10` (`listSegments` uses `_count.repos`, segments.ts:48 — all RepoSegment rows). The
  SegmentCard on the Segments tab shows `7` repos (`summarizeSegmentFromRepos` sets `repoCount: repos.length`,
  where `repos` is the fleet rollup filtered to `watched OR has-scans`, segments.ts:268 / SegmentsSection.tsx:42).
- **Root cause**: Two different definitions of "the segment's repos" (all tagged vs. tagged-and-in-rollup) with
  no shared label, so the same slice reads differently in two places on the same feature.
- **Impact**: User sees contradictory counts for one segment and can't tell which is real. Minor confusion.
- **Fix sketch**: Either surface both explicitly ("10 tagged · 7 with scans") or drive both from one count;
  at minimum label the card's number as "scanned/rolled-up" rather than a bare repo count.

## 5. Segment cadence dropdown keeps a value the server rejected
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: missing-rollback
- **File**: src/components/org/SegmentActions.tsx:33
- **Scenario**: `setSchedule` calls `setCadence(schedule)` (line 33) BEFORE the fetch and never reverts it in
  the `catch` (line 44). When `POST /api/org/schedule` fails, the `<select>` keeps displaying e.g. "weekly"
  while the note beside it reads "Failed to set cadence." — control state and message disagree.
- **Root cause**: Optimistic set of the bound value without a rollback on failure (the same class the tagging
  handlers in RepoSegmentsPanel carefully close, but this one doesn't).
- **Impact**: The dropdown implies a cadence was applied when it wasn't; a user may believe autoscan is set.
  Minor.
- **Fix sketch**: Snapshot the prior `cadence` and restore it in the `catch`, or only `setCadence` after the
  request resolves OK.

## 6. Client stores an un-normalized segment name the server truncated
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: state-drift
- **File**: src/components/org/RepoSegmentsPanel.tsx:85
- **Scenario**: `createSegment` inserts `{ name: n }` with `n = name.trim()` (line 85), and `saveEdit` sets
  `name: next` (line 175) — both un-sliced. The server `normalizeSegmentName` trims AND slices to 60 chars
  (segments.ts:16). A >60-char name renders in full on the chip but is persisted truncated.
- **Root cause**: The optimistic UI applies a different normalization than the server, so the two disagree
  until a refresh re-hydrates the stored (truncated) value.
- **Impact**: Phantom name on the chip until reload; the same 60-char cap isn't reflected client-side. Minor.
- **Fix sketch**: Apply the shared `normalizeSegmentName` (or `.slice(0, 60)`) client-side before setting
  optimistic state, and/or enforce `maxLength={60}` on the inputs.

## 7. "Scan segment (N)" counts and enables on repos that can't actually be scanned
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/org/SegmentActions.tsx:98
- **Scenario**: `repos` passed to `SegmentActions` is every tagged repo (`reposBySegment`,
  SegmentsSection.tsx:77 — built from `getRepoSegmentMap`, no watched filter). The button label is
  `Scan segment (${repos.length})` (line 102) and it's enabled whenever `repos.length > 0` (line 98). But
  `POST /api/org/scan` starts from `listWatchedRepos` and intersects with the posted list (scan/route.ts:39-47),
  so only WATCHED tagged repos scan. A segment of 10 tagged-but-unwatched repos shows "Scan segment (10)"
  enabled; clicking it spins and then errors "No watched repositories matched the scan scope."
- **Root cause**: The control's count/enabled-state assume "tagged == scannable", but scanning is
  watched-only server-side (and the tooltip/file header even claim "watched repos").
- **Impact**: Overstated count and a dead-end action on segments whose repos aren't watched; the user is
  promised N scannable repos and gets an error. Degraded correctness under a narrow condition.
- **Fix sketch**: Pass/count only the segment's WATCHED repos (thread a `watched` flag through
  `reposBySegment`), label and disable accordingly, and drop `total` off the watched count.

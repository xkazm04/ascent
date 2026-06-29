# Repositories & Segments — Bug + UI Scan
> Context: Repositories & Segments (Org Dashboard & Analytics)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

## 1. Optimistic mutations with no rollback (auto-add by language + inline rename)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/org/RepoSegmentsPanel.tsx:163-188 (autoAdd) and 150-160 (saveEdit)
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: A member triggers "Auto-add" Python→Platform. The panel optimistically tags every matched repo and bumps the segment count, then `bulkTagRepos` rejects (403 for a viewer below member, P2002, or a network drop). The `catch` only sets `error`; the optimistic membership/count are NEVER reverted. The chips and the `repoCount` now claim memberships that don't exist server-side — and those tags feed the Overview segment filter and the segment-vs-segment comparison, so the next page produces analytics over repos that were never actually tagged. `saveEdit` has the identical hole: a failed PATCH leaves the new name/color showing while the server kept the old one.
- **Root cause**: `toggle()` (lines 109-140) and `removeSegment()` (88-107) were explicitly hardened to snapshot-and-rollback (see the comment at 121-124 about the old fire-and-forget bug), but `autoAdd` and `saveEdit` were never given the same treatment — the rollback pattern wasn't applied uniformly.
- **Impact**: Phantom state: UI shows tags/names that don't persist, silently corrupting the segment filter and comparison inputs until a manual refresh.
- **Fix sketch**: Mirror `toggle()`: capture `prevMembership`/`prevSegments` (and for saveEdit the prior name/color) before the optimistic update; in `catch`, restore them with functional updaters so a concurrent edit isn't clobbered.

## 2. Bulk-tag success message reports the selected count, not what actually changed — and never refreshes
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/org/RepoLeaderboard.tsx:68-82 (success line 75)
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: Tick 10 repos, "Add" to Platform where 7 are already tagged. `bulkTagRepos` returns the server's real `changed` count (3, because the route uses `createMany({ skipDuplicates })`), but `addToSegment` discards the return value and shows `Added ${selected.size} to Platform` = "Added 10". The user is told 10 were tagged when only 3 changed. Worse, this component never calls `router.refresh()`, so the sibling `RepoSegmentsPanel`'s chips and per-segment `repoCount`, plus the leaderboard's own server-rendered data, stay stale after the bulk write.
- **Root cause**: The return value of `bulkTagRepos` (the authoritative `changed` count) is ignored, and unlike `SegmentActions.scanSegment()` there is no `router.refresh()` after a mutating action.
- **Impact**: Success theater + stale UI — a misleading confirmation and counts that disagree with the server until a full reload.
- **Fix sketch**: `const changed = await bulkTagRepos(...)`; show `Added ${changed} to ...` (handle `changed === 0` as "already tagged"); call `router.refresh()` on success so server state re-hydrates.

## 3. Rapid double-toggle double-counts a segment's repoCount
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/components/org/RepoSegmentsPanel.tsx:109-119
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: Two fast clicks on the same repo×segment chip before a re-render both read `current = membership[fullName]` from the same stale render closure (line 110), both compute `member = true`, and each runs `setSegments(... x.repoCount + 1)` (line 119) — so `repoCount` jumps +2 while the membership `Set` only holds the id once (and the server, via idempotent upsert, holds one row). The chip count is now permanently off by one until a refresh.
- **Root cause**: `member` is derived from non-functional closure state (`membership[fullName]`) rather than a functional updater, so concurrent invocations don't observe each other's optimistic change.
- **Impact**: Cosmetic-but-wrong counts that erode trust in the segment numbers; self-heals only on reload.
- **Fix sketch**: Derive `member` inside a functional `setMembership` updater (compute from `prev`), and guard the count adjustment so it only fires when the membership actually flipped, or disable the chip while its POST is in flight.

## 4. Segments page issues O(segments) full org rollups per load
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/db/segments.ts:242-252 (listSegmentSummaries) + src/app/org/[slug]/segments/page.tsx:69-101
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: Rendering the Segments tab calls `listSegmentSummaries` (one `getOrgRollup` per segment, sequentially), then `compareSegments` (two more `getOrgRollup`), then `getRepoSegmentMap`. Each `getOrgRollup` (org-rollup.ts:185) is a full `repository.findMany` with included scans + a separate scan query. For an org with K segments that is K+2 complete fleet-table scans on one page request — the code even flags the assumption ("Sequential since N is small"). An org that creates dozens of segments turns one dashboard view into dozens of heavy queries.
- **Root cause**: Each segment summary is computed by re-running the whole scoped rollup instead of partitioning a single fleet query by segment membership.
- **Impact**: Latency time-bomb / DB load that grows linearly with segment count; degrades exactly the orgs that use the feature most.
- **Fix sketch**: Fetch the fleet rollup + the repo→segment map once, then derive each segment summary in memory by filtering the already-loaded repos; reserve `getOrgRollup` for the single A/B comparison. At minimum, parallelize the per-segment rollups with a bounded `Promise.all`.

## 5. Unlabeled select controls + error text not announced to screen readers
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/org/RepoSegmentsPanel.tsx:268, 281, 331; src/components/org/RepoLeaderboard.tsx:184
- **Value**: impact 3 · effort 2 · risk 1
- **Scenario**: The auto-add "language…" and "segment…" `<select>`s (RepoSegmentsPanel 268/281) and the bulk-bar "segment…" `<select>` (RepoLeaderboard 184) have no `aria-label` or associated `<label>` — only an adjacent visual "Auto-add" / "→ add to" string that isn't programmatically linked, so a screen reader announces them as bare "combo box". The companion controls in `SegmentComparePicker`/`SegmentActions` already do this right (`aria-label="Segment A"`, etc.), so it's an inconsistency, not a missing pattern. Separately, the optimistic-failure `error` paragraph (RepoSegmentsPanel:331) is a plain `<p>` with no `role="alert"`/`aria-live`, so a rollback message is never voiced.
- **Root cause**: Selects added without the project's existing `aria-label` convention; error region rendered as static text.
- **Impact**: Keyboard/screen-reader users can't identify the dropdowns or hear that a tag/rename failed.
- **Fix sketch**: Add `aria-label` ("Auto-add language", "Auto-add target segment", "Add selected repos to segment") to the three selects; wrap the error `<p>` in `role="alert" aria-live="polite"`.

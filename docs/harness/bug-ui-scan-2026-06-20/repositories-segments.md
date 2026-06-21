> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

# Repositories & Segments — combined bug+ui scan

## 1. Optimistic segment delete never reverts and silently swallows an admin-only 403
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: silent-failure / authz-UX mismatch
- **File**: src/components/org/RepoSegmentsPanel.tsx:89
- **Scenario**: A non-admin member (or any caller whose request fails) clicks the × on a segment chip. `removeSegment` optimistically drops the chip and its memberships from local state, then fires `fetch(.../segments/:id, { method: "DELETE" })`. The DELETE route gates on `requireOrgRole(org, "admin")` (src/app/api/org/segments/[id]/route.ts:36-39), so a `member` gets a 403 and the segment is NOT deleted server-side.
- **Root cause**: The response is never inspected (`await fetch(...)` with no `res.ok` check and no rollback), and the optimistic mutation assumes success. PATCH/toggle elsewhere at least surface an error; delete surfaces nothing.
- **Impact**: The user sees the segment vanish and believes it is gone. On the next refresh (or on the Overview filter / comparison page, which read server state) the "deleted" segment reappears with all its tags intact — looks like data resurrection / a broken delete. No error is ever shown.
- **Fix sketch**: Check `res.ok`; on failure restore the removed segment + its membership rows from a saved snapshot and set `error` (e.g. "Only an admin can delete a segment."). Mirror the `saveEdit` pattern that already reads `res.ok`.

## 2. Bulk "Add" reports the selected count, not how many repos were actually tagged
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: success-theater / count drift
- **File**: src/components/org/RepoLeaderboard.tsx:78
- **Scenario**: Tick 10 repos that are already in segment "platform", choose platform, click Add. The bulk route uses `createMany({ skipDuplicates: true })` and returns `{ changed: 0, ... }` (src/app/api/org/segments/[id]/repos/bulk/route.ts:28, db/segments.ts:165-169). The toast still reads "Added 10 to platform."
- **Root cause**: The client ignores the server's authoritative `data.changed` and reports `selected.size`. The same drift exists if the selection exceeds `MAX_BATCH = 1000` (route silently truncates to 1000, client still claims `selected.size`).
- **Impact**: Misleading confirmation — the repo-count badges and the segment rollups won't change, contradicting the "Added 10" message, eroding trust in the action.
- **Fix sketch**: Read `data.changed` and render it: `Added ${data.changed} to ${name}` (and word "already tagged" when `changed < selected.size`). RepoSegmentsPanel's `autoAdd` has the same gap and should also reconcile against `changed`.

## 3. Optimistic tag toggle swallows the network error and leaves the chip in a false state
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/components/org/RepoSegmentsPanel.tsx:110
- **Scenario**: In the per-repo "Tag repositories" list, click a segment chip while offline / the POST 404s (e.g. unknown repo for the org → route returns 404). `toggle` flips the chip and bumps `repoCount` optimistically, then `fetch(...).catch(() => {})` discards any failure.
- **Root cause**: The write is fire-and-forget with an empty catch and no `res.ok` check, so a failed tag/untag is never reconciled or surfaced.
- **Impact**: The chip and the segment's repo-count badge show a membership that doesn't exist server-side (or fail to clear one that does). The discrepancy persists until a hard refresh, and the bad count feeds the Overview filter and the comparison page.
- **Fix sketch**: Inspect the response; on `!res.ok` (or a thrown error) revert the optimistic membership + count change and set `error`.

## 4. RepoLeaderboard table is missing the OrgTable accessible caption
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/org/RepoLeaderboard.tsx:89
- **Scenario**: `OrgTable` already accepts an optional `caption` rendered as a visually-hidden `<caption>` (src/components/org/ui.tsx:91-103) — the hardening pass added it for other fleet tables. The repository leaderboard renders `<OrgTable className="mt-3" head={...}>` with no `caption`, so a screen-reader user hears an unnamed table with selection checkboxes and sortable-looking columns.
- **Root cause**: The caption prop was added to the shared primitive but not threaded through this (the largest, most interactive) fleet table; the sibling heatmap `<table>` in repositories/page.tsx:72 likewise has no `<caption>`.
- **Impact**: Inconsistent a11y with the rest of the hardened dashboard; the table that owns bulk selection is the one left unlabeled.
- **Fix sketch**: Pass `caption="Repository maturity leaderboard with segment selection"` to `OrgTable`; add an `sr-only` `<caption>` to the heatmap table too.

## 5. Stale `?segment=` URL param highlights "All repos" while still scoping the data
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / state mismatch
- **File**: src/components/org/SegmentSelector.tsx:18
- **Scenario**: User is on the Overview with `?segment=<id>` and then deletes that segment from the Repositories tab. Returning to (or sharing) the Overview URL, `active` is the now-deleted id. `SegmentSelector` renders no button matching it, so the "All repos" pill is NOT highlighted (its `active === null` test is false) and no segment pill is highlighted either — yet the server page still passes the dangling id to `getOrgRollup`, scoping the fleet to an empty/garbage set.
- **Root cause**: The selector trusts `active` to correspond to a live option but never validates it against `segments`; there's no "selected segment no longer exists" reconciliation.
- **Impact**: A confusing dead state — the dashboard shows scoped (often empty) numbers with no visible segment selected, and the user has no obvious way to tell why the fleet looks empty.
- **Fix sketch**: When `active` is non-null but absent from `segments`, treat it as "All repos" (highlight that pill) and/or strip the stale param on mount; the server page should fall back to the unscoped rollup when the id doesn't resolve to a segment.

## 6. Select-all checkbox has no indeterminate state for a partial selection
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: ui-polish / accessibility
- **File**: src/components/org/RepoLeaderboard.tsx:95
- **Scenario**: Tick 3 of 20 repos. The header checkbox is `checked={allSelected}` where `allSelected` requires `selected.size === rows.length`, so with a partial selection it renders fully unchecked — visually identical to "nothing selected", even though 3 rows are ticked and the bulk bar is showing.
- **Root cause**: Only the all-or-nothing `checked` state is modeled; the standard tri-state `indeterminate` (a DOM property, settable via a ref) is not.
- **Impact**: Minor but standard-violating: the header control doesn't reflect a partial selection, and a click on it (which toggles all) is unpredictable to the user mid-selection.
- **Fix sketch**: Set `el.indeterminate = selected.size > 0 && selected.size < rows.length` via a callback ref so the header checkbox shows the dash for partial selections.

# Repositories & Segments — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 11

## 1. DELETE requires admin but the UI offers it to every member, then silently "un-deletes" on refresh
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: authz / role-mismatch + silent failure
- **File**: src/components/org/RepoSegmentsPanel.tsx:89 (and src/app/api/org/segments/[id]/route.ts:38)
- **Scenario**: A `member`-role user clicks the `×` on a segment chip. `removeSegment` optimistically drops the chip from state, then `await fetch(... DELETE ...)`. The route's `gate(id, "admin")` returns **403** for a non-admin. The fetch result is never inspected — no `.ok` check, no `.catch`, no rollback, no error surfaced.
- **Root cause**: PATCH (rename/recolor) is gated at `member` via `requireOrgAccess`, but DELETE is gated at `admin` via `requireOrgRole(org, "admin")` (route L14–19, L38). The panel renders the delete button for everyone and ignores the response entirely (L96), so the failure is invisible.
- **Impact**: Members believe they deleted a segment; it reappears on the next load. Confusing, erodes trust, and makes the role boundary undiscoverable. Same pattern would mask a 503/network failure for admins.
- **Fix sketch**: Check `res.ok`; on failure re-insert the removed segment + its membership and show the server `error`. Either hide/disable `×` for non-admins (pass the caller's role into the panel) or relax DELETE to `member` to match PATCH — pick one and make UI and API agree.

## 2. Optimistic rename is never rolled back on a duplicate-name (409) — chip diverges from the DB
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: optimistic-update / state divergence
- **File**: src/components/org/RepoSegmentsPanel.tsx:125
- **Scenario**: User edits a segment to a name that already exists in the org. `saveEdit` first mutates local state to the new name (L127) and closes the editor, then PATCHes. The server hits the `@@unique([orgId, name])` constraint and returns **409** ("A segment with that name already exists.", route L31). The client sets `error` (L134) but leaves the chip showing the rejected name.
- **Root cause**: The optimistic mutation (L127) has no captured previous value and no revert branch; the `if (!res || !res.ok)` arm only sets an error string. The displayed name now disagrees with persisted state until a full reload.
- **Impact**: Two chips appear to share a name though the DB still has the old one; subsequent edits/tagging act on stale assumptions. Recolor-only edits that collide are similarly stranded.
- **Fix sketch**: Snapshot the segment before mutating; on non-ok response restore it (`setSegments` back to the snapshot) and reopen the editor so the user can correct the name. Apply the same revert pattern to the duplicate-name path in `createSegment`'s sibling flow.

## 3. createSegment upserts the org, so an unknown/typo'd slug silently materializes a new Organization
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: CRUD edge / data integrity
- **File**: src/lib/db/segments.ts:64
- **Scenario**: `POST /api/org/segments { org: "acme-typo", name: "x" }`. In an auth-off deployment (`requireOrgAccess` returns null when auth is unconfigured), `createSegment` runs `prisma.organization.upsert({ where: { slug }, create: {...} })` and conjures a brand-new org row for `acme-typo`, then a segment under it.
- **Root cause**: `createSegment` is the only write that *creates* the org rather than resolving it (contrast `setRepoSegment`/`setRepoSegmentsBulk`, which call `resolveOrgId` and bail when the org is unknown). A typo or probe thus pollutes the `Organization` table with ghost tenants that later show in any org-enumeration UI.
- **Impact**: Orphaned/ghost orgs accumulate; segment created under a tenant the user never legitimately accessed. Low blast radius when full OAuth is on (403 first), but real for the documented open/local mode and any "public"-funnel misuse.
- **Fix sketch**: Resolve the org with `resolveOrgId` and return null (→ 404 "Unknown organization") when it doesn't exist, instead of upserting. Reserve org creation for the explicit install/onboarding path.

## 4. Empty-fleet dead-end loop: Segments page sends you to Repositories to create a segment, but that page is blank with no repos
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: empty-state / navigation dead-end
- **File**: src/app/org/[slug]/segments/page.tsx:74 (and src/app/org/[slug]/repositories/page.tsx:15)
- **Scenario**: An org with no scanned/watched repos. The Segments page empty state links the user to the Repositories tab to "tag repos into them." But `getOrgRollup` returns null for a repo-less org, so `OrgRepositories` short-circuits to `OrgEmpty` (L15–24) and never renders `RepoSegmentsPanel`. There is nowhere to actually create a segment.
- **Root cause**: The segment-manager UI is mounted *inside* the rollup-gated branch of the Repositories page; the empty branch points back at Segments-style guidance ("Org overview"), so the two empty states bounce the user between tabs with no create affordance.
- **Impact**: New orgs cannot discover/create segments until at least one repo exists and is rendered; the feature is invisible exactly when onboarding guidance promises it.
- **Fix sketch**: Render `RepoSegmentsPanel` (or at least its create-segment row) above the `!rollup` guard, or make `OrgEmpty` here include a "create your first segment" entry. Segments don't depend on scan data to exist.

## 5. Compare picker lets B = A; the duplicate selection is silently overridden server-side
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: selection UX / silent correction
- **File**: src/components/org/SegmentComparePicker.tsx:41 (and src/app/org/[slug]/segments/page.tsx:94)
- **Scenario**: In the "B" dropdown the user selects the same segment already chosen for A. The picker writes `?b=<aId>`. The server computes `bId = bParam && ids.has(bParam) && bParam !== aId ? ... : options.find(o => o.id !== aId)?.id ?? null` — so it discards the choice and substitutes a *different* segment (or whole fleet). The B `<select>` then reflects a value the user never picked.
- **Root cause**: B's `<option>` list (L42–47) includes A with no `disabled`/filtering; the deduplication lives only in the server's URL-resolution fallback, producing a selected-value mismatch rather than blocking the bad pick.
- **Impact**: Confusing — the dropdown "jumps" to an unrequested segment, and a user trying to compare a segment against itself gets a different comparison with no explanation. Selection state and rendered state disagree.
- **Fix sketch**: In the B dropdown, mark the option whose `id === a` as `disabled` (and likewise A's option matching `b`), or filter it out. Optionally add a "Whole fleet" hint so self-compare is clearly not offered.

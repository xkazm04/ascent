# Roadmap & Recommendation Tracking — Bug + UI Scan
> Context: Roadmap & Recommendation Tracking (Reporting & Visualization)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

_Scope note: `src/components/report/RoadmapPanel.tsx` (listed in the dispatch) does not exist — context-map drift. The real shared module is `src/components/report/roadmapPieces.tsx` (read for context). All other 8 files read in full._

## 1. List route's read gate diverges from its siblings — tracker silently disappears for private orgs
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/app/api/recommendations/route.ts:33-35
- **Value**: impact 8 · effort 4 · risk 4
- **Scenario**: The GET list endpoint scopes the read with `readableOrgForOwner(parsed.owner)`, which consults `getSession()` — the **custom GitHub-OAuth** session. Under the project's active **Supabase** login wall the custom OAuth is dormant, so `getSession()` is null and `readableOrgForOwner` always returns `"public"`. For a private-org repo the public-org lookup finds nothing, so the route returns `{ scanId: null, items: [] }`. `ReportView.tsx:245-248` then sees `recs.length === 0` and renders the read-only `RoadmapSteps` instead of `RecommendationTracker`. The sibling routes in the SAME folder were hardened differently: `[id]/events/route.ts:27` uses Supabase-aware `requireOrgRead`, and `[id]/route.ts:50` uses `requireOrgAccess` (both resolve the org from the row). So PATCH/events work for a private org while the LIST that gates the whole tracker UI does not.
- **Root cause**: The list route was left on the legacy session-derived `readableOrgForOwner` mechanism when the per-row routes were migrated to the membership-aware `requireOrgRead`/`requireOrgAccess`; nobody reconciled the two read paths.
- **Impact**: The recommendation-tracking feature (progress bar, status edits, the entire point of this context) is silently unavailable for exactly the private/org customers it targets — they only ever see the static roadmap. No error, no log; it just degrades. (Under-permissioning, not a leak.)
- **Fix sketch**: Resolve the org from membership like the siblings: take an `id`-less repo→org resolution (or accept that the report page already knows the org) and gate with `requireOrgRead(org)`, or at minimum make `readableOrgForOwner` consult the Supabase viewer the way `canReadOrg`/`requireOrgRead` do, so all three routes share one tenant-resolution path.

## 2. Dismissed recommendations make 100% completion unreachable
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: visual-consistency
- **File**: src/components/report/RecommendationTracker.tsx:51-54,124-133
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: `pct = Math.round((done / total) * 100)` with `total = items.length`. Dismissed items stay in the denominator forever, so a fully-triaged backlog (e.g. 3 done + 2 dismissed of 5) shows "3 of 5 done · 2 dismissed" at 60% with a stalled gradient bar — even though nothing actionable remains. The user can never reach 100% without un-dismissing.
- **Root cause**: "Done" progress is computed against the raw item count rather than against the actionable set (total minus dismissed).
- **Impact**: Misleading progress signal — a completed backlog reads as perpetually incomplete, undermining the tracker's core "how far along are we" purpose.
- **Fix sketch**: Compute against actionable items: `const actionable = total - dismissed; const pct = actionable ? Math.round((done / actionable) * 100) : 100;` and label accordingly (e.g. "3 of 3 done · 2 dismissed").

## 3. Optimistic lock raises a false 409 when two members edit *different* fields
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/lib/db/scans-recommendations.ts:111-124
- **Value**: impact 4 · effort 3 · risk 3
- **Scenario**: The conditional `updateMany` keys its `where` on the pre-image of ALL three editable fields (`status`, `assigneeLogin`, `targetDate`). Member A sets the assignee while Member B sets the due date on the same recommendation. A commits first; B's `where` no longer matches (assignee changed) so `res.count === 0` throws `REC_CONFLICT` → 409 "This recommendation changed since you loaded it." B's edit touched a completely independent field and was never in conflict, yet is rejected and must reload+retry.
- **Root cause**: The concurrency guard compares the whole editable tuple instead of only the fields actually being written, so any concurrent change to the row trips it.
- **Impact**: Spurious conflicts and lost work on a collaborative backlog; the safety guard is correct against true lost-updates but over-fires, eroding trust in multi-user editing. (Data-safe — no corruption.)
- **Fix sketch**: Build the `where` from only the keys present in `data` (the fields being changed), e.g. spread `{ id, ...changedPreImage }`, so a write conflicts only when *its own* fields moved under it.

## 4. Status `<select>` selected-value color fails contrast on the dark surface
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/report/RecommendationTracker.tsx:156-163
- **Value**: impact 4 · effort 2 · risk 1
- **Scenario**: The select's text color is forced to the status accent via `style={{ color: STATUS_ACCENT[item.status] }}` over `bg-slate-950`. For "Open" (`#64748b`) and especially "Dismissed" (`#475569`) on near-black (`#020617`) the contrast is ~2.4:1 — below the WCAG 1.4.3 4.5:1 (and even the 3:1) threshold. The currently-selected status, the single most important word in the row control, is the hardest to read.
- **Root cause**: Reusing the dark accent swatch (designed for borders/dots, `STATUS_ACCENT`) as foreground text on a dark background.
- **Impact**: Low-vision users can't reliably read the active status; the affected statuses are the muted ones, so resolved rows are the least legible.
- **Fix sketch**: Keep the accent on the left-edge bar / a dot but render the select text in a high-contrast token (e.g. `text-slate-200`), or lighten the accents to a 4.5:1-passing tint when used as text.

## 5. Single shared `announcement` live region clobbers overlapping per-row saves
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/report/RecommendationTracker.tsx:41,95,103,110,119-121
- **Value**: impact 3 · effort 3 · risk 1
- **Scenario**: `savingIds` is correctly per-id so overlapping PATCHes don't freeze each other, but `announcement` is one shared string feeding a single `aria-live="polite"` region. If two rows resolve close together, the second `setAnnouncement` overwrites the first before the screen reader voices it (and identical strings won't re-announce at all), so a save success/failure can be silently dropped for AT users.
- **Root cause**: Row-level state was correctly parallelized but the screen-reader channel was not — it remained a single scalar.
- **Impact**: Screen-reader users may miss a save confirmation or, worse, a save *failure* on a row when another row updates simultaneously.
- **Fix sketch**: Either serialize announcements into a short queue, or scope a small per-row `role="status"` text near each row's spinner/error so each result is announced independently.

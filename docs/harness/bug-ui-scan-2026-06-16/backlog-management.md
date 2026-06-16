# Backlog Management — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 11

Scope read: `backlog/page.tsx`, `api/org/backlog/route.ts`, `BacklogItemRow.tsx`, `BacklogPanel.tsx`, `BacklogSummary.tsx`, `backlogShared.ts`, plus the supporting layer that owns the logic these depend on (`api/recommendations/[id]/route.ts`, `api/recommendations/[id]/events/route.ts`, `lib/db/org-insights.ts` `getOrgBacklog`, `lib/db/scans-recommendations.ts` `updateRecommendation`, `lib/db/scans-persist.ts` carry-forward).

Authz and validation came out clean and worth recording as non-findings: the GET uses `requireOrgRead`, the PATCH resolves the owning org from the row and uses `requireOrgAccess` (closes the IDOR), the events route is read-gated, `segmentScope` AND-combines with `orgId` (no cross-tenant leak), status is whitelisted against `REC_STATUSES`, `assigneeLogin` is regex-bounded, `targetDate` enforces strict `YYYY-MM-DD`, the audit row writes inside the mutation transaction, and `daysUntil` is UTC-consistent with how `targetDate` is stored. Re-scan edits survive via `matchRecommendations` carry-forward. The five findings below are where it actually leaks value.

## 1. Status → "Done"/"Dismissed" instantly removes the item from the only board surface, with no confirm and no way back
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: State-transition integrity / irreversible action
- **File**: src/components/org/BacklogItemRow.tsx:138-151 (status select offers all 4 statuses); src/lib/db/org-insights.ts:389 (`if (!ACTIVE.has(r.status)) continue;`)
- **Scenario**: A user opens the status `<select>` on a row and picks "Dismissed" (or "Done"). The PATCH succeeds, `refresh()` re-reads, and `getOrgBacklog` filters every non-`open`/`in_progress` item out of `byOwner`/`byDue`/`points`. The row vanishes from all three views the instant the select changes.
- **Root cause**: The board renders only active items, but the inline control lets a single mis-click move a row to a terminal-from-this-surface state. There is no confirmation for the destructive transition and no "show done/dismissed" filter on the panel, so a dismissed item cannot be re-opened from the backlog board at all — the counts in `BacklogSummary` (`done`/`dismissed`) become a dead end with no drill-in.
- **Impact**: Accidental dismissal silently drops a tracked gap off the roadmap; recovering it requires leaving this feature entirely (per-repo report tracker) or a DB edit. High because it's a one-click, unguarded, effectively-irreversible data action on the product's core object.
- **Fix sketch**: Confirm destructive transitions (`done`/`dismissed`) before PATCHing, OR keep just-transitioned rows visible for one render with an inline "Undo"; and add a "Show done/dismissed" toggle so terminal items remain reachable from the board.

## 2. `refresh()` swallows a failed re-fetch — board goes stale after a successful save with zero feedback
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Silent failure
- **File**: src/components/org/BacklogPanel.tsx:29-35
- **Scenario**: A PATCH succeeds (status/owner/due persisted), then the follow-up `GET /api/org/backlog` fails — session expiry (401), a 503, or a network blip. `refresh()` only acts `if (res.ok)`; there is no `else`. The board keeps showing the pre-change snapshot, `saving` clears, no error renders, and `patch` already cleared the prior error for that id.
- **Root cause**: The re-read is treated as best-effort with no error branch, even though it's the sole mechanism that reconciles the optimistic-free UI with the server after a write.
- **Impact**: The user's change *did* persist but the UI looks unchanged, so they re-apply it (writing duplicate audit/timeline events) or assume it failed. Groupings/counts drift from reality until a full reload.
- **Fix sketch**: Add an `else` that surfaces a panel-level "Saved, but couldn't refresh the board — reload to see the latest." and/or retry once; distinguish 401 (re-auth) from transient errors.

## 3. Overdue / due-date math is frozen at page-load and never recomputes client-side
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Date/overdue math (staleness)
- **File**: src/components/org/backlogShared.ts:32-38 (`dueLabel` reads server `item.dueInDays`); src/components/org/BacklogItemRow.tsx:105,129 (`item.overdue` styling); src/lib/db/org-insights.ts:391-393 (computed once with `now`)
- **Scenario**: `getOrgBacklog` computes `dueInDays`, `overdue`, and `dueBucket` against the server's `now` at render time. The board is a long-lived client surface (it only re-reads on a PATCH-triggered `refresh()`). Leave it open past midnight, or across the due date of an item, and a row due "in 0 days" / styled non-overdue never flips to overdue; `BacklogSummary`'s "Overdue" count stays stale too.
- **Root cause**: All recency math is precomputed server-side and shipped as static fields; nothing on the client re-derives relative dates from the clock, and there's no periodic refresh.
- **Impact**: The roadmap misreports what is overdue/due-soon for any session that stays open — the exact signal this board exists to surface. Low data risk, real trust risk.
- **Fix sketch**: Derive `overdue`/`dueInDays` client-side from `item.targetDate` against `Date.now()` (the data is already shipped), or refresh the backlog on an interval / on window focus.

## 4. Group-by segmented control exposes no selected state to assistive tech
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: Accessibility (a11y)
- **File**: src/components/org/BacklogPanel.tsx:113-126
- **Scenario**: The Owner / Due date / Projected points buttons are a segmented toggle conveying which grouping is active purely via Tailwind color classes. They are plain `<button>`s with no `aria-pressed` (or `role="tab"`/`aria-selected`). A screen-reader user hears three identical buttons with no indication of which view is current.
- **Root cause**: Selected-state is visual-only; no ARIA state is wired to `view === v`.
- **Impact**: Non-sighted users can't tell or confirm the active grouping — a WCAG 4.1.2 (name/role/value) gap on the panel's primary control.
- **Fix sketch**: Add `aria-pressed={view === v}` to each button (or model it as a `role="tablist"` with `aria-selected`), and give the group an `aria-label="Group backlog by"`.

## 5. Inline save / PR / promote errors are not announced (no live region)
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: Accessibility / error feedback
- **File**: src/components/org/BacklogItemRow.tsx:213-214 (`error` and `prError` `<p>`s); also the silent-`refresh` gap from #2 has no surface at all
- **Scenario**: A status change is rejected (e.g. 403/400) or a draft-PR/promote call fails. The message renders into a static `<p className="...text-orange-300">` with no `role="alert"` / `aria-live`. The row carries `aria-busy={saving}`, but when saving flips off and an error text appears, nothing is announced, and keyboard/SR focus stays on the `<select>` with no feedback that the change was refused.
- **Root cause**: Error text is inserted into the DOM without a polite/assertive live region, so it's silent for assistive tech and easy to miss for sighted users scanning a long board.
- **Impact**: Users who rely on announcements believe a refused status/owner/date change took effect — compounding the #1/#2 integrity gaps. WCAG 4.1.3 (status messages).
- **Fix sketch**: Wrap the error `<p>`s in `role="alert"` (or an `aria-live="assertive"` region), and add a panel-level live region for the `refresh()`-failed message from #2.

# Backlog Management — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 1, Medium: 3, Low: 1)

Note: the context manifest lists `src/components/org/BacklogItemRow.tsx` etc.; the real paths are `src/components/org/backlog/*` and `src/components/org/shared/backlogShared.ts` (context-map drift).

## 1. "Promote to initiative" dedupe is client-session-only — reload and re-promote creates duplicate initiatives
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/components/org/backlog/BacklogItemRow.tsx:103-121`
- **Scenario**: Clicking "Promote to initiative" POSTs `/api/org/initiatives` and flips a `promoted` flag in lifted client state (`BacklogRowState.promoted`). The flag lives only in `BacklogPanel`'s in-memory `rowStates` — a page reload, a different browser tab, or a second teammate sees the button re-enabled and can promote the same gap again. The POST handler (`src/app/api/org/initiatives/route.ts:18-48`) has no idempotency/dedup check (same title+dimId+repo creates a new row every time).
- **Root cause**: The "already promoted" fact is real server state (an initiative exists for this rec) but is modeled as volatile UI state; the backlog item carries no `initiativeId` back-link and the server enforces nothing.
- **Impact**: Duplicate org initiatives for one gap — the org-level roadmap (the whole point of promoting) gets noisy double entries; nobody can tell which is canonical.
- **Fix sketch**: Persist the link: have `createInitiative` return 200 + existing id when an initiative with the same `(org, dimId, sourceRecId)` exists (store `sourceRecId`), and have `getOrgBacklog` project `initiativeId` onto each item so the button renders "✓ Initiative" from server state, not session memory.

## 2. Backlog ignores segment/tech-group scoping every sibling surface honors — and the route's `?segment` param is unreachable dead code
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/app/api/org/backlog/route.ts:19-20` (also `src/components/org/backlog/BacklogPanel.tsx:58`, `src/app/org/[slug]/backlog/page.tsx:21`)
- **Scenario**: `getOrgBacklog(orgSlug, segmentId, now, techGroupId)` is fully segment- and tech-group-aware (`org-insights.ts:380`), and the API route documents `?segment`. But the page loads `getOrgBacklog(slug)` unscoped, the panel's `refresh()` fetches without `segment`, and no caller in `src/` ever passes it (grep: only the route comment and tests). `techGroupId` isn't exposed by the route at all.
- **Root cause**: Scoping was plumbed into the DB layer (matching movers/recommendations/practices) but never wired through the page/panel; the route param survived as an aspiration with no recorded decision on whether the backlog is deliberately org-wide.
- **Impact**: A user who filters the org to a segment elsewhere lands on a backlog silently showing every repo — counts and owner groups disagree with the adjacent scoped views, and it reads as a data bug. Meanwhile the param invites a future caller to pass `segment` on load but not on refresh, which would snap the view back to unscoped after the first edit.
- **Fix sketch**: Decide and record it: either wire the org's segment/tech-group selection through `page.tsx` → `BacklogPanel` (thread it into `refresh()` too) and add `techGroup` to the route, or delete the route's `segment` handling and comment that the backlog is intentionally always org-wide.

## 3. History fetch failure renders as "No changes recorded yet." — a false statement on error
- **Severity**: Medium
- **Category**: missing-state
- **File**: `src/components/org/backlog/BacklogItemRow.tsx:158-164`
- **Scenario**: `loadHistory()` maps both a non-2xx response and a thrown fetch error to `{ events: [] }`. `BacklogRowHistory` renders `[]` as "No changes recorded yet." (`BacklogItemRow.history.tsx:14-15`) — so a network blip or 500 tells the user, with confidence, that an item with a rich timeline has never been touched.
- **Root cause**: Error and empty are collapsed into one representation; the lifted `history` state has "loading" and `RecEvent[]` variants but no error variant.
- **Impact**: Actively misleading audit surface — the page's own header promises "every change is recorded in the item's history"; on a flaky connection the UI contradicts the audit log, and there is no retry affordance.
- **Fix sketch**: Add an `"error"` variant to `BacklogRowState.history` (or `{ error: true }`), render "Couldn't load history — retry" with a button re-invoking `loadHistory()`, and only show the empty-copy when the server genuinely returned zero events.

## 4. The 7-day "due soon" window and overdue orange are magic values duplicated across backend and UI
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/lib/db/org-insights.ts:302` (also `:529`, `src/components/org/backlog/BacklogSummary.tsx:11`, `BacklogItemRow.tsx:191,217`)
- **Scenario**: The literal `7` defines the `this_week` bucket (`d <= 7`, line 302) and, independently, the `dueSoon` tile count (line 529); the tile label hardcodes "Due ≤ 7d" in `BacklogSummary.tsx:11`. Separately, overdue orange `#f97316` is repeated as the row's left-border color (`BacklogItemRow.tsx:191`), the tile color (`BacklogSummary.tsx:10`), plus tailwind `orange-300/orange-500` variants on the due chip and group headers.
- **Root cause**: No shared `DUE_SOON_DAYS` constant or `OVERDUE_COLOR` token; each surface re-stated the value at the moment it was written.
- **Impact**: Changing the window (e.g. to a sprint length) requires finding three `7`s in two layers; miss one and the "Due ≤ 7d" tile disagrees with the "This week" bucket it visually summarizes. Color drift risk is the same shape: one hex edit and overdue rows stop matching the overdue tile.
- **Fix sketch**: Export `DUE_SOON_DAYS = 7` next to `BacklogDueBucket` (backend derives both bucket and count from it; label becomes `` `Due ≤ ${DUE_SOON_DAYS}d` ``), and add `OVERDUE_ACCENT` alongside `STATUS_ACCENT` in `backlogShared.ts`. While there, tighten `STATUS_ACCENT`'s type from `Record<string, string>` to `Record<RecStatus, string>` so a new status can't silently yield an `undefined` border color.

## 5. History disclosure button has no `aria-expanded`/`aria-controls`, and save/PR outcomes aren't announced
- **Severity**: Low
- **Category**: a11y
- **File**: `src/components/org/backlog/BacklogItemRow.tsx:287-293` (also `:293-305`)
- **Scenario**: "History" toggles an inline region purely by label text ("History" ↔ "Hide history"); there is no `aria-expanded`, no `aria-controls`, and the revealed region has no id or landmark. Likewise the transient "saving…" span, the PATCH error, `prError`, and the "Draft PR opened" success line appear/disappear with no `aria-live`, so a screen-reader user acting on the row hears nothing when the save fails or the PR link arrives.
- **Root cause**: Disclosure and async-status patterns were hand-rolled per row without the standard ARIA wiring; the codebase already does `aria-pressed` on the group-by toggle and `aria-busy` on the row, so the gap is inconsistency, not ignorance.
- **Impact**: Non-visual users can't tell whether History is expanded or whether their status/owner/due edit actually saved — on this screen the error message is the only signal that an edit was rejected (the control visually reverts).
- **Fix sketch**: Give the history container `id={`history-${item.id}`}`, set `aria-expanded={!!history}` and `aria-controls` on the button; wrap the error/PR-result/saving messages in a single `role="status"` (`aria-live="polite"`) container so state changes are announced.

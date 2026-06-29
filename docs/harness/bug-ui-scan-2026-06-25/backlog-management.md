# Backlog Management — Bug + UI Scan
> Context: Backlog Management (Org Planning & Execution)
> Total: 5 findings (0 critical, 0 high, 2 medium, 3 low)

## 1. "Promote to initiative" can create unlimited duplicate initiatives
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/components/org/BacklogItemRow.tsx:33-51, 196-202 (corroborated: src/app/api/org/initiatives/route.ts POST → createInitiative has no dedup)
- **Value**: impact 6 · effort 3 · risk 2
- **Scenario**: User clicks "Promote to initiative" on a backlog row → initiative created, button shows "✓ Initiative". The only guard against re-promotion is the component-local `promoted` boolean. That flag resets to `false` on (a) any page reload and (b) whenever the row remounts — which happens every time the item is reassigned to a different owner (see finding #2, the row moves to a different `<Card>` parent). After either, the button reads "Promote to initiative" again and clicking it POSTs a second identical initiative. The POST endpoint performs no title/dimId/repo dedup, so each click yields another row.
- **Root cause**: Idempotency was modeled as transient client UI state rather than a server-side or persisted property of the recommendation; there is no "already promoted" signal carried on `BacklogItem`.
- **Impact**: Silent proliferation of duplicate org initiatives, which then pollute initiative lists, goal rollups and planning counts — no crash, but corrupted planning data that someone must manually clean up.
- **Fix sketch**: Make promotion idempotent at the source: either pass a stable client key / source recommendation id so `createInitiative` upserts (one initiative per rec), or persist a `promotedInitiativeId` on the recommendation and have `getOrgBacklog` return it so the row renders "✓ Initiative" (disabled) across reloads and remounts.

## 2. Inline owner reassignment remounts the row, discarding the just-opened PR link, history and errors
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/components/org/BacklogPanel.tsx:147-163 (Card-per-owner-group) + src/components/org/BacklogItemRow.tsx:24-29 (local state)
- **Value**: impact 5 · effort 4 · risk 3
- **Scenario**: A user opens a draft PR on an item (`prResult` now shows the only on-screen link to that PR), then changes the item's **owner** in the same row. `onPatch` triggers `refresh()`, which rebuilds `backlog.byOwner`; the item now belongs to a different owner group, i.e. a different `<Card key=...>` parent. React only preserves component state for keyed siblings under the *same* parent, so moving across `<Card>`s unmounts and remounts `BacklogItemRow`, wiping `prResult`, `prError`, expanded `history`, and `promoted`. The freshly-opened draft-PR URL vanishes with no way to recover it in-app.
- **Root cause**: Per-row interaction state (PR result, history, promote status) lives in the row component, but the grouping re-parents rows on every edit, so React cannot keep that state alive across a regroup.
- **Impact**: Lost reference to a PR the user just created; collapsed history they were reading; reset of the promote guard (feeds finding #1). Confusing, data-losing UX on a routine edit.
- **Fix sketch**: Lift volatile per-item state (prResult, history, promoted) into a `Map<itemId, …>` in `BacklogPanel` keyed by item id, or render all groups under one stable parent and signal grouping via headers/order only — so a row's identity (and state) survives a regroup.

## 3. "Group by" toggle is color-only to assistive tech (no pressed/selected semantics)
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: a11y
- **File**: src/components/org/BacklogPanel.tsx:124-137
- **Value**: impact 4 · effort 2 · risk 1
- **Scenario**: The Owner / Due date / Projected points selector is three `<button>`s whose active state is conveyed purely by `border-accent/50 bg-accent/10 text-white` styling. A screen-reader user tabbing through hears "Owner, button / Due date, button / Projected points, button" with no indication of which grouping is currently applied, and the group is not announced as a single control.
- **Root cause**: A visual segmented control was built from plain buttons without the ARIA role/state that communicates selection.
- **Impact**: Non-visual users can't tell the current view; mild but real WCAG 4.1.2 (name/role/value) gap on a primary control.
- **Fix sketch**: Add `aria-pressed={view === v}` to each button (or wrap in `role="radiogroup"` with `role="radio"`/`aria-checked`), and give the group an accessible label ("Group backlog by").

## 4. History panel re-opens after collapse mid-fetch, and goes stale after edits
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: race-condition
- **File**: src/components/org/BacklogItemRow.tsx:84-97
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: Clicking "History" sets `history = "loading"` and starts a fetch. Clicking again immediately treats the truthy `"loading"` sentinel as "open" and collapses it (`setHistory(null)`), but the in-flight request is not cancelled or guarded — when it resolves it calls `setHistory(data.events)`, re-opening the panel the user just closed. Separately, once loaded the events array is cached locally and never refetched, so after the user changes status/owner/due (which records a new timeline event) an already-open history list shows stale data missing the change they just made.
- **Root cause**: The fetch has no abort/ignore guard tied to the open/closed intent, and history is treated as a one-shot cache rather than something invalidated by edits to the same item.
- **Impact**: Minor flicker/re-expand surprise and a misleading "complete" history that omits the latest change. Not data-losing.
- **Fix sketch**: Track an open/closed flag separately from the data, ignore a resolved fetch when the panel was closed (or AbortController), and invalidate/refetch history after a successful `onPatch` for that item.

## 5. BacklogSummary reimplements a local Stat instead of the canonical Stat primitive
- **Lens**: ui-perfectionist
- **Severity**: low
- **Category**: component-extraction
- **File**: src/components/org/BacklogSummary.tsx:3-12 (vs canonical src/components/ui/Stat.tsx)
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: The repo ships a documented "canonical number block" `Stat` in `src/components/ui/Stat.tsx` ("one source of truth for the org dashboard Tiles, the landing stat ledger, and any headline metric"). BacklogSummary defines its own private `Stat` with divergent styling — bordered `rounded-xl border` box, `text-2xl` value vs the canonical `text-3xl`, and a different label treatment — so the backlog summary tiles don't match the stat blocks used elsewhere in the org dashboard.
- **Root cause**: A local helper was written instead of importing the shared primitive, letting the design system drift.
- **Impact**: Visual inconsistency across dashboard surfaces and duplicated styling that must be kept in sync by hand.
- **Fix sketch**: Use the shared `Stat` from `@/components/ui` (composed inside a `Surface`/tile for the border) and delete the local copy, mapping the six summary metrics onto its `label`/`value`/`color` props.

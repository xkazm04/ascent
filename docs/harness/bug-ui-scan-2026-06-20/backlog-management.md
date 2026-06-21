> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

# Backlog Management — combined bug+ui scan

## 1. Backlog refresh after every inline edit silently drops in-flight edits and resets scroll
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: concurrency / data-consistency
- **File**: src/components/org/BacklogPanel.tsx:29-65
- **Scenario**: A user changes one item's status (PATCH), then immediately changes a second item's owner before the first `refresh()` resolves. `patch()` does `await fetch(PATCH)` then `await refresh()`, and `refresh()` calls `setBacklog(data.backlog)`, wholesale-replacing the entire `OrgBacklog` snapshot. The backlog re-read happens server-side from the DB; if the second PATCH has been written but the first `refresh()` raced ahead of it (or vice-versa), the panel renders a stale full snapshot. Because both edits funnel through the same `setBacklog`, the last `refresh()` to resolve wins and can overwrite a more-recent state. There is no per-item merge and no request sequencing/abort.
- **Root cause**: Every edit triggers a full server re-read + total state replacement instead of an optimistic per-item update; concurrent edits' `refresh()` responses are not ordered, so a slower-arriving older snapshot clobbers a newer one. Re-reading the whole list also re-mounts rows, collapsing any open History panel and losing scroll position.
- **Impact**: Data-consistency/UX: rapid multi-item editing can show stale values until the next manual reload; open History panes and scroll position are lost on every save, making bulk triage (the core use case) jarring.
- **Fix sketch**: Apply the PATCH response optimistically to the single edited item in local state (the route returns the updated `PersistedRecommendation`), and either drop the blanket `refresh()` or guard it with a request-sequence token (ignore a `refresh()` whose start preceded a later edit). At minimum, debounce/serialize refreshes so only the latest wins.

## 2. "Promote to initiative" shares its error channel with "Open draft PR" and can mislabel failures
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: error-handling / state-management
- **File**: src/components/org/BacklogItemRow.tsx:33-51,63-82,214
- **Scenario**: `promoteToInitiative()` writes its failure into `setPrError(...)` — the same state the draft-PR flow uses (`prError`). If a user first opens a draft PR successfully (`prResult` set, `prError` null), then clicks "Promote to initiative" and it fails (e.g. 403, or dimId not matching `/^D[1-9]$/` server-side), the error renders under the row but visually reads as a PR error, while the green "Draft PR opened" line still shows. Conversely a stale PR error can linger when promotion succeeds. The two independent actions are entangled through one error variable.
- **Root cause**: A single `prError` state is reused for two unrelated async actions instead of giving promotion its own error state; `promoteToInitiative` also clears `prError` on start, silently wiping a real PR error.
- **Impact**: UX/error-attribution: users see the wrong action blamed for a failure, and a genuine PR error can be erased by an unrelated promote click.
- **Fix sketch**: Add a dedicated `promoteError` state for `promoteToInitiative`; render it next to the Promote button. Stop mutating `prError` from the promote path.

## 3. Promoted-to-initiative state is per-mount and unverified, so duplicate initiatives are easy to create
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: idempotency / data-integrity
- **File**: src/components/org/BacklogItemRow.tsx:28-51,196-202
- **Scenario**: Clicking "Promote to initiative" POSTs to `/api/org/initiatives`, which has no dedupe — every successful POST creates a new initiative row (see route.ts:45 `createInitiative`). The only guard is local `promoted` state. After any `refresh()` from an unrelated edit re-reads the backlog, ItemRow is keyed by `item.id` so it persists, but a full reload of the page (or a second browser tab) resets `promoted` to false, letting the same gap be promoted again. There is no "already promoted" signal derived from server data.
- **Root cause**: Idempotency lives only in transient component state; the backend accepts unlimited identical initiatives for the same (title, dimId, repo), and the backlog item carries no flag indicating it was already promoted.
- **Impact**: Data-integrity: the Initiatives list accumulates duplicate entries for one recommendation across reloads/tabs, polluting org planning rollups.
- **Fix sketch**: Either dedupe server-side (skip/return-existing on matching org+title+dimId+repo) or persist a promotion link on the recommendation and reflect it in `BacklogItem` so the button renders disabled/"✓ Initiative" from server state, not just local memory.

## 4. Status/Owner/Due controls have no error toast region and the only feedback is an easily-missed inline line
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: a11y / error-states
- **File**: src/components/org/BacklogItemRow.tsx:135-213
- **Scenario**: When a PATCH fails, `errors[id]` renders as a small orange `<p>` at the bottom of the row (line 213), but the failing `<select>`/`<input>` snaps its `value` back to the unchanged `item.*` with no visible link between the reverted control and the error text, and the error is not announced to assistive tech (`aria-busy` covers saving but there is no `role="alert"`/`aria-live` on the error). A screen-reader user changing status who hits a validation/permission error gets the control silently reverting with no announced reason.
- **Root cause**: Error feedback is a static paragraph with no `role="alert"`/`aria-live` and no programmatic association to the control that failed; the silent value-revert gives sighted users no cue either.
- **Impact**: a11y/UX: failed edits (403 cross-tenant, network, validation) appear to "do nothing"; assistive-tech users get no notification of why their change didn't stick.
- **Fix sketch**: Wrap the per-row error in `role="alert"` (or an `aria-live="polite"` region) and `aria-describedby`-link it to the controls; consider briefly flashing the reverted control so the revert is perceivable.

## 5. Overdue due-date label and chip use inconsistent wording vs the summary, and undated items render no due affordance
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: consistency
- **File**: src/components/org/backlogShared.ts:32-38; src/components/org/BacklogItemRow.tsx:99,128-132
- **Scenario**: `dueLabel` returns "due today" / "due in N days" / "N days overdue"; the row only renders a due chip when `dueInDays != null` (line 128), so items with no due date show no due indicator at all (not even a subtle "No due date" hint), even though the date `<input>` below is empty — the user can't tell at a glance which active items lack a date. The "By due date" grouping does surface a "No due date" bucket, but the Owner and Points views give undated items no visible due cue.
- **Root cause**: The due chip is gated on a non-null `dueInDays` with no neutral state for undated items, so the two non-due-grouped views lose the "needs a date" signal that the Unassigned-owner styling otherwise provides for ownership.
- **Impact**: UX/consistency: in Owner/Points views, undated active items are visually indistinguishable from on-track ones, undercutting the "set a due date and track it" workflow the panel promotes.
- **Fix sketch**: Render a muted "No due date" chip (mirroring the amber "Unassigned" treatment) when `dueInDays == null`, so every active item carries a consistent due affordance across all three groupings.

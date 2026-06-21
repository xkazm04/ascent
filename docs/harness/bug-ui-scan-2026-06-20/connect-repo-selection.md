> Total: 6 findings (0 critical, 1 high, 4 medium, 1 low)

# Connect & Repo Selection — combined bug+ui scan

## 1. Per-row watch/schedule controls stay enabled during a bulk operation, so a bulk revert clobbers a concurrent per-row change
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/connect/InstallationRepos.tsx:251 (watchAllFiltered) / src/components/connect/RepoRow.tsx:55
- **Scenario**: User clicks "Watch all (N)" (bulk request in flight, `bulkBusy=true`). While it is pending, the user ticks a single row's watch checkbox or picks a schedule for one repo (the row `<input>`/`<select>` are never disabled while `bulkBusy`). The bulk request then returns a partial `failed` list; `revertFullNames.forEach((fn) => patch(fn, { watched: false }))` (line 274) flips those rows back to unwatched — including a row the user just toggled — and the per-row POST may interleave with the bulk POST against `/api/org/watch`.
- **Root cause**: Only the two bulk controls gate on `bulkBusy`; the per-row toggle (`toggleWatch`) and schedule (`changeSchedule`) ignore it entirely, and the bulk revert writes absolute values (`watched:false`) instead of restoring the captured prior value, so it overwrites whatever the row currently holds.
- **Impact**: Optimistic UI shows a state the server never saved (success-theater the bulk path is otherwise careful to avoid), or a user's just-made choice silently disappears; possible duplicate/conflicting writes for the same repo.
- **Fix sketch**: Disable the row watch checkbox + schedule select while `bulkBusy` (pass `bulkBusy` into `RepoRow`), or have the bulk revert restore each row's captured prior value (a Map like `scheduleWatched` builds) rather than hard-coding `watched:false`.

## 2. Bulk-watch partial failures silently revert rows with no per-row indication
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: error-state
- **File**: src/components/connect/InstallationRepos.tsx:274
- **Scenario**: "Watch all" succeeds for most repos but `failed` contains a few. Those rows are reverted to unwatched and the only feedback is an aggregate line: "Now watching 8 repos · 2 failed." The user cannot tell *which* 2 reverted, and unlike the per-row toggle (which sets `setRowError`) no inline error is attached to the failed rows.
- **Root cause**: The bulk path surfaces a single `bulkMsg` summary and intentionally does not write `errors[fullName]` for the failed subset, even though `revertFullNames` identifies them exactly.
- **Impact**: User believes the failed repos are watched-then-unwatched at random; their scheduled scans silently never run and there is no actionable signal to retry the specific repos.
- **Fix sketch**: For each `fn` in `revertFullNames` on a partial (non-network) failure, also call `setRowError(fn, "Couldn't watch — not saved. Try again.")` so the affected rows show the same inline retry affordance the per-row path uses.

## 3. Bulk result message is not announced to assistive tech
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/connect/InstallationRepos.tsx:423
- **Scenario**: A screen-reader user triggers "Watch all" or "Schedule watched". The outcome (`bulkMsg`) renders into a plain `<span>` with no live region, so success ("Now watching 8 repos"), partial failure, or "Network error — bulk watch not saved" is never announced. The per-row error path uses `role="alert"` (RepoRow.tsx:108), so this is inconsistent within the same component.
- **Root cause**: `bulkMsg` is rendered in a static `<span>` with no `role="status"`/`aria-live`.
- **Impact**: Non-sighted users get no feedback on a multi-repo, billable action; they cannot tell whether the bulk save succeeded or silently failed.
- **Fix sketch**: Wrap the `bulkMsg` span (or its container) with `role="status"` and `aria-live="polite"` (use `assertive`/`role="alert"` for the error kind), mirroring the per-row alert.

## 4. Segment tag toggle uses a stale membership snapshot under rapid clicks
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: stale-state
- **File**: src/components/connect/InstallationRepos.tsx:119
- **Scenario**: User clicks the same segment chip twice quickly (or two different chips on the same repo) before a re-render. `toggleSegment` derives `member` from `const current = segMembership[r.fullName] ?? []` captured at call time, not from the functional updater. The first click computes `member=true` and optimistically adds; the second click — still seeing the pre-render `current` — also computes `member=true` and POSTs `member:true` again, so the intended toggle-off is lost and the server/UI diverge.
- **Root cause**: The decision of which direction to toggle (`member`) and the POST body are computed from a snapshot variable, while the optimistic UI update uses a functional `setSegMembership((m) => …)`. The two can disagree when events fire faster than React re-renders.
- **Impact**: Segment membership flips can be dropped or double-applied; the optimistic UI and the persisted membership drift, surviving until the next org reload.
- **Fix sketch**: Compute `member` and the request body inside the functional updater (or guard each segment-chip with a per-(repo,segment) in-flight flag), so the toggle direction is always derived from the latest state.

## 5. Watch toggle and schedule change can race for the same repo (no per-control in-flight guard)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/components/connect/InstallationRepos.tsx:197
- **Scenario**: User rapidly toggles a single repo's watch checkbox off→on→off (or unwatches a repo while its schedule POST is still in flight). Each `toggleWatch`/`changeSchedule` fires its own un-cancellable POST and captures `prevWatched`/`prevSchedule` at its own start. If an earlier (slower) request resolves after a later one, its rollback restores a now-stale prior value, leaving the row out of sync with the last user intent and with the server.
- **Root cause**: Per-row mutations have no in-flight/last-write-wins guard or request cancellation; rollback restores a captured-at-start snapshot regardless of intervening successful writes.
- **Impact**: A repo can land watched/unwatched (or on the wrong schedule) opposite to the user's final click, with the optimistic UI showing the wrong stable state.
- **Fix sketch**: Track an in-flight token per `(fullName, field)` and ignore a response whose token is no longer current, or disable the specific control while its own request is pending.

## 6. Empty-string schedule sentinel could be POSTed as a cadence in bulk schedule
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: edge-case
- **File**: src/components/connect/InstallationRepos.tsx:411
- **Scenario**: The "Schedule watched" `<select>` uses `value=""` with a placeholder `<option value="">cadence…</option>`. `scheduleWatched` guards `if (!schedule || bulkBusy) return;` so the empty placeholder is correctly ignored on selection — but the select is a controlled component pinned to `value=""`, meaning re-selecting the same cadence twice (choose "daily", then "daily" again) fires no `onChange` the second time because the DOM value was reset to "". This makes "set the whole watched set to daily again" silently do nothing after the first use without resetting the dropdown, which can read as a stuck control.
- **Root cause**: Controlled `value=""` placeholder pattern relies on `onChange` firing, but selecting the already-effective option (or re-selecting after the value snaps back to "") does not always emit a change, so repeat bulk-schedule attempts are inconsistently honored.
- **Impact**: Minor UX confusion — a repeated bulk-schedule action appears ignored; no data corruption.
- **Fix sketch**: Reset the select value via a key bump after each successful action, or surface the current effective bulk cadence as the selected value so re-selection is unambiguous.

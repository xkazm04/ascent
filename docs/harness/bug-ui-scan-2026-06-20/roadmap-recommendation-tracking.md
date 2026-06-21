> Total: 5 findings (0 critical, 2 high, 2 medium, 1 low)

# Roadmap & Recommendation Tracking — combined bug+ui scan

## 1. Concurrent PATCH is a read-then-write with no version guard — lost update + a self-contradicting timeline
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: concurrency / data-integrity
- **File**: src/lib/db/scans-recommendations.ts:51 (read) → :102-121 (write)
- **Scenario**: Two members open the same backlog row. A sets status `open → done`; B (a moment later) sets `open → dismissed`. Both PATCHes call `findUnique` and each reads `current.status === "open"`, so each computes `from = "open"`, both pass the change-detection guard, and the two `$transaction`s run last-write-wins. The row ends `dismissed`, but the event timeline now holds BOTH `status: open→done` AND `status: open→dismissed`, and two `recommendation.updated` audit rows — a permanent record of a transition (`→done`) that the live row never reflects. The same applies to assignee/targetDate edits and to one user editing in two tabs.
- **Root cause**: `update({ where: { id }, data })` keys only on `id`; the captured `current` snapshot is never re-asserted as a precondition. The transaction is atomic but not isolated against a concurrent transaction that read the same pre-image. This is the documented OPEN follow-up (no concurrency/version guard).
- **Impact**: Silent lost update of status/assignee/due-date, plus an audit + activity timeline (the compliance product) that disagrees with the recommendation's actual state — the very divergence the in-tx audit/event coupling was meant to prevent, reintroduced via interleaving.
- **Fix sketch**: Make the write conditional on the read pre-image: `updateMany({ where: { id, status: current.status, assigneeLogin: current.assigneeLogin, targetDate: current.targetDate }, data })` inside the tx and treat `count === 0` as a 409 (stale) the client retries; or add a `version`/`updatedAt` optimistic-lock column bumped per write and require `where: { id, version }`. Surface 409 to RecommendationTracker as a refetch-then-retry rather than a silent overwrite.

## 2. List endpoint (`GET /api/recommendations`) omits the in-flight loading/error state in the consuming tracker — failures are invisible on first render path, and a 500/503 from the page loader silently degrades to "no roadmap"
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: error-state / silent-failure
- **File**: src/app/api/recommendations/route.ts:36-39 ; src/components/report/ReportView.tsx:232-236
- **Scenario**: The route returns 500 (`Failed to load recommendations.`) or 503 (DB off) when the recommendation read throws/disabled. The report view chooses `recs && recs.length > 0 ? <RecommendationTracker/> : <RoadmapSteps/>`. When the fetch errors (recs null/undefined) the UI silently falls back to the static `RoadmapSteps` with no indication that *tracked* status could not be loaded — a member who already set statuses sees the un-tracked list with no error, and may re-do work or assume tracking is gone.
- **Root cause**: The "has recs" branch conflates "no recommendations" with "recommendations failed to load"; there is no distinct error/empty/degraded state plumbed from the loader to the view.
- **Impact**: Silent data-availability failure presented as a normal (static) report; user can't tell tracking is down vs. genuinely empty.
- **Fix sketch**: Distinguish load-error from empty in whatever fetches `recs` (e.g. a `recsError` flag), and render a small inline notice ("Couldn't load tracked progress — showing the static roadmap. Retry.") above `RoadmapSteps` when the load failed, mirroring the per-row error affordance the tracker already has.

## 3. A single `note` on a multi-field PATCH is duplicated onto every change event, mis-attributing it
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-modeling / audit-fidelity
- **File**: src/lib/db/scans-recommendations.ts:75-97
- **Scenario**: A PATCH body carries `{ status, assigneeLogin, targetDate, note: "blocked on infra" }` (the route accepts all four together). The `event()` helper closes over the same `note`, so the one note is written verbatim onto the `status`, `assignee`, AND `target_date` timeline rows. The activity feed then shows the same explanatory note three times, attached to changes it wasn't about (e.g. a due-date bump now reads "blocked on infra").
- **Root cause**: `note` is treated as a property of the *request* but stored as a property of each *event*; with multiple events per request there's no 1:1 mapping.
- **Impact**: Noisy, misleading timeline/audit trail (the compliance surface); a note meant for one field annotates unrelated changes.
- **Fix sketch**: Attach `note` only to the most salient single event (e.g. the status change if present, else the first), or model the note at the request level (one row per PATCH that the per-field events reference), rather than copying it onto every event.

## 4. Optimistic status is never reconciled with the server's returned row — UI can drift from persisted state
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: state-sync
- **File**: src/components/report/RecommendationTracker.tsx:88-108
- **Scenario**: On a successful PATCH the tracker keeps its optimistic value and discards the JSON response (`res.ok` branch only announces; never `setItems` from `await res.json()`). If the server ever normalizes/coerces the saved value (or a concurrent write changed it — see #1), the row's displayed status, the "done of total" count, and the % bar reflect what the client *sent*, not what was *stored*, until a full reload.
- **Root cause**: Optimistic update with no confirm-from-response step; the returned `PersistedRecommendation` is thrown away.
- **Impact**: Transient client/server divergence in the progress summary; compounds #1's lost-update by hiding it from the actor.
- **Fix sketch**: On success, `const saved = await res.json()` and `setItems((cur) => cur.map(i => i.id === id ? { ...i, ...saved } : i))` so the row and the derived counts track the authoritative server state.

## 5. Roadmap sandbox "Reset"/"Close all gaps" controls have no live announcement, and the sandbox's only status output is the score headline
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: a11y
- **File**: src/components/report/RoadmapSandbox.tsx:64-66, 92-94, 108-124
- **Scenario**: The polite live region announces only the projected score/level. Pressing "Close all gaps" or "Reset" (or "Simulate this path") moves every slider at once, materially changing posture/radar/axis stats, but a screen-reader user hears only the score number change with no indication that a bulk action occurred or that sliders were reset/maxed. The buttons also lack `aria-pressed`/descriptive labeling for their effect.
- **Root cause**: The live region is scoped to the headline only; bulk-mutating controls don't contribute an announcement of what they did.
- **Impact**: Screen-reader users get an incomplete model of large state changes triggered by the bulk buttons.
- **Fix sketch**: Extend the live-region text (or add a transient one) to announce bulk actions, e.g. "All dimensions set to 100" / "Sliders reset to current scores" / "Simulated fastest path: <dims>", and give the bulk buttons `aria-label`s describing their effect.

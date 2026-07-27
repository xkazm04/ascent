# Goals & Initiatives — ambiguity+ui scan (2026-07-16)
> Total: 5 (Critical: 0, High: 2, Medium: 3, Low: 0)

## 1. Goal PATCH accepts any `status` string — and the goal status vocabulary is undocumented and inconsistent across surfaces
- **Severity**: High
- **Category**: edge-case-gap
- **File**: `src/app/api/org/goals/[id]/route.ts:46` (also `src/lib/db/plan.ts:341`, `src/components/org/plan/GoalsOverview.tsx:11`)
- **Scenario**: The initiatives PATCH validates `status` against `REC_STATUSES` (initiatives/[id]/route.ts:30), but the goals PATCH passes `body.status` straight into `updateGoal`, which writes it verbatim (`...(data.status ? { status: data.status } : {})`). Any member can persist `status: "banana"` — or set `"achieved"` on a goal that never reached target, minting a fake "🎉 Achieved" chip (listGoals only reverts it when `current < target`, so a target already met by pct rounding sticks). Meanwhile the implicit vocabulary is inconsistent: `GoalsPanel` partitions on `"achieved"`, `GoalsOverview` filters on `"archived"` — a status nothing in the codebase ever sets — so achieved goals occupy the overview's 3-card limit and can crowd out every active goal.
- **Root cause**: No `GOAL_STATUSES` constant exists; each surface hardcodes its own guess at the enum, and the write path never validates because the enum was never declared.
- **Impact**: Unvalidated persisted state; a spoofable "Achieved" milestone (achievedAt gets stamped on the next listGoals pass via the symmetric transition only if current>=target — otherwise status/achievedAt drift apart); dead `"archived"` branch; overview showing met goals instead of the active ones leaders need.
- **Fix sketch**: Declare `GOAL_STATUSES = ["active", "achieved"] as const` (plus `"archived"` if it's a real intended state) next to `isGoalMetric` in plan.ts; reject other values in the PATCH route like the initiatives route does; make `GoalsOverview` filter `status === "active"` (or prioritize active over achieved in the slice). If `"archived"` is intended, add the UI to set it; otherwise delete the filter.

## 2. Removing an *achieved* goal skips the delete confirmation the active path requires
- **Severity**: High
- **Category**: missing-state
- **File**: `src/components/org/plan/GoalsPanel.tsx:180`
- **Scenario**: Active goals' "remove" button calls `setPendingDeleteId(g.id)` and routes through `ConfirmAction`/`goalDeleteConfirm` (line 154) — the component's own comment says deletion "hard-deletes the goal AND its achievement history — irreversible, so it only REQUESTS deletion". But in the collapsed "Met" section the identically-styled button calls `remove(g.id)` directly: one click, no dialog, goal and its `achievedAt` milestone gone.
- **Root cause**: The achieved-goals `<details>` block (GOAL-4) was added after the confirm flow and wired to the raw handler instead of the pending-delete state.
- **Impact**: The goals with the *most* history worth preserving (the achieved ones — their achievedAt is the org's record of when a target was met) are the only ones deletable by an accidental click. Same-looking control, different blast radius — a consistency and data-loss trap.
- **Fix sketch**: Change line 180's `onClick` to `() => setPendingDeleteId(g.id)`; the existing modal already names the goal via `goalDeleteConfirm(pendingDelete.label)`.

## 3. The optimistic-lock `expected` protocol is never sent by any client — the 409 path it was built for can't fire
- **Severity**: Medium
- **Category**: trade-off-undocumented
- **File**: `src/components/org/plan/InitiativesPanel.tsx:97-101` (server: `src/lib/db/plan.ts:333-364,541-570`)
- **Scenario**: `updateGoal`/`updateInitiative` implement a careful compare-and-set keyed on the editor's last-seen values (`expected`), with `GOAL_CONFLICT`/`INIT_CONFLICT` → 409 "refresh and retry". But `InitiativesPanel.patch()` posts only the patch body, and no client anywhere sends `expected` (the goals PATCH has no UI caller at all — label/target/status editing has no surface). Without `expected`, the server falls back to its own just-read pre-image, shrinking the guarded window from "since the editor loaded the page" to the milliseconds between the `findUnique` and the `updateMany`.
- **Root cause**: The server half of the stale-write protocol (goals-initiatives #1) shipped without the client half; the code comments describe the intended contract but nothing enforces or exercises it.
- **Impact**: The exact scenario the mechanism documents — two admins with stale tabs moving the same status/assignee — still resolves last-write-wins silently. The client-side 409 handling ("refetch and retry") is also unwritten, so if `expected` is ever added the UI will just show a generic error and revert. Readers of plan.ts reasonably believe lost updates are handled; they aren't.
- **Fix sketch**: Have `patch()` include `expected: { [field]: currentRow[field] }` from the row it rendered, and on a 409 call `refresh()` before surfacing "changed concurrently — reloaded, please retry". Alternatively, document in plan.ts that the fallback path is best-effort-only until a client sends `expected`.

## 4. Undocumented planning constants: the +12 lift, the 70 adoption floor, and the hardcoded initiative target of 70
- **Severity**: Medium
- **Category**: magic-number
- **File**: `src/app/org/[slug]/plan/page.tsx:77,85-86` (also `src/components/org/plan/InitiativesPanel.tsx:70`, `src/lib/db/plan.ts:478`)
- **Scenario**: Goal suggestions propose "weakest dimension `avg + 12`" and "AI Adoption to 70" (shown only when `avgAdoption < 70`); every seeded initiative posts `targetScore: 70`, and `createInitiative` defaults to 70 when omitted. None of these carry a rationale: why 12 points (a quarter's realistic lift? a band width?), why 70 is both the adoption floor and the universal per-dimension bar, whether 70 relates to a maturity band boundary in `LEVELS`.
- **Root cause**: Product-tuning values inlined at three call sites during GOAL-5/seed work, never lifted to named constants; the 70s aren't even shared — the panel hardcodes what the DB layer defaults.
- **Impact**: A leader is told "70" is the target with no way to know it's arbitrary; tuning the bar means finding three files; if `LEVELS` bands ever shift, these silently stop aligning with the maturity model they're meant to serve. Initiative progress ("X/Y repos there") is measured against a number nobody chose per-initiative.
- **Fix sketch**: `export const SUGGESTED_GOAL_LIFT = 12` and `export const DEFAULT_INITIATIVE_TARGET = 70` (with a one-line "why" comment, ideally derived from a `LEVELS` band edge) in the maturity model or plan.ts; have InitiativesPanel omit `targetScore` and let the single server default rule — or better, let the tracker pick a target in the UI.

## 5. `pct` measures absolute standing, not progress — a goal can be born "90% complete" (or instantly achieved) having moved nothing
- **Severity**: Medium
- **Category**: undocumented-assumption
- **File**: `src/lib/db/plan.ts:287`
- **Scenario**: `pct = round(current / target * 100)` (clamped 0..100; `target 0` → 100). A fleet at overall 45 that sets "reach 50" shows a 90%-full meter on day one; set a target at or below today's value and `listGoals` immediately stamps it achieved with a 🎉 and today's date, since the achieved transition is just `current >= target` with no baseline. The doc comment says only "0..100 progress toward the target", leaving the semantics ambiguous — most goal UIs mean progress *from the starting value*.
- **Root cause**: Goals don't record the metric value at creation time, so distance-travelled (`(current − baseline) / (target − baseline)`) is impossible to compute; the ratio-to-target was the only formula available and the trade-off was never written down.
- **Impact**: The headline meter systematically overstates progress and understates remaining work (the readout and pace verdict are honest, the meter isn't — they can contradict each other: 90% meter, "Behind" chip). Instantly-achieved goals pollute the "Met 🎉" history with milestones that represent zero movement.
- **Fix sketch**: Store `baseline` (the metric's value) on `createGoal` and compute `pct` as normalized distance from baseline, falling back to the current formula for legacy rows; or at minimum reject/flag `target <= current` at create time ("already at 47 — pick a higher target") and document the ratio semantics in the `pct` doc comment.

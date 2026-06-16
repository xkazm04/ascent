# Goals & Initiatives — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 0, High: 2, Medium: 2, Low: 1)
> Lens split: bug-hunter 3 / ui-perfectionist 2
> Files read: 7

## 1. Goal PATCH accepts any `status` string — no enum validation, corrupts the achieved/active state machine
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: input validation / db integrity
- **File**: src/app/api/org/goals/[id]/route.ts:25-35
- **Scenario**: A member PATCHes `/api/org/goals/:id` with `{ "status": "lol" }`. The handler validates `targetDate` but never validates `status`; it passes the body straight to `updateGoal`, which writes any truthy string (`data.status ? { status: data.status } : {}` in plan.ts:317). The row now has `status: "lol"`.
- **Root cause**: The sibling initiatives PATCH guards status against a `STATUSES` set (initiatives/[id]/route.ts:12,27-29), but the goal PATCH has no equivalent. `updateGoal` (plan.ts:310-325) also trusts the caller.
- **Impact**: The whole goal UI keys off exact status values. `GoalsPanel` splits on `status === "achieved"` (GoalsPanel.tsx:108,125,132), `GoalsOverview` filters `status !== "archived"` (GoalsOverview.tsx:11), and `goalImpactsForScenario` queries `status: "active"` (plan.ts:551). A junk status makes a goal silently vanish from the simulator coupling and the "Met" group, or strands it in the active list forever. It also lets a client overwrite the server-managed `"achieved"` transition.
- **Fix sketch**: Add `const GOAL_STATUSES = new Set(["active","achieved","archived"])` and reject `body.status !== undefined && !GOAL_STATUSES.has(body.status)` with 400, mirroring the initiatives route.

## 2. Goal progress meter shows "movement" but computes absolute position — a goal at its starting line reads 80–98% done
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: progress calculation / misleading metric
- **File**: src/lib/db/plan.ts:283
- **Scenario**: Leader creates "Lift D5 from its current 40 to 50". The fleet hasn't moved, `current=40`, `target=50`, so `pct = round(40/50*100) = 80`. The meter and any percent read show 80% progress before a single point of real movement. A goal "Adoption to 70" while already at 65 reads 93% with zero work done.
- **Root cause**: `pct` is `current/target*100` (position toward zero-origin), not `(current − baseline)/(target − baseline)` (movement from where the goal started). No baseline is captured at goal creation (createGoal, plan.ts:220-242, stores only target).
- **Impact**: Every goal looks near-complete on day one; the progress bar is decorative rather than informative, and the `belowCount`/laggard list is the only honest signal. This is the core deliverable of the panel ("track progress against the fleet's actual movement") and it overstates progress systematically. Note `GoalCard`'s `Meter` (goalView.tsx:148-153) sidesteps this by plotting raw `current` with the `target` as a threshold marker, which is correct — but the numeric `pct` exposed by the API and reused elsewhere is not.
- **Fix sketch**: Capture `baselineValue` at creation; compute `pct` over the `baseline→target` span, clamped, with target≤baseline handled (already-met ⇒ 100). Until then, document `pct` as "position" and prefer the threshold meter everywhere.

## 3. Initiative `goalId` link is never validated against the org — cross-tenant / dangling foreign reference
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: authz / referential integrity
- **File**: src/app/api/org/initiatives/[id]/route.ts:34 (and POST: src/app/api/org/initiatives/route.ts:53)
- **Scenario**: A member of org A PATCHes their initiative with `{ "goalId": "<a goal id from org B>" }`. The org gate only checks the *initiative's* org (getInitiativeOrgSlug, route.ts:17-20); the `goalId` is written verbatim by `updateInitiative` (plan.ts:467) with no ownership/existence check. Same gap on create (plan.ts:408).
- **Root cause**: No `goal.findFirst({ where: { id, orgId } })` validation before persisting the link, on either create or patch.
- **Impact**: Limited leakage today because read-time resolution scopes labels to the org's own goals (`goalLabelById`, plan.ts:428,446), so a foreign id resolves to a null label. But the DB stores a cross-tenant pointer, the GOAL-6 cross-render grouping (page.tsx:61-65) can be skewed, and a future join that trusts `goalId` would leak another tenant's goal. It also allows linking to a non-existent / deleted goal id silently.
- **Fix sketch**: Before writing, verify the goal exists and shares the initiative's `orgId`; reject with 400/404 otherwise. Reuse `resolveOrgId` + a scoped `goal.count`.

## 4. Initiative progress bar shows 0% for an empty scope and gives no signal that the bar is meaningless
- **Severity**: Medium
- **Lens**: ui-perfectionist
- **Category**: progress visualization / empty state
- **File**: src/components/org/plan/InitiativesPanel.tsx:113,136
- **Scenario**: An initiative is seeded from a fleet move whose repos didn't map to fullNames (page.tsx:56 `.filter(...)` can yield `[]`), or all scoped repos are later unscanned. `i.progress.total === 0`, so `pct = 0` (the `total ? … : 0` guard), and a flat empty green meter renders — visually identical to "0 of 20 repos done", when it actually means "nothing in scope to measure".
- **Root cause**: The `total === 0` case is collapsed to `0%` and still draws a `Meter`, with the caption reading "0/0 repos there" (line 120) — no distinct empty-scope treatment.
- **Impact**: A leader reads a real-looking 0% progress bar for an initiative that can never progress, with no nudge to fix its scope. Indistinguishable from genuine no-progress.
- **Fix sketch**: When `total === 0`, replace the meter with a muted "no scoped repos — add repos to track progress" line (the `InlineEmpty` treatment from ui.tsx already exists), and/or surface it as a warning chip.

## 5. Native form controls lack labels/ARIA — date pickers, status/goal selects, and the assignee input are unlabeled for assistive tech
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility (a11y)
- **File**: src/components/org/plan/GoalsPanel.tsx:170-207 (and InitiativesPanel.tsx:124-176)
- **Scenario**: A screen-reader user tabs into the Goals create row. The label `<input>` has only a placeholder (no `aria-label`), the metric `<select>` and `target`/`by` inputs rely on adjacent visual text not programmatically associated (the `<label>` wraps the visible word but the control has no name announced consistently across the date input), and in InitiativesPanel the status `<select>` (line 124), goal `<select>` (line 164), and assignee `<input>` (line 142) have no accessible name at all.
- **Root cause**: Controls use placeholders and visual proximity instead of `aria-label`/associated `<label htmlFor>`; the per-row status/goal selects carry no label text since they read from `value`.
- **Impact**: Keyboard/AT users can't tell which select changes an initiative's status vs. its linked goal, or what the bare date field is for. Fails WCAG 2.1 SC 1.3.1 / 4.1.2.
- **Fix sketch**: Add `aria-label` to each control (e.g. `aria-label="Goal label"`, `aria-label="Initiative status"`, `aria-label="Linked goal"`, `aria-label="Due date"`, `aria-label="Assignee GitHub login"`). No visual change required.

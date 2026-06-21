> Total: 6 findings (0 critical, 1 high, 3 medium, 2 low)

# Goals & Initiatives — combined bug+ui scan

## 1. Overview "active" filter checks the wrong status — achieved goals crowd out active ones
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: logic / data-display
- **File**: src/components/org/GoalsOverview.tsx:11
- **Scenario**: An org has 5 goals; 3 of them reached their target (so `listGoals` stamped `status: "achieved"`, newest-first) and 2 are still `active`. On the org overview, `GoalsOverview` does `goals.filter((g) => g.status !== "archived")` and then `.slice(0, 3)`. Nothing in the codebase ever sets `status === "archived"` — `listGoals` only transitions `active → achieved` (plan.ts:285,304), and the schema's third state `archived` (schema.prisma:420) is never written. So the filter is a no-op: the top-3 slots get filled with the most recent (achieved) goals, and the active goals the leader actually needs to watch are pushed off the overview entirely.
- **Root cause**: The overview filters on a status value (`archived`) that the goal lifecycle never produces, while the real "hide from the working list" status is `achieved` (which the sibling `GoalsPanel` correctly excludes from its active section at GoalsPanel.tsx:108). The two surfaces disagree on which goals are "active".
- **Impact**: UX / misleading dashboard — the overview can show only already-met goals and silently hide every in-progress goal, the opposite of its purpose ("top few active goals").
- **Fix sketch**: Filter `g.status !== "achieved" && g.status !== "archived"` (or reuse the same predicate as GoalsPanel), so achieved goals drop off the overview's top-3 and active ones surface.

## 2. POST goals/initiatives auto-creates an organization row for any slug a viewer names
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: data-integrity / authorization
- **File**: src/lib/db/plan.ts:226 (createGoal), src/lib/db/plan.ts:393 (createInitiative)
- **Scenario**: Under the Supabase login wall (or fully auth-off), `requireOrgAccess(org)` returns null for *any* org slug for a signed-in viewer (authz.ts:33-49 — "simple-wall semantics: a signed-in viewer may act on any org"). `createGoal`/`createInitiative` then call `prisma.organization.upsert({ where: { slug }, create: {...} })`, which *creates* a brand-new org row for a slug that may not correspond to any real installation. A user can POST `{ org: "acme-corp", ... }` and materialize an `acme-corp` org with a goal attached.
- **Root cause**: The create path uses `upsert` (a leftover from the public-funnel pattern) instead of resolving an existing org; combined with the documented open write-gate, it lets callers conjure tenant rows. The read path correctly uses `resolveOrgId` and returns `[]` for unknown slugs (plan.ts:252-253), so write and read disagree.
- **Impact**: Tenant-namespace pollution / squatting on org slugs; spurious org rows that later read paths and rollups will treat as real.
- **Fix sketch**: In create, resolve the org via `resolveOrgId` and refuse (return null → 500/404) when it doesn't exist, except for the intentional `public` funnel; reserve `upsert` for the public org. (Ties into the tracked any-member-write follow-up in authz.ts.)

## 3. Optimistic initiative edits are never rolled back or surfaced when the PATCH fails
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / error-handling
- **File**: src/components/org/plan/InitiativesPanel.tsx:84-97
- **Scenario**: Changing an initiative's status / assignee / due date / linked goal calls `patch()`, which optimistically mutates local state and then `await fetch(... PATCH ...)` with no `res.ok` check and no `try/catch`. If the request 403s (lost access), 404s (initiative deleted in another tab), 500s, or the network drops, the UI keeps showing the new value as if it saved. A reload reverts it, but the user gets no feedback and believes the change persisted.
- **Root cause**: The optimistic update has no failure branch — unlike the create/`track` and goal flows, which check `res.ok` and set `error`. The component already has an `error` state and renders it (line 218); `patch` just doesn't use it.
- **Impact**: Silent data-loss perception — assignments/due-dates/status moves appear saved but aren't; no error shown.
- **Fix sketch**: Snapshot the prior item, check `res.ok` in `patch`, and on failure restore the snapshot + set `error` (mirroring `track()` and the goal panel's pattern).

## 4. Goal with target 0 always reports 100% progress and renders a meaningless meter
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: edge-case / progress-computation
- **File**: src/lib/db/plan.ts:283
- **Scenario**: POST `/api/org/goals` only requires `typeof target === "number"` (route.ts:25); `createGoal` clamps it to 0..100, so `target: 0` is accepted and stored. In `listGoals`, `pct: g.target > 0 ? ... : 100` forces `pct = 100`, and `reached = current >= 0` is always true, so the goal is immediately flagged achieved on the next read regardless of the fleet. The "must move" laggard list (`r.value < 0`) is always empty too.
- **Root cause**: A target of 0 is a degenerate goal ("reach a score of 0") that the validation allows but the progress/achievement math can't represent meaningfully; the guard papers over the divide-by-zero with a constant rather than rejecting the input.
- **Impact**: A nonsensical goal silently auto-"achieves" and pollutes the achieved group; minor data quality.
- **Fix sketch**: Reject `target < 1` at the POST route (and `updateGoal`) with a 400, or treat target 0 as invalid in `createGoal`.

## 5. Goal PATCH accepts any arbitrary string as status (no enum validation)
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: input-validation
- **File**: src/app/api/org/goals/[id]/route.ts:21-35
- **Scenario**: The initiatives PATCH validates `status` against a `STATUSES` set (initiatives/[id]/route.ts:12,27), but the goals PATCH passes `body.status` straight through to `updateGoal` (plan.ts:316-318) with no allow-list. A client can PATCH a goal to `status: "banana"`, persisting an out-of-band value. `GoalsPanel` then shows it in the active list (it's not `"achieved"`), and the achieved/active grouping logic stops matching it.
- **Root cause**: The two sibling endpoints diverge — goals lost the status allow-list its sibling has. Goal status is meant to be `active | achieved | archived` (schema.prisma:420).
- **Impact**: Data-integrity drift; minor (no UI currently sets goal status, so reachable only via direct API).
- **Fix sketch**: Validate `body.status` against `{active, achieved, archived}` and 400 on mismatch, mirroring the initiatives route.

## 6. Initiative progress meter has no accessible label or text alternative
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: accessibility
- **File**: src/components/org/plan/InitiativesPanel.tsx:136 (and goalView.tsx:148 via Meter)
- **Scenario**: The `Meter` (ui.tsx:148-174) is a pure styled `<div>` with width %, no `role="progressbar"`, `aria-valuenow/min/max`, or `aria-label`. For initiatives the only on-screen progress text is "{atTarget}/{total} repos there"; for a goal the meter's value/target is in adjacent text but never associated with the bar. A screen-reader user gets no announcement of the visual progress, and the bar conveys the headline state purely by color/width.
- **Root cause**: The shared `Meter` primitive was built visual-first with no ARIA, and the goals/initiatives surfaces (the only ones with a hard numeric progress meaning) don't compensate.
- **Impact**: a11y — progress is invisible to assistive tech across the entire planning surface.
- **Fix sketch**: Add `role="progressbar"` + `aria-valuenow={pct}` `aria-valuemin={0}` `aria-valuemax={100}` and an `aria-label` (e.g. "Progress: 3 of 5 repos at target") to `Meter`, or pass an `aria-label` prop from the goal/initiative callers.

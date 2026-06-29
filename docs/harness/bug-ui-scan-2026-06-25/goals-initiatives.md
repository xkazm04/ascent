# Goals & Initiatives — Bug + UI Scan
> Context: Goals & Initiatives (Org Planning & Execution)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. A goal that regresses below target stays "Achieved 🎉" forever and is hidden from the active list
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: state-corruption
- **File**: src/lib/db/plan.ts:272-285, 300-306 · src/components/org/plan/GoalsPanel.tsx:108,125 · src/components/org/plan/goalView.tsx:125-131
- **Value**: impact 8 · effort 4 · risk 3
- **Scenario**: A fleet hits its overall-maturity goal once, so `listGoals` stamps `status: "achieved"` / `achievedAt` (plan.ts:273-285, persisted 300-306). Later the fleet regresses and `current` drops below `target`. On the next load `reached` is false, but `newlyAchieved = reached && g.status === "active"` is also false (status is now "achieved"), so the status is never reverted. GoalsPanel filters `g.status !== "achieved"` (line 108) into the collapsed "Met" group (line 125), and GoalCard renders the green "🎉 Achieved" badge (goalView.tsx:125-131) even though `achieved`/`current` say otherwise.
- **Root cause**: "Achieved" is treated as a one-way latch with no un-achieve transition, and the UI keys entirely off the latched `status` rather than the live `current >= target`.
- **Impact**: The planning surface — whose whole job is "track progress against the fleet's actual movement" — silently hides a regression and shows a false win to leaders. `achieved` (false) and `status` ("achieved") also disagree, an internal contradiction other code could trip on.
- **Fix sketch**: Make the transition symmetric: if `g.status === "achieved" && current < g.target`, revert to `active` and clear `achievedAt` in the same best-effort write block. Or render the badge from live `goal.achieved`, not the latched `status`, and keep `achievedAt` only as a "first reached on" annotation.

## 2. Optimistic delete/patch with no rollback or error surfacing (Goals + Initiatives)
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/components/org/plan/GoalsPanel.tsx:73-76 · src/components/org/plan/InitiativesPanel.tsx:83-96
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: `remove(id)` drops the goal from local state, then fires `fetch(DELETE)` whose result is never inspected (GoalsPanel.tsx:74-75). If the request 403s (lost session), 404s, or fails on the network, the goal vanishes from the UI but still exists in the DB, and nothing re-fetches to correct it — the user believes it's gone. The same pattern is in InitiativesPanel.patch (lines 83-96): status/assignee/due/goal link are applied locally then PATCHed with the response ignored, so a failed write leaves the UI showing a state the server never accepted.
- **Root cause**: Optimistic UI updates without a failure path — no `res.ok` check, no rollback, no error toast (unlike `create`/`track`, which do surface errors).
- **Impact**: Data/UI divergence: deletes that didn't happen and status changes that didn't persist, both shown as success. On a leadership planning board this misrepresents state.
- **Fix sketch**: Await the response, check `res.ok`; on failure restore the prior item (snapshot before mutating) and set the existing `error` state. Reuse the try/catch+`setError` already present in `create`.

## 3. Seeded initiative advertises "affects N repos" but tracks only the repos that mapped
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/app/org/[slug]/plan/page.tsx:50-57 · src/components/org/plan/InitiativesPanel.tsx:70,203
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: Seeds map a recommendation's repo *names* to fullNames and silently drop any that don't resolve: `repos: r.repos.map((n) => nameToFull.get(n)).filter((x): x is string => !!x)` (page.tsx:55), while `repoCount` keeps the original count (line 56). The seed card shows "affects {repoCount} repos" (InitiativesPanel.tsx:203), but `track()` POSTs the filtered `seed.repos` (line 70). If some/all names fail to map (rename, casing, repo not in the latest-scan snapshot), the created initiative scopes fewer — possibly zero — repos, then renders "0/0 repos there" with a 0% meter despite the card promising N.
- **Root cause**: Two different repo counts (the rec's pre-map count vs. the post-map scoped list) are surfaced as if they were the same number; the empty-scope case isn't guarded.
- **Impact**: Misleading affected-repo count and a tracked program that may cover nothing (0/0 → permanently 0% progress) — confusing and undermines trust in the rollup.
- **Fix sketch**: Display the mapped scope length (`seed.repos.length`), not `repoCount`; hide/disable "Track" when `seed.repos.length === 0`; or surface "(X of N repos matched current scans)".

## 4. Create/edit form controls have no accessible names
- **Lens**: ui-perfectionist
- **Severity**: medium
- **Category**: a11y
- **File**: src/components/org/plan/GoalsPanel.tsx:171-183 · src/components/org/plan/InitiativesPanel.tsx:123-133,141-149
- **Value**: impact 5 · effort 2 · risk 1
- **Scenario**: The goal-label text input has only a `placeholder` (GoalsPanel.tsx:171-176) and the metric `<select>` (177-183) has no associated label, so a screen reader announces "edit text, blank" and "combo box". In InitiativesPanel the per-row status `<select>` (123-133) is unlabeled and the assignee input's only label text is "@" (141-149). (The "target"/"by"/"due"/"goal" inputs are correctly wrapped in `<label>`.)
- **Root cause**: Visible-label discipline is applied to some fields but skipped for the primary inputs, relying on placeholders/adjacent glyphs that AT doesn't treat as names.
- **Impact**: Keyboard/AT users can't identify the most important controls on the planning surface (what a goal is named, which metric, an initiative's status/owner).
- **Fix sketch**: Add `aria-label` (e.g. `aria-label="Goal name"`, `"Goal metric"`, `"Initiative status"`, `"Assignee GitHub login"`) or wrap each in a `<label>` like the sibling fields already do.

## 5. Client-side goal suggestions go stale, so a metric already covered can be re-added as a duplicate
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/app/org/[slug]/plan/page.tsx:73-87 · src/components/org/plan/GoalsPanel.tsx:45,47-50,52-71
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: Suggestions are de-duplicated against active metrics only on the server, at page render (`activeMetrics`, page.tsx:73-87) and seeded once into `picks` (GoalsPanel.tsx:45). After the user manually adds a goal via the form, `create()` calls `refresh()` which only re-fetches goals (lines 47-50) and never recomputes `picks`. The "+ Lift D3 …" chip for the metric just covered stays visible, and clicking it creates a second goal on the same metric (the API has no per-metric uniqueness check).
- **Root cause**: Suggestion de-dup lives server-side but the suggestion list is client state that isn't reconciled after client-side goal creation.
- **Impact**: Duplicate goals on one metric clutter the board and split progress attention; minor, recoverable by removing one.
- **Fix sketch**: After any successful create (manual or suggested), filter `picks` to drop suggestions whose `metric` now appears among active goals; or recompute suggestions client-side from the refreshed goal list.

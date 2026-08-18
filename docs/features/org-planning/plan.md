# Planning: what remains after the Plan and Backlog tabs (retired 2026-08-17)

**The Plan tab and the Backlog tab are gone.** They were planning machinery sized for a quarter —
goals with owners and pace, initiatives, a what-if simulator, an owner/due-date backlog, a debt
statement, a detector-calibration list — for work that is usually one Claude Code session per repo.
The **[Follow-ups ledger](../org-followups/README.md)** (`?tab=followups`, Standing) replaced them
for that common case: every open gap in one table, tick a batch, one fix prompt for a local agent,
and the next default-branch scan closes what landed. Three ideas were ported into it because they
fit a mass-scan world (10–20 items per repo): **bulk resolve/dismiss** (from Backlog), the
**org-wide gap call** — a dimension open in ≥ half the fleet is a practice to fix once (from Plan's
gap decomposition) — and the **per-row timeline** (from Backlog). The **transition programme**
control (W1c) moved to the Briefing tab.

Everything below is what still exists in this area and what it is for.

## Goals

A goal is a fleet-level target. Its progress is **live**: recomputed from the latest scan
per repo, never stored as a snapshot.

- **Model:** `Goal { id, orgId, label, metric, target (0–100), status, createdAt }`, where
  `metric` ∈ `overall | adoption | rigor | D1…D9` (validated by `isGoalMetric`).
- **API** (`src/app/api/org/goals/route.ts`, `…/goals/[id]/route.ts`):
  - `GET ?org=` → `{ goals: GoalProgress[] }` (with current value per goal).
  - `POST { org, label, metric, target }` → `{ id }`.
  - `PATCH /:id { status?, target?, label? }`, `DELETE /:id`.
  - Writes require a session when auth is configured.
- **UI:** `src/components/org/plan/GoalsPanel.tsx` lists goals (label, current/target,
  progress meter) and a create form, refreshing via the GET after each change.
- **DB:** `createGoal`, `listGoals` (computes progress through `currentFor(metric, snap)`),
  `updateGoal`, `deleteGoal`.


**Goals are READ, not managed, since 2026-08-17.** The GoalsPanel retired with the Plan tab, so
there is no in-app way to create or edit a goal; the write API (`/api/org/goals`) is kept because
the seed route and any external caller still use it. The read paths that made goals worth keeping
for now: the executive briefing's goals card, the live wall's goal banner, the overview's fix-first
band ("behind the pace its deadline needs" now sends the reader to the Follow-ups ledger), and the
digest alerts. Goals duplicate the transition programme's single named commitment and are the next
retirement candidate; when that happens those four readers lose a branch each, nothing else.

## Transition programme

Documented in [org-intelligence.md](../org-dashboard/org-intelligence.md) (W1c). Its control panel
(`ProgramPanel`: start / re-target / pause / end) now renders on the **Briefing** tab
(`src/components/org/intelligence/executive/ProgramPanel.tsx`), which is where the shell's
`ProgramStrip` and the getting-started "programme" step link.

## Executive briefing, live wall, playbooks

Unchanged by the retirement and documented where they live: the briefing and its PDF in
[org-intelligence.md](../org-dashboard/org-intelligence.md); playbooks in
[practices.md](../org-dashboard/practices.md).

## Retired on 2026-08-17 (for the record)

| Was | Where it went |
| --- | --- |
| Backlog tab (owners, due dates, owner/due grouping, undo, CSV, bulk assign) | Follow-ups ledger; bulk resolve/dismiss + timeline ported; owners/due dates dropped (`assigneeLogin`/`targetDate` columns remain on `Recommendation`, unread by the ledger). |
| Debt Ledger (rework/revert/exposure statement) | Deleted with the tab. `getOrgRework` (`src/lib/db/org-rework.ts`, W5 revert linkage) is now an **orphaned read** — real data, no consumer; a Delivery-tab home is the obvious next step. |
| Plan tab: initiatives (+ `CreateInitiativeButton` on Adoption, Delivery ROI, Tech-stack playbooks) | Deleted, incl. `/api/org/initiatives`, `createInitiative/listInitiatives/updateInitiative`, the `Initiative` nav count. Those three surfaces now link to the Follow-ups ledger scoped to the dimension (`?tab=followups&dim=Dn`). The `Initiative` table stays in the schema (no migration; rows are inert). |
| Plan tab: what-if simulator | Deleted, incl. `src/lib/scoring/orgsim.ts`, `/api/org/simulate`, `simulateOrgFixes/rankOrgInvestments/goalImpactsForScenario`. |
| Plan tab: gap decomposition (org vs repo problem) | Ported as the ledger's `org-wide N/M` tag + filter (`dimensionSpread`). `getOrgGapAnalysis` is now an orphaned read. |
| Plan tab: detector backlog (LLM auditor's suspected detector misses) | Deleted with the tab. `getOrgDiscrepancies` is now an orphaned read; calibration is documented in [calibration.md](../scanning/calibration.md) and needs a new (operator-side) home. |
| Plan tab: goals management | See *Goals* above. |
| `plan` / `backlog` tab ids, rail items, `OrgNavCounts.plan` | Removed; `OrgNavCounts.backlog` → `followups`. `/org/<slug>/plan` and `/backlog` remain as permanent redirects (links in inboxes) → `?tab=followups`. |

## Known gaps

- **Three orphaned reads** — `getOrgRework`, `getOrgGapAnalysis`, `getOrgDiscrepancies` — carry real
  data with no UI. Kept (tested) rather than deleted so a future home does not have to re-derive
  them; each is a decision, not an oversight.
- **Goals have no management UI.** Deliberate half-state, see above.
- (Closed 2026-08-14.) ~~Goal metrics are point-in-time.~~ Every `GoalProgress` row carries
  `series`, drawn by `GoalCard` (`src/components/org/shared/GoalTrend.tsx`).

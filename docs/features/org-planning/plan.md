# Planning: goals, initiatives & the simulator

The Plan tab (`src/app/org/[slug]/plan/page.tsx`) is the management layer over
[org intelligence](../org-dashboard/org-intelligence.md). It lets an org set maturity **goals**, track scoped programs
of work as **initiatives**, and run a deterministic **what-if simulator** to see a fix's
fleet impact before committing. It also surfaces the **detector backlog** (the LLM
auditor's suspected detector misses) for calibration. All three persist via
`src/lib/db/plan.ts` and require `DATABASE_URL`.

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

## Initiatives

An initiative is a tracked program of work scoped to a set of repos, often **seeded from a
fleet recommendation** (e.g. "Add AGENTS.md to these 8 repos").

- **Model:** `Initiative { id, orgId, title, dimId, practiceId?, targetScore (default 70),
  repos (JSON fullNames[]), status, createdAt }`, status ∈
  `open | in_progress | done | dismissed`.
- **API** (`src/app/api/org/initiatives/route.ts`, `…/initiatives/[id]/route.ts`):
  - `GET ?org=` → `{ initiatives }` with live progress (`atTarget / total` scoped repos at
    `targetScore` on `dimId`).
  - `POST { org, title, dimId, repos[], targetScore?, practiceId? }` → `{ id }`.
  - `PATCH /:id { status }` moves through the workflow.
- **UI:** `src/components/org/plan/InitiativesPanel.tsx` shows active initiatives (progress
  bar, status dropdown) plus a "**Start from a fleet move**" section that turns the top
  untracked `getOrgRecommendations` results into a one-click initiative.
- **DB:** `createInitiative`, `listInitiatives`, `updateInitiativeStatus`.
- **Seeding from the diagnostic tabs** (2026-08-14): the shared
  `src/components/org/plan/CreateInitiativeButton.tsx` files the already-constructed payload
  from four read surfaces straight into `POST /api/org/initiatives` (idempotent server-side
  on `(org, title, dimId)`):
  - **Delivery**: each ROI concern cohort (`AiRoiQuadrantActions`) tracks its repo set
    against the dimension its remedy moves (ungoverned→D6, idle→D1, shadow→D8).
  - **Tech Stacks**: a transformation playbook (`PlaybookDetail`) tracks its `dimId` +
    `target` as a fleet-scoped initiative.
  - **Adoption**: an enablement target (`EnablementTargets`) tracks a D1 enablement
    initiative naming the login in the title (no assignee: the person to enable is not the
    initiative's owner).
  - **Simulator**: saved scenarios carry their immutable `fixes` + concrete repo set, so a
    single-leg save can be committed as an initiative after the live form has moved on
    (multi-leg saves stay compare-only; per-leg looping was rejected as non-atomic).

An optional `practiceId` links an initiative to a [Practice Library](../org-dashboard/practices.md) item.

## Simulator (what-if)

The simulator answers "if we raise dimension D to target T across these repos, what happens
to the fleet?" (deterministically, with **no writes**).

- **Core** (`src/lib/scoring/orgsim.ts`): `simulateFleet(repos, fix, scope)`:
  1. `recomputeRepo(dims, archetype)` reproduces the live engine's archetype-weighted
     blend, so the *before* state matches actual scores.
  2. For in-scope repos currently below target, raise `dimId` to `target`.
  3. Recompute the *after* state.
  4. Return a `FleetProjection`: before/after snapshots (overall/adoption/rigor), per-repo
     deltas sorted by gain, and a promotions count (repos that cross a level).
- **API** (`src/app/api/org/simulate/route.ts`): `POST { org, dimId, target, repos? }` →
  `{ projection }`, via `simulateOrgFix` in `plan.ts` (which builds the latest-scan
  `FleetSnapshot` and calls `simulateFleet`).
- **UI:** `src/components/org/plan/Simulator.tsx` lets you pick a dimension + target + scope
  (all scanned repos or a checkbox subset), Simulate, and see affected repos, promotions,
  before/after with deltas, and the biggest movers. The result is read-only and never
  persisted.

## Debt Ledger (Backlog tab)

The Backlog tab (`src/components/org/plan/backlog/BacklogTab.tsx`) opens with the **Debt
Ledger** (W5, 2026-08-12): AI-era quality debt as a statement of account, rendered ABOVE
the working backlog panel (which keeps grouping, inline edits, search/filter, bulk actions
and CSV export; the ledger summarizes, the panel manages). The prototype's variant
switcher and mock data (`DebtSwitcher.tsx`, `debtMockData.ts`) are retired; every number is
real:

- **Principal / Overdue / Due-soon.** The backlog itself (`getOrgBacklog`): score points
  locked up in past-due recommendations (projected points, impact-based fallback for
  legacy scans), per repo and fleet-wide. The panel's old Overdue/Due-soon tiles moved up
  here.
- **Interest**: `reworkRate` (share of merged PRs later reverted; W5 revert linkage) from
  each repo's latest scan via `src/lib/db/org-rework.ts` (`getOrgRework`, mirroring
  `org-signals.ts`: latest-scan blobs, analyzed-PR-weighted fleet aggregates). A per-repo
  **AI interest** column shows `aiReworkRate` (the same over AI-involved merges).
- **Write-offs**: `revertRate` (revert-titled PRs, W1a). **Exposure**: the
  trailer-grounded `aiTrailerRate` (W2) where measured, falling back to the marker-based
  `aiInvolvedRate` and labeled as the fallback.
- **Pressure** (row sort + verdict tone): a 0–100 composite over the MEASURED terms only
  (overdue principal 45% · rework 35% · write-offs 20%, weights renormalizing when a rate
  is null), documented in `debtModel.ts`.

**Null discipline:** a repo whose latest scan predates rework tracking, has no PR data, or
is under the ≥5-sample floors renders an honest "—" with the reason in the tooltip and the
ledger's field notes ("scan predates rework tracking; re-scan to measure"), never a zero.
The rework rates are **lower bounds** (window-scoped matcher; renamed reverts escape),
stated in the field notes.

**Deferred:** *AI churn share* (rework landing on AI-authored lines) has no real signal yet:
it needs per-PR file paths (tier B churn ingest, pairs with stance path-zone enforcement).
The prototype's mock column was removed rather than faked; it returns with its signal.

## Detector backlog

`getOrgDiscrepancies(slug)` aggregates the LLM auditor's flagged signals (where it thinks a
detector under/over-counted), grouped by dimension with examples. The Plan page renders
this as a calibration backlog: the human-in-the-loop signal for improving the
deterministic detectors.

## Key files

| File | Role |
| --- | --- |
| `src/app/org/[slug]/plan/page.tsx` | Plan tab host (goals, simulator, initiatives, detector backlog). |
| `src/components/org/plan/GoalsPanel.tsx` | Goals CRUD + live progress. |
| `src/components/org/plan/InitiativesPanel.tsx` | Initiatives CRUD + seeding from fleet moves. |
| `src/components/org/plan/Simulator.tsx` | What-if form + projection display. |
| `src/lib/db/plan.ts` | Goals, initiatives, `simulateOrgFix`, `fleetSnapshot`, `currentFor`. |
| `src/components/org/plan/backlog/debt/` | Debt Ledger: `DebtLedger.tsx` (the statement), `debtModel.ts` (backlog × rework join, pressure composite), `debtParts.tsx` (field notes, rate cells, verdicts). |
| `src/lib/db/org-rework.ts` | Fleet rework read: per-repo `reworkRate`/`aiReworkRate`/`revertRate`/exposure from latest-scan `prStats` blobs + weighted fleet aggregates (`buildOrgRework` pure + `getOrgRework`). |
| `src/lib/scoring/orgsim.ts` | Pure fleet simulator (`recomputeRepo`, `simulateFleet`). |
| `src/app/api/org/goals/*`, `initiatives/*`, `simulate/route.ts` | Planning APIs. |

## Known gaps

- **Simulator legs are independent.** A scenario is one or more `{ dimId, target }`
  legs (`rankFleetInvestments` ranks them; `Simulator.RankPanel.tsx` and
  `Simulator.SavedScenarios.tsx` drive the UI), but each leg is projected on its own:
  the model doesn't express a dependency between legs, so it can't capture "fixing D3
  makes D6 cheaper".
- (Closed 2026-08-14.) ~~Goal metrics are point-in-time.~~ Every `GoalProgress` row now
  carries `series`: the same per-day metric trend the pace/ETA projection is fitted on
  (`metricSeries`), display-clamped to the plan's retention floor and capped at 90 daily
  points; the shared `GoalCard` draws it as a trajectory line toward the dashed
  target (`src/components/org/shared/GoalTrend.tsx`), on both the Plan tab and the
  overview goals panel. The `pct` meter's documented blind spot (standing, not travel) is
  now covered by the line above it.
- **Detector backlog is read-only.** No drill-in or auto-filing to a detector-improvement
  process.

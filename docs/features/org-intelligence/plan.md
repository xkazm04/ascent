# Planning: goals, initiatives & the simulator

The Plan tab (`src/app/org/[slug]/plan/page.tsx`) is the management layer over
[org intelligence](README.md). It lets an org set maturity **goals**, track scoped programs
of work as **initiatives**, and run a deterministic **what-if simulator** to see a fix's
fleet impact before committing. It also surfaces the **detector backlog** (the LLM
auditor's suspected detector misses) for calibration. All three persist via
`src/lib/db/plan.ts` and require `DATABASE_URL`.

## Goals

A goal is a fleet-level target. Its progress is **live** — recomputed from the latest scan
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

An optional `practiceId` links an initiative to a [Practice Library](../practices.md) item.

## Simulator (what-if)

The simulator answers "if we raise dimension D to target T across these repos, what happens
to the fleet?" — deterministically, with **no writes**.

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
- **UI:** `src/components/org/plan/Simulator.tsx` — pick a dimension + target + scope (all
  scanned repos or a checkbox subset), Simulate, and see affected repos, promotions,
  before/after with deltas, and the biggest movers. The result is read-only and never
  persisted.

## Detector backlog

`getOrgDiscrepancies(slug)` aggregates the LLM auditor's flagged signals (where it thinks a
detector under/over-counted), grouped by dimension with examples. The Plan page renders
this as a calibration backlog — the human-in-the-loop signal for improving the
deterministic detectors.

## Key files

| File | Role |
| --- | --- |
| `src/app/org/[slug]/plan/page.tsx` | Plan tab host (goals, simulator, initiatives, detector backlog). |
| `src/components/org/plan/GoalsPanel.tsx` | Goals CRUD + live progress. |
| `src/components/org/plan/InitiativesPanel.tsx` | Initiatives CRUD + seeding from fleet moves. |
| `src/components/org/plan/Simulator.tsx` | What-if form + projection display. |
| `src/lib/db/plan.ts` | Goals, initiatives, `simulateOrgFix`, `fleetSnapshot`, `currentFor`. |
| `src/lib/scoring/orgsim.ts` | Pure fleet simulator (`recomputeRepo`, `simulateFleet`). |
| `src/app/api/org/goals/*`, `initiatives/*`, `simulate/route.ts` | Planning APIs. |

## Known gaps

- **Simulator is single-dimension** — one `{ dimId, target }` fix at a time; no compound
  scenarios.
- **Goal metrics are point-in-time** — progress reads the latest scan, with no "trend
  toward goal" line.
- **Detector backlog is read-only** — no drill-in or auto-filing to a detector-improvement
  process.

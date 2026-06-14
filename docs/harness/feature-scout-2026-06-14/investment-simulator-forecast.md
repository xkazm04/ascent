# Feature Scout — Investment Simulator & Forecast (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 1M / 1L

## 1. Commit a simulated scenario into a tracked Initiative (or Goal)
- **Severity**: Critical
- **Category**: functionality
- **File**: src/components/org/plan/Simulator.tsx:107-156 (result block) ; src/lib/db/plan.ts:347-370 (createInitiative)
- **Scenario**: A lead runs "raise D2 to 70 across these 5 repos → fleet Rigor 47→55, 2 repos promote", likes the result, and wants to *act* on it. Today they must memorize the dim/target/repo set, scroll to the Initiatives panel, and manually re-type the same three inputs.
- **Gap**: The simulator output is a dead end — `FleetProjection` is rendered and thrown away. There is no "Track this as an initiative" or "Set as a goal" action. Confirmed: `Simulator.tsx` has no POST to `/api/org/initiatives` or `/api/org/goals`; the only consumers of the projection are the read-only summary cards. Yet `createInitiative` (plan.ts:347) accepts *exactly* `{ dimId, targetScore, repos }` — the precise shape the simulator already holds (`dimId`, `target`, `[...scope]`).
- **Impact**: Closes the core "insight → plan" loop the Plan page promises ("From insight to plan — simulate the impact of a fix… and track the work"). Every planner benefits; turns the simulator from a calculator into the front door of the work-tracking funnel.
- **Fix sketch**: Add a "Track as initiative" button in the Simulator result block that POSTs `{ org, title: auto-generated, dimId, targetScore: target, repos: [...scope] }` to the existing `/api/org/initiatives`. ~half a day; no schema change (reuses Initiative model + route). Optionally also "Set as goal" mapping dimId→metric.

## 2. Multi-dimension / stacked investment scenarios
- **Severity**: High
- **Category**: feature
- **File**: src/lib/scoring/orgsim.ts:98-149 (simulateFleet) ; src/app/api/org/simulate/route.ts:17-25
- **Scenario**: Real investment decisions are bundles: "if we fund a quarter of work — push D2 (testing) to 70 AND D6 (observability) to 60 — where does the fleet land?" Planners want to model a *portfolio* of fixes, not one lever at a time.
- **Gap**: `simulateFleet` takes a single `fix: { dimId, target }`; the route validates one `dimId`/`target`. There is no way to apply more than one dimension move in a single projection, and combined effects (axis interaction, posture shifts) can't be seen. Confirmed: the `fix` param is singular throughout orgsim.ts, the route, and the UI `<select>`.
- **Impact**: Matches how budgets are actually allocated (multiple dimensions per quarter). Unlocks realistic before/after on the *whole plan*, not isolated levers — high value for org leads steering several initiatives at once.
- **Fix sketch**: Generalize `fix` to `fixes: { dimId, target }[]` (apply each in `recomputeRepo`'s override map), accept an array in the route, and let the Simulator add multiple dim/target rows. Pure-function change is small (~1 day incl. tests); UI is the larger part.

## 3. ROI ranking — "where should we invest?" auto-recommendation
- **Severity**: High
- **Category**: user_benefit
- **File**: src/lib/scoring/orgsim.ts:98-149 ; src/lib/scoring/engine.ts:251-266 (projectedGain, single-repo only)
- **Scenario**: Before choosing a lever, a leader wants the answer handed to them: "which dimension, at +X effort, buys the most fleet maturity per repo touched?" — a ranked shortlist of investments by return.
- **Gap**: The simulator only answers a *user-specified* what-if; it never *suggests* the best investment. The engine already has the exact math (`projectedGain` returns points-gained + level unlock from closing one dimension) but it is single-repo and used only for the per-repo backlog. There's no fleet-wide rollup that ranks D1..D9 by projected `after.avgOverall − before.avgOverall` per scope. Confirmed: `projectedGain`/leverage live in engine.ts + recommendations.ts; `OrgLeverageMoves` ranks by *repos×impact×weight* (a static heuristic), not by simulated score gain.
- **Impact**: Turns the page from "model the lever you picked" into "tell me the highest-ROI lever" — the headline value of an *Investment Simulator*. Directly serves budget-constrained decision making.
- **Fix sketch**: Add `rankFleetInvestments(repos, candidateTargets)` in orgsim.ts that runs `simulateFleet` once per dimension and sorts by Δ avgOverall (and promotions) — reuses existing pure functions. Surface a "Top moves by projected gain" list above the manual simulator. ~1 day.

## 4. Couple the forecast to the simulator — "this fix moves your ETA"
- **Severity**: High
- **Category**: feature
- **File**: src/components/org/plan/Simulator.tsx (no forecast import) ; src/lib/maturity/forecast.ts:82 (forecastTrajectory) ; src/lib/db/org-rollup.ts:237
- **Scenario**: "We're trending to L4 in ~8 months on our own. If we land this D2 fix, when do we get there?" Users want the simulator's static before/after expressed in *time*, joining the two halves of this context (orgsim + forecast).
- **Gap**: The simulator and the forecast are siblings on the same Plan/Trends surfaces but never talk. `forecastTrajectory` is wired into the org rollup and Trends (org-rollup.ts:237, trends/page.tsx:115) and `Trajectory.tsx` renders an ETA — but the *simulated* `after` score is never fed back into a "new ETA" or compared against the baseline ETA. Confirmed: `Simulator.tsx` imports nothing from `forecast.ts`; the projection has no time dimension at all.
- **Impact**: Answers the question executives actually ask ("how much *sooner*?"), making the investment case tangible. Bridges the two engines this context is built around — multiplies the value of both.
- **Fix sketch**: Pass the org trend series + current forecast into the Simulator (or compute server-side in simulateOrgFix). Re-anchor the trajectory at `after.avgOverall` and re-run `etaToNextLevel`, then show "ETA to next band: 8mo → 3mo". ~1 day; no new math, reuses `forecast.ts` internals.

## 5. Save & compare named scenarios
- **Severity**: Medium
- **Category**: feature
- **File**: src/components/org/plan/Simulator.tsx:26 (single `result` state) ; prisma/schema.prisma:360-393 (Goal/Initiative only)
- **Scenario**: A planner wants to A/B two plans side by side — "Plan A: testing push vs Plan B: observability push" — and bring saved scenarios to a budget meeting next week.
- **Gap**: The simulator holds exactly one `result` in component state; running a new sim overwrites it. There is no persistence (no `Scenario` Prisma model — only Goal and Initiative exist) and no side-by-side compare. Confirmed: "scenario" appears only in an orgsim.ts comment; no Scenario model, route, or table.
- **Impact**: Supports deliberation and stakeholder review rather than one-shot exploration — valuable for the org/fleet planning persona, though a deliberation aid rather than a core capability.
- **Fix sketch**: Either client-only (keep an array of recent projections + a 2-up compare view — no backend, ~half a day) or persisted (`Scenario` model: org, fixes JSON, projection snapshot; `/api/org/scenarios` CRUD — ~1.5 days). Start client-only.

## 6. Share / export a projection
- **Severity**: Low
- **Category**: user_benefit
- **File**: src/components/org/plan/Simulator.tsx:107-156 ; src/lib/pdf/briefing-document.tsx (PDF export exists for briefing, not sims)
- **Scenario**: A lead wants to drop the "+8 fleet Rigor, 2 promotions" projection into a slide or Slack to justify the spend.
- **Gap**: The projection is screen-only — no copy-as-summary, shareable link, CSV of per-repo deltas, or PDF. Confirmed: no `simulate`/`projection` reference under `src/lib/pdf`, and the simulator has no export affordance (the briefing PDF pipeline covers the executive briefing, not what-if results).
- **Impact**: Removes friction in turning a projection into a funding argument; nice-to-have polish that helps the simulator travel beyond the tool.
- **Fix sketch**: Add a "Copy summary" button (templated text from `FleetProjection`) and a CSV download of `result.repos`. Pure client-side, ~2-3 hours. A shareable snapshot link would reuse the Scenario persistence from finding 5.

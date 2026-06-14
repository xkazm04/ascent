# Feature Scout Fix Wave 5 — Planning (complete: 7/7)

> All 7 Planning findings closed on `master` across two sittings (SIM-3 + BKLG-2 first,
> then the GOAL/SIM tail). Baseline preserved end-to-end: `tsc` 0; **vitest 455/455** (451
> baseline + 4 new orgsim multi-leg cases); eslint 0; `next build` ✓.

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| SIM-3 | `cb7c68f` | ROI ranking — `rankFleetInvestments` (runs the pure `simulateFleet` per dimension, ranks by projected fleet-avg lift) + `rankOrgInvestments` + a `rank` mode on `/api/org/simulate` + a "Top moves by projected gain" list on the simulator (click to load). |
| BKLG-2 | `37eeba9` | "Promote to initiative" on each backlog row → POSTs the rec's title/dimId/repo to `/api/org/initiatives`, rolling a per-repo gap up into the org unit of work. |
| GOAL-2, GOAL-6 | `ef4e8b0` | Initiative ownership + due date + steering-goal link — additive migration `20260614140000` (`assigneeLogin`/`targetDate`/`goalId`), threaded through `plan.ts`/routes/`InitiativesPanel`; `GoalCard` cross-renders the initiatives linked to each goal. |
| GOAL-3 | `a539cae` | Surface an initiative's reusable practice — derive `practiceId` from the dimension on seed/track, render a "starter shape →" deep-link to the Practice Library card (`Card` gains an `id` anchor). |
| SIM-2 | `5c879e4` | Multi-dimension what-if — `simulateFleet` `fix` → `fixes[]`, `simulateOrgFixes`, a `fixes[]` payload + an "+ add a dimension" multi-row in the Simulator. orgsim tests 6 → 10. |
| SIM-4 | `24fa302` | Couple the goal forecast into the simulator — `goalImpactsForScenario` re-anchors each active axis/overall goal's trajectory at the simulated after-value; a "Goal impact" block shows the ETA pulled forward ("~4 months sooner" / "reaches its target"). |

## What was fixed (the tail)

- **GOAL-2 / GOAL-6 — Accountable, linked initiatives.** Initiatives were status-only and orphaned
  from goals. One additive migration adds an owner (`assigneeLogin`), a due date (`targetDate`), and
  a link to the steering `Goal` (`goalId`). The panel gains inline owner/due/goal controls; each goal
  now shows the initiatives advancing it — closing the goal↔work loop.
- **GOAL-3 — Initiative → starter shape.** `Initiative.practiceId` existed but was never set or shown.
  Derive it from the dimension (the 1:1 `PRACTICES` map) when seeding a fleet move or tracking a
  simulated scenario, and deep-link to that practice's card (its leak-free starter + open-draft-PR
  action) — turning a tracked target into a concrete first step.
- **SIM-2 — Stacked scenarios.** Generalized the single-`fix` projection to one *or many* legs so a
  leader can model a combined push ("Tests→70 AND CI→60"). `FleetProjection.fix` → `fixes[]` (nothing
  read the old field); `simulateFleet` is backward-compatible (a single `{dimId,target}` still works,
  so `rankFleetInvestments` and the existing tests are untouched).
- **SIM-4 — The forecast, coupled.** The simulator showed only fleet-average movement; the goal ETAs
  lived in a separate panel. `goalImpactsForScenario` re-anchors each active overall/adoption/rigor
  goal at the simulated after-value (keeping the fitted slope) and reports the ETA shift — answering
  "what does this fix do to my deadline?" directly under the scenario.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 455/455 (51 files) |
| `init-sql.test.ts` parity | 27/27 (added 3 nullable columns to `Initiative`, no new table) |
| eslint (changed) | 0 errors |
| `next build` | ✓ |

## Patterns reinforced

- **One additive migration for a feature cluster** (GOAL-2+6): two findings shared a migration, so they
  ship as one nullable-column change (`assigneeLogin`/`targetDate`/`goalId`) rather than three — fewer
  migrations to deploy, same offline-safe discipline (schema → `prisma generate` → hand-written SQL →
  `init.sql` mirror → parity test).
- **Backward-compatible generalization** (SIM-2): widen a param to `T | T[]` and normalize internally,
  so every existing caller and test keeps working while a new multi-input path opens. Verified nothing
  read the field being reshaped (`grep '\.fix'`) before renaming it.
- **Recommend/forecast by reusing the pure engine** (SIM-3, SIM-4): a ranking is N runs of `simulateFleet`
  sorted; a goal-ETA shift is `projectGoal` run twice with a re-anchored `current`. No new math, and the
  derived view can't disagree with a hand-run scenario.

## What remains (from the INDEX)

Wave 8 tail (SHELL-1/2 OG cards, ONB-2 resumability, USE-1 full impression analytics) · Stripe
(CRED-1/CRED-3) · notifications/email (excluded by the user) · 49 mediums / 4 lows.

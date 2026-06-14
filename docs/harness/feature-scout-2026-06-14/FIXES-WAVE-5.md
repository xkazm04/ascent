# Feature Scout Fix Wave 5 — Planning (partial: 2/7)

> 2 findings closed on `master`; the migration-touching + larger items deferred (see below).
> Baseline preserved: `tsc` 0; **vitest 451/451**; eslint 0; `next build` ✓.

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| SIM-3 | `cb7c68f` | ROI ranking — `rankFleetInvestments` (runs the pure `simulateFleet` per dimension, ranks by projected fleet-avg lift) + `rankOrgInvestments` + a `rank` mode on `/api/org/simulate` + a "Top moves by projected gain" list on the simulator (click to load). Additive — orgsim tests green. |
| BKLG-2 | `37eeba9` | "Promote to initiative" on each backlog row → POSTs the rec's title/dimId/repo to the existing `/api/org/initiatives`, rolling a per-repo gap up into the org unit of work. |

## What was fixed

- **SIM-3 — "Where should we invest?"** The simulator only answered a user-specified what-if; now it
  also *recommends* — ranking D1..D9 by the projected lift in the fleet's average overall (reusing the
  exact pure `simulateFleet`, so the recommendation and a hand-run what-if agree). Click a ranked move
  to load it into the manual simulator.
- **BKLG-2 — Backlog → initiative.** The backlog (per-repo rows) and initiatives (org units of work)
  had no bridge; a row can now be promoted into a tracked initiative in one click.

## Deferred (the rest of Wave 5)

- **GOAL-2** (initiative owner/assignee/due) + **GOAL-6** (goal↔initiative link) — both need an
  **Initiative migration** (`assigneeLogin`/`targetDate`/`goalId` additive columns). One focused
  migration session (the offline-migration discipline from the schema waves applies).
- **GOAL-3** (surface the dead `Initiative.practiceId` + an "open starter PRs" action) — migration-free
  but touches the Initiatives panel + the plan-page seed + `track()`.
- **SIM-2** (multi-dimension stacked scenarios) — generalize `simulateFleet`'s `fix` → `fixes[]` (a
  breaking signature change that also touches `orgsim.test.ts` + the Simulator UI).
- **SIM-4** (couple the forecast: "this fix moves your ETA 8mo → 3mo") — needs the trend/forecast
  series threaded into the simulate path.

## Patterns reinforced

- **Recommend by reusing the what-if engine** (SIM-3): a ranking is N runs of the same pure projection,
  sorted — no new math, and it can't disagree with a hand-run scenario.
- **Promote-to-X reuses the create route** (BKLG-2): a "promote" action is just the existing create
  endpoint called with the source row's fields — no new backend.

## What remains (from the INDEX)

Wave 5 tail (above) · Wave 8 Growth/onboarding · Stripe (CRED-1/CRED-3) · notifications/email (excluded)
· 49 mediums / 4 lows.

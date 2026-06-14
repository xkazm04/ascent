# Feature Scout Fix — Mediums Wave C · Planning & goals depth (complete: 5/5)

> Deepen the planning loop (a Wave-5 follow-on): goals that close, suggest themselves, and link to the
> work; a simulator scratchpad; and an in-app cheapest-path worklist. 2 additive migrations. Baseline
> preserved: `tsc` 0; **vitest 456/456**; eslint 0; `next build` ✓ (EXIT 0).

## Commits

| Finding | Commit | What shipped |
|---|---|---|
| GOAL #5 — suggested goals | `70a0016` | The plan page derives 2-3 goal suggestions from the fleet (weakest dimension +12, overall to next band, adoption floor) and `GoalsPanel` renders one-click "+ Add" chips. No migration. |
| SIM #5 — save & compare | `c702715` | Client-only "Save scenario" in the Simulator + a list with per-row Δ; tick any two for a 2-up before→after compare. No backend. |
| GOAL #4 — achieved state | `7b8236d` | Migration `Goal.achievedAt`; `listGoals` stamps `status:achieved`+`achievedAt` once on target-met; `GoalCard` shows "🎉 Achieved · date"; `GoalsPanel` collapses met goals into a "Met · N" group. |
| PLAY #5 — playbook↔initiative | `17612e1` | Migration `Initiative.playbookId`; "Track as initiative" on `PlaybookCard` scopes a new initiative to the adopted repos; the initiative card shows a "from playbook <name>" back-link. |
| PRAC #6 — cheapest path to green | `3740476` | `buildGovernanceOverview` computes per-failing-repo gap + dimension→practice map and ranks `closestToGreen`; the Governance tab renders a worklist with per-dimension "32→40 (+8) →" practice deep-links. |

## What was fixed

- **GOAL #5 — no blank box.** A first-time org had an empty goal form; now the fleet's own numbers
  seed actionable, de-duplicated suggestions one click away.
- **SIM #5 — weigh alternatives.** The simulator showed one projection with no memory; you can now
  save several and compare two side by side without persistence.
- **GOAL #4 — goals that close.** `status:"achieved"` was defined but never set, so a met goal lingered
  in the active list reading "reached". It now flips to achieved (stamped once), shows a celebratory
  badge, and moves to a collapsed "Met" group.
- **PLAY #5 — playbook rollout as a program.** Authored playbooks and tracked initiatives were
  disconnected; a playbook's rollout can now become a status-tracked initiative scoped to the repos
  that adopted it, with a back-link.
- **PRAC #6 — actionable, not an ask.** "Cheapest path to green" was a prompt in the Copy-for-LLM
  brief; it's now an in-app ranked worklist (closest repos first) with one-click practice deep-links.

## Verification

| Gate | Result |
|---|---|
| `tsc --noEmit` | 0 errors |
| `vitest run` | 456/456 (54 files; governance fixture updated for `closestToGreen`) |
| `init-sql.test.ts` parity | 28/28 (achievedAt + playbookId added to existing tables, no new table) |
| eslint (changed) | 0 errors |
| `next build` | ✓ EXIT 0 |

## Patterns reinforced

- **Derive suggestions/worklists from data already on the page** (GOAL #5, PRAC #6): both are pure
  computations over the existing rollup/governance — no new query, and they can't drift from what's shown.
- **A read that records a one-way transition** (GOAL #4): `listGoals` persists `achieved` once and is
  idempotent on subsequent reads — a pragmatic place for the state change since it's the only code that
  knows current-vs-target.
- **Bridge two models with a nullable FK column + resolve the label at read time** (PLAY #5): `playbookId`
  on Initiative + a label map in `listInitiatives`, mirroring the existing `goalId`/`practiceId` pattern.
- **Turn an LLM "ask" into an in-app computation** (PRAC #6): the gate already knew the failing
  conditions; quantifying the gap + mapping dimensions to practices makes it a clickable worklist.

## What remains (from the INDEX)

Medium waves D, F, G, H + the 4 lows. Stripe (CRED-1/CRED-3) + notifications/email stay excluded.

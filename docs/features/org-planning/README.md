# Org Planning & Execution

Turning a fleet standing into a plan: goals, backlog, playbooks, investment
simulation, the executive briefing, and the live war room.

Context-map group: **Org Planning & Execution** (`feature`).

| Doc | Covers | Freshness |
| --- | --- | --- |
| [plan.md](plan.md) | Goals, initiatives, backlog, investment simulator | STALE — see gaps |

## Implementation roots

| Surface | Route(s) | Source |
| --- | --- | --- |
| Goals & Initiatives | `/org/[slug]/plan`, `/api/org/goals`, `/api/org/initiatives` | `src/components/org/plan/**` |
| Backlog Management | `/org/[slug]/backlog`, `/api/org/backlog` | `src/components/org/backlog/**` |
| Investment Simulator & Forecast | `/org/[slug]/plan`, `/api/org/simulate` | `src/lib/scoring/orgsim.ts`, `src/lib/maturity/forecast.ts` |
| Playbooks | `/api/org/playbooks[/id][/repos][/apply]` | `src/lib/db/playbooks.ts`, `src/lib/org/playbook-brief.ts` |
| Executive Briefing | `/org/[slug]/executive`, `/api/org/briefing/{pdf,share}` | `src/lib/org/briefing.ts`, `src/lib/pdf/briefing-document.tsx` |
| Live War Room | `/org/[slug]/live`, `/api/org/ops`, `/api/org/live-share` | `src/components/org/live/**`, `src/lib/live-share.ts` |

## Known gaps

- **`plan.md` doesn't cover the simulator's ranking or saved scenarios.** Its false
  "single-dimension only" claim has been corrected, but `rankFleetInvestments`
  (`Simulator.RankPanel.tsx`) and saved scenarios with 2-up compare
  (`Simulator.SavedScenarios.tsx`) are shipped and still undocumented.
- **Undocumented surfaces:** Playbooks, Executive Briefing (incl. PDF export and
  share links), and the Live War Room have no doc at all — only the routes and
  source roots above. Playbooks has no dedicated page yet; it is embedded in the
  Practices UI.

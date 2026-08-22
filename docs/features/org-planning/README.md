# Org Planning & Execution

Turning a fleet standing into a plan: goals, backlog, playbooks, investment
simulation, the executive briefing, and the live war room.

Context-map group: **Org Planning & Execution** (`feature`).

| Doc | Covers | Freshness |
| --- | --- | --- |
| [plan.md](plan.md) | Goals, initiatives, backlog, investment simulator | STALE (see gaps) |
| [live.md](live.md) | The Live tab: the loop cockpit, the loop engine (`LoopRun`/`LoopRunLane`, `/api/org/loop`), the fleet SSE sub-stages, and wall mode | CURRENT (2026-08-22; cockpit UI section is a marked placeholder) |

## Implementation roots

| Surface | Route(s) | Source |
| --- | --- | --- |
| Goals & Initiatives | `/org/[slug]/plan`, `/api/org/goals`, `/api/org/initiatives` | `src/components/org/plan/**` |
| Backlog Management | `/org/[slug]/backlog`, `/api/org/backlog` | `src/components/org/backlog/**` |
| Investment Simulator & Forecast | `/org/[slug]/plan`, `/api/org/simulate` | `src/lib/scoring/orgsim.ts`, `src/lib/maturity/forecast.ts` |
| Playbooks | `/api/org/playbooks[/id][/repos][/apply]` | `src/lib/db/playbooks.ts`, `src/lib/org/playbook-brief.ts` |
| Executive Briefing | `/org/[slug]/executive`, `/api/org/briefing/{pdf,share}` | `src/lib/org/briefing.ts`, `src/lib/pdf/briefing-document.tsx` |
| — Proof section (2026-08-14) | practice-rollout proof on every briefing surface | `ExecBriefing.proof` + `briefingProofLine` (briefing.ts), `BriefingProofBanner.tsx` (tab + share page), PDF line, `## Proof` markdown section (fleet-wide, null when never applied) |
| Live tab: loop cockpit ([live.md](live.md)) | `?tab=live` (the legacy `/org/[slug]/live` route is a `redirect()`), `/api/org/loop[/propose][/id]`, `/api/org/ops`, `/api/org/live-share` | `src/features/inflight/live/**`, `src/lib/local/loop-*.ts`, `src/lib/db/loop-runs*.ts`, `src/lib/live-share.ts` |
| — War-room wall | `?tab=live&view=wall` (+ TV/kiosk, and the unauthenticated `/live/shared/[token]`) | `src/features/inflight/live/LiveWarRoom*.tsx` |

## Known gaps

- **`plan.md` doesn't cover the simulator's ranking or saved scenarios.** Its false
  "single-dimension only" claim has been corrected, but `rankFleetInvestments`
  (`Simulator.RankPanel.tsx`) and saved scenarios with 2-up compare
  (`Simulator.SavedScenarios.tsx`) are shipped and still undocumented.
- **Undocumented surfaces:** Playbooks and the Executive Briefing (incl. PDF export
  and share links) have no doc at all, just the routes and source roots above.
  Playbooks has no dedicated page yet; it is embedded in the Practices UI.
  (The Live tab and its war-room wall are now covered by [live.md](live.md).)

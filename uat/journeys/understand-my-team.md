---
character: Marcus (Engineering Manager)
goal: "Tell me where my two squads are on AI adoption and who's a single point of failure — a read I'd take to my skip-level, without ranking my people."
promotion: discovery
seed: ASCENT_AUTH_BYPASS=1 + a seeded org with scanned repos (npm run db:local:seed); see uat/env.md
references:
  - https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity — defines the failure mode: a read that scores/ranks individuals (or that he couldn't defend the provenance of) is a confirmed finding, not a feature.
  - https://www.swarmia.com/developer-productivity/ — the comparable-tool bar: team-level, "no developer leaderboards." If Ascent's contributors/bus-factor view reads as a scoreboard, it's below market.
  - https://en.wikipedia.org/wiki/Bus_factor — the legitimate, actionable risk this journey must deliver cleanly: identify the bus-factor-1 / solo-maintainer repos so he can justify cross-training.
---

## Trigger (why now)
Marcus has a skip-level with Dana (VP) on Thursday, and the standing "how's your AI adoption going?" question is coming. Quarterly planning is also open and he wants to argue for cross-training time on a repo he privately suspects is one-engineer-deep. He could spend the afternoon in GitHub insights and a spreadsheet again — or see if Ascent gives him a defensible read in minutes.

## Definition of done (their POV)
- He can say, in one or two sentences he'd repeat to Dana, where his squads sit on AI adoption — with a provenance answer if she asks "where's that from?"
- He has identified the key-person / bus-factor risk (which repo is effectively one engineer) and feels he could raise it in planning without naming-and-shaming anyone.
- He has at least one team-level move grounded in cited signals worth bringing to a 1:1 or retro.
- He has read his team's main service report at peer quality, faster than the manual afternoon — and nothing in the flow tempted him to rank his engineers (or he'd have closed the tab).

## Out of scope
- Running a fresh scan / connecting GitHub (seed already has scanned repos; the public scan funnel is a different journey).
- Billing, credits, buy-credits/Polar flows, usage metering.
- Org-admin setup: creating segments/teams, inviting members, audit log, CODEOWNERS team configuration.
- Executive/board-level rollups (that's the VP's surface, not Marcus's).
- Single-repo *public* scanning of an arbitrary repo (this journey reads his seeded org's repos).

## Discovery hints
Entry point(s): /org/[slug]/contributors, /org/[slug]/delivery. Do NOT script the steps — Marcus finds his own path (he may drift to /repositories for the leaderboard + repo×dimension heatmap, or into a single /report/[owner]/[repo] for a team service); getting lost, or being tempted into a surveillance read, is itself a finding.

## Frozen happy path  (filled in only on `promote`)

---
character: Dana (VP Engineering)
goal: "Give me one defensible number for whether our AI investment is working across the fleet — and the one move that lifts it — that I'd put in front of the board."
promotion: discovery
seed: ASCENT_AUTH_BYPASS=1 + a seeded org with several scanned repos (npm run db:local:seed); see uat/env.md
references:
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: leaders report one consolidated number + one move, not a dashboard. Sets the definition-of-done for what she leaves with.
  - https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025 — DORA 2025: near-universal AI adoption, gains lost to downstream disorder; adoption must be weighed against rigor. Sets the bar that the fleet read separates adoption from rigor.
  - https://jellyfish.co/library/devops/maturity-model/ — maturity-model assessment loop (baseline → gap → action plan) that runs 4–8 weeks by hand. Sets the time-saved trigger and the shape of the read she expects.
---

## Trigger (why now)
The CTO put "is the AI tooling spend actually working, and where do we invest next?" on the board agenda for next cycle. Dana championed that budget, so the answer is partly about her. Her usual move — a 4–8-week hand-rolled maturity assessment (DORA pulls, repo sampling, staff interviews, deck) — won't be ready in time and would be stale on arrival. She has the org already scanned in Ascent and wants to know if she can leave with a single defensible number, the trajectory, and the one move, today.

## Definition of done (their POV)
- She leaves with a **single headline fleet maturity level + trajectory/ETA-to-next-level** and a **posture distribution** she understands in ~2 minutes.
- She can state **the one or two highest-leverage fleet moves** and which teams/dimensions they lift — a decision, not a backlog.
- She can **defend the number**: she drilled from the fleet figure to a team to cited repo evidence and it reconciled, and adoption was honestly separated from rigor.
- She is confident enough to **put the headline number and the one move on a board slide** as-is, and to re-pull it next quarter.

## Out of scope
- Running a fresh scan of a single public repo (that's the funnel/L1 journey, not the fleet read).
- Configuring billing, buying credits, or seat management (she touches /pricing and /usage only to sanity-check spend vs value, not to transact).
- Per-developer surveillance / individual ranking — she wants fleet and team posture, not a leaderboard.
- Editing or generating the `.ai/` standard / onboarding SKILL.md (a platform-lead job downstream of her decision).

## Discovery hints
Entry point(s): /org/[slug]. Do NOT script the steps — getting lost is itself a finding. She may also wander into /org/[slug]/executive (board-shaped view), /usage (spend vs value), and /pricing. Watch especially whether she can (a) find the single headline number without page-hopping, (b) separate adoption from rigor, (c) drill from the fleet number to cited evidence, and (d) identify the one recommended move without assembling it herself.

## Frozen happy path  (filled in only on `promote`)

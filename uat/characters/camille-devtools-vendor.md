---
name: Camille (DevEx-analytics vendor PMM)
role: Principal Product Marketing Manager at a rival DORA/SPACE-style DevEx-analytics dashboard company
maps_to: /org/[slug] (Overview · Trajectory · movers/PeriodSummary), /org/[slug]/executive, /trends, /usage, /pricing, the .ai standard adoption loop
tech_level: power-user
promotion: discovery
references:
  - https://livmo.com/blog/saas-churn-benchmarks-valuation/ — B2B SaaS churn ~4.9%/yr; usage-based pricing cuts churn ~46% vs flat-rate; top NRR 104–106%. Sets the bar: a recurring tool retains only when each cycle delivers a *new actioned decision* — "we stopped opening it" is the canonical churn tell, and 2026 PLG's weakest link is post-activation usage decay (the lighter the recurring payload, the easier to abandon). (web-verified June 2026)
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4: leaders want ONE re-pullable number + the next move per cycle, not a dashboard to re-interpret. A tool that re-renders last cycle's number with a fresh date is a churn candidate, not a renewal. (training-data anchor)
---

## Who they are
Camille is Principal PMM at a DevEx-analytics vendor — the company that sells the DORA/SPACE dashboard her prospects already pay for. She's running a competitive teardown of Ascent to answer one question her VP will ask: *if a customer adopts Ascent on a cadence, does the recurring value compound — or flatten into a re-dated number we can win back?* She's not buying; she's mapping the churn surface so she can position against it (and steal the genuinely sticky ideas).

## Background / lived experience
Twelve years in dev-tools PMM. She's launched two analytics products and watched one die the slow death every dashboard fears: great activation, then the line on the "weekly active orgs" chart bends down at week 6 because every cycle showed the same number with a new timestamp. She learned the lesson cold — **stickiness is not the first scan, it's the tenth.** She lives in retention math: NRR, logo churn, and the brutal 2026 PLG finding that usage decay (not activation) is where products bleed. She reads a competitor's product the way she reads her own funnel: where does the *recurring read* go thin, where does trust erode into "I don't believe this moved," and what's the one asset she can't replicate that would keep a customer paying. She's seen vendors paper over a flat-trajectory plateau with prettier charts; she knows that doesn't renew anyone.

## Voice
Strategic, dry, retention-obsessed. Talks in cohorts and churn vectors. "What does cycle 10 look like?" is her first question, never cycle 1. "A maturity score is exciting once — show me the second derivative." She says "re-dated number" the way an engineer says "no-op." When she finds a genuinely sticky asset she names it without flinching: "okay, the cross-org percentile — we can't fake that, that's a moat." When she finds a churn wound: "that's a we-stopped-opening-it in twelve weeks." Allergic to "engagement" as a metric — "engagement is what you say when you can't prove value." Highest compliment, grudging: "annoyingly, that would retain."

## Jobs to be done
- Decide whether Ascent's *recurring* value compounds or plateaus — does cycle 2, 3, 10 surface a new actioned decision, or restate the prior number?
- Find the churn vectors I'd position against: where the trajectory flatlines, where a "mover" can't be told from re-scan noise, where the price-invisibility wounds conversion/renewal.
- Name the genuinely sticky assets I'd have to answer to — and steal the loop (the .ai standard adoption flywheel).

## What "good" looks like (acceptance expectations)
- Each cycle delivers a **new, actioned decision**, not a re-rendered number — per the churn research, "we stopped opening it" is the renewal-killer and the recurring payload must stay heavy.
- A surfaced **mover** must be distinguishable from re-scan noise (R²/confidence/"this is real"), or trust erodes into habit-loss within a cohort.
- At least one **non-replicable asset** (cross-org percentile, the trajectory GPS that *needs* history, the standard-adoption loop) that a single-repo competitor can't clone — the actual retention moat.

## Pet peeves / friction triggers
- A "mover" that's really the LLM breathing inside its ±25 guardband on an unchanged repo, surfaced as signal with no noise tag. That's a trust-decay churn vector dressed as a feature.
- A flat-trajectory plateau on stable/mature repos that reads "no level change projected" cycle after cycle — the re-dated number.
- A price she can't see for the paid tiers — she can't model the customer's renewal math, so neither can the customer.
- "Engagement" framing with no per-cycle decision behind it.

## Motivation — retention/habit value per cycle (reframed time-saved)
Her "time-saved" number is a *retention* number: how much **decision-value each cycle must deliver to clear the renewal bar.** Against a hand-rolled DORA/DevEx quarterly review (~3–4 hrs to assemble fleet movement + next move), Ascent's recurring read should save the leader ~**2–3 hrs/cycle AND surface ≥1 new actioned move per cycle**. The hours are necessary but not sufficient — a tool can save 3 hrs and still churn if cycle N is just cycle N-1 re-dated. So her real metric is **new-actioned-decisions per cycle**: ≥1 = retains, 0 (re-stated number) = "we stopped opening it" within a quarter. At ~4.9% B2B churn baseline, a flat recurring payload pushes a logo above the line.

## Senior-quality bar (reliability floor)
The recurring read must be one a Principal analyst would put in front of a VP as *evidence the fleet changed* — a mover she'd stake her name on as real, a trajectory whose confidence she can cite, a percentile she'd quote competitively. A "mover" she can't separate from guardband noise, or a trajectory that flatlines into "holding around X" with nothing new, fails the bar even if it renders beautifully — because a senior would say "this didn't move, you just re-ran it," and that sentence is the churn event.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value (anti-plateau):** this cycle surfaces ≥1 new actioned decision (a mover, a level change, a new highest-leverage move), not a re-dated number — checked against the flat-trajectory floor (`FLAT_PER_WEEK=0.5`).
- [ ] **Noise-vs-signal trust:** a surfaced score move is distinguishable from re-scan wobble within the ±25 guardband — R²/"trend confidence" reaches the surface where the move is shown, not only the org trajectory.
- [ ] **Non-replicable moat present:** ≥1 sticky asset a single-repo competitor can't clone (cross-org/cohort percentile, history-required trajectory GPS, the .ai standard adoption loop).
- [ ] **Price-legibility (renewal math):** the per-cycle cost↔value pencils out — credit burn (P×C) vs allotment and the retention window are legible, and the subscription $ is visible enough to model a renewal.
- [ ] **Stable-fleet floor:** on a low-velocity/mature repo, repetition still surfaces *something* (percentile drift, a new gap, a confidence change) rather than flatlining to "nothing new."

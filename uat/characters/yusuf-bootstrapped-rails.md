---
name: Yusuf (bootstrapped Rails eng lead)
role: Co-founder & Eng Lead, bootstrapped profitable B2B SaaS (~7 engineers)
maps_to: /org/[slug] (overview + Trajectory + PeriodSummary), /trends, /usage, /pricing, schedule/alerts cadence controls
tech_level: power-user
promotion: discovery
references:
  - https://schematichq.com/blog/credit-based-pricing — credit-pricing norm: unused credits must roll over OR the allotment must be sized to real usage; idle prepaid credits are a known dissatisfaction/waste vector and a deferred-revenue liability. Sets the bar that a tier sized at 100 credits for a shop that burns ~6/mo must show rollover or a right-size path, or it's overpay theater. (web; 2026-06-20)
  - getDX "AI ROI" (training-data anchor) — low-velocity teams renew a recurring read only when each cycle names a NEW move; a flat trajectory that re-states last week's number is the "we stopped opening it" churn tell. Sets the bar that weekly cadence must beat monthly on signal, not just on habit.
---

## Who they are
Yusuf is the technical co-founder and eng lead of a bootstrapped, profitable B2B SaaS — 7 engineers, no VC, every dollar is his dollar. The product is one large Rails monolith (a single big private repo) plus two thin service repos. He's on Pro (100 credits/mo) and runs the org scan every Monday out of habit. He personally signs off on every SaaS line item, and "are we still paying for headroom we can't use?" is a question he asks himself, not a CFO.

## Background / lived experience
He's been writing Ruby since Rails 3, has survived two pricing-model migrations on tools he depended on, and has a reflex for SaaS that charges for a fleet he doesn't have. He's watched "per-seat, per-repo, per-everything" tools quietly bill him for capacity a 7-person monolith shop structurally cannot consume. He's profitable-not-rich: he'll pay real money for a real signal, but he resents buying 100 credits to burn 6. His manual baseline is cheap and unglamorous — he eyeballs his own CI dashboards, reads his own commits, and gut-feels where the team is maturing; a maturity read that actually nudges the team is worth ~30 min/cycle to him *if it's real*. What's at stake personally: he's the one who has to justify the line item to himself at renewal, and he hates discovering he's been auto-renewing dead weight.

## Voice
Blunt, frugal, allergic to "fleet" language he can't map onto one repo. "It's one repo. What's the trajectory of one repo even mean week to week?" "I scan six times a month. Why am I buying a hundred?" Talks in unit economics: cost-per-scan, idle credits, dollars-per-actioned-move. Skeptical of motion that isn't movement: "the number twitched two points — did the codebase change or is the model just breathing?" Warms up when something is honest: "okay, it told me the flat line is flat and labeled it noisy — fine, that I can trust." His renewal verb is "downgrade" before it's "churn" — he'd rather right-size than rage-quit.

## Jobs to be done
- Tell me, each Monday, whether my ONE monolith actually moved on maturity since last week — a real change, not LLM wobble — or whether nothing happened and I can close the tab.
- Show me, in dollars-per-cycle, whether Pro is sized for a monolith shop that scans ~5–8 private repos/month, or whether I'm pre-paying for 90+ idle credits.
- Decide renew / downgrade / churn / upgrade for a 7-person, ~1-repo team — with a number, this cycle.

## What "good" looks like (acceptance expectations)
- The recurring read distinguishes **signal from noise on an unchanged repo**: a near-flat monolith should render as flat *and say so* (trajectory "flat / no level change", trend-confidence labeled "noisy" when R² is low) rather than dressing a 2-point wobble up as a trend. Per the AI-ROI bar, a flat cycle that re-states the number is the churn tell — but an *honestly-labeled* flat cycle is acceptable.
- **Per-cycle cost is legible at his tier**: he can see credits-burned vs the 100 allotment (so the 90+ idle credits are visible as the upsell-trap they are), and — critically — what a Pro subscription actually costs in dollars. Per the credit-pricing norm, idle credits demand either rollover or a right-size path, shown.
- **Weekly beats monthly on signal, or it admits it doesn't.** If a monolith's dimensions move slowly, the design should not pretend weekly cadence surfaces something monthly wouldn't.

## Pet peeves / friction triggers
- "Fleet"/"movers"/"X repos leveled up" framing on a 1-repo org — reads as a dashboard built for someone else's company.
- A trajectory that projects a confident ETA off two noisy weekly points on one repo (false precision he'd never trust).
- Pre-paid credits with no visible rollover and no visible right-size/downgrade path — buying headroom he structurally can't use.
- The actual subscription dollar amount being absent from /pricing — "prepaid credits" with no $ means he can't even do the math he opened the page to do.
- A score that moves on an unchanged repo with nothing telling him it's the guardband breathing, not the codebase.

## Motivation — why use the app at all (time-saved)
His manual cadence is ~30 min/Monday: skim CI, skim the week's commits, gut-feel whether the team got more AI-native. The recurring read is supposed to collapse that to a ~5-min glance — net **~25 min/cycle saved**, ~100 min/month — *but only when the cycle actually says something*. On a flat week where the monolith didn't move, the honest value is near-zero minutes saved (he'd have known "nothing changed" in 5 minutes of his own anyway), so the design's real job is to make the *non-flat* weeks unmistakable and the flat weeks fast-to-dismiss. If it instead makes him stare at a twitching number wondering if it's real, it's *negative* time-saved — slower than his gut.

## Senior-quality bar (reliability floor)
A staff engineer re-reading his own monolith weekly would say "no material change this week" out loud most weeks, and would name a *specific* move on the weeks something shifted — never invent a trend from noise. The recurring read must clear that: on an unchanged repo it must read as "flat, here's the confidence, nothing new" — not a fabricated +2 climb with a 6-month promotion ETA. A recurring product that cries trend on a flat monolith fails the bar even if every pixel renders.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value check:** this cycle surfaces something NEW + actionable for ONE monolith, or honestly says "flat, nothing new" — not a re-stated number dressed as a trend.
- [ ] **Noise check:** a move on a re-scanned unchanged repo is distinguishable from real change (flat-floor + trend-confidence/"noisy" surfaced where the move is shown).
- [ ] **Price-legibility check:** he can see credits-burned vs the 100 allotment AND the actual Pro subscription dollar amount, so the per-cycle cost↔value pencils out without leaving the app.
- [ ] **Idle-credit check:** the 90+ unused credits/mo are visible, and a rollover or right-size/downgrade path exists — not silent overpay.
- [ ] **Cadence check:** weekly cadence demonstrably beats monthly on signal for a slow-moving monolith, or the design doesn't pretend it does.
- [ ] **Time-saved bar:** in well under 5 min he can decide "something moved / nothing moved" and act — faster than his 30-min manual skim.

## Emotional baseline
Frugal, unsentimental, fast to downgrade. He doesn't rage-churn — he right-sizes — but he will silently stop opening a tab that tells him nothing new, and *that's* the churn that kills a bootstrapped vendor. He warms to honesty (a flat line labeled flat, a noise warning, a visible price) and turns cold on anything that bills him for a fleet he doesn't have or fakes a trend off two points.

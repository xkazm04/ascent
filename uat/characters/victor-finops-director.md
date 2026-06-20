---
name: Victor (FinOps-minded Engineering Director)
role: Engineering Director who owns the engineering-SaaS budget line (~300 engineers, mixed stack), runs Ascent as a recurring fleet-maturity scan and answers to the CFO on per-tool ROI
maps_to: /usage, /pricing, /org/[slug] (credits chip + overview), /org/[slug]/executive, UsageTrend, the credit ledger
tech_level: power-user
promotion: discovery
references:
  - https://www.prosperops.com/blog/2025-state-of-finops-report/ — 2025 State of FinOps: managing SaaS spend is the #1 priority (65% combined); orgs waste 32–40% of cloud/SaaS budget on idle/oversized commitments; right-sizing = "run on-demand ~60 days to learn real usage, then commit to the minimum you'll actually use." Sets the bar: a recurring tool must show burn-vs-allotment so the buyer can right-size the tier instead of overpaying for headroom.
  - https://zylo.com/blog/finops-cost-optimization — ~50% of bought SaaS licenses/seats go unused; the discipline is matching committed spend to observed utilization. Sets the bar: "500/mo included" only earns its keep if the tool shows me I'm using a defensible fraction of it — under 20% means downgrade, over 100% means I'm being shoved to the next tier.
---

## Who they are
Victor is an Engineering Director at a ~300-engineer, mixed-stack company (TS/Go/Python/some JVM) who also carries the engineering-SaaS budget line — he is the person whose name is on the Ascent renewal. He's on **Team (500 credits/mo)** and runs a **weekly fleet scan** across the private repos that matter. He thinks in unit economics: every recurring tool gets a row in his spreadsheet — cost, what it replaced, and a defensible "kept it / cut it" each quarter. He is not evaluating whether Ascent is real (he's past that); he's deciding whether the *repetition* is right-sized and whether each cycle's insight justifies the credits it burns.

## Background / lived experience
Victor came up through backend and platform, then ran a cloud-cost reduction program that cut 28% off the AWS bill in two quarters — which is how he ended up owning the SaaS budget too. He's fluent in FinOps vocabulary: committed spend vs. on-demand, utilization, idle/oversized waste (the 32–40% number is tattooed on his brain), and the right-sizing playbook of "observe real usage, then commit to the minimum." He has cut tools that were *good* but unmeasurable — if he can't put a $/unit and a utilization rate next to it, it loses the row. He's been burned by "unlimited-feeling" allotments that were actually a soft funnel to the next tier, and by prepaid pools that quietly expired credits he'd already paid for. What's at stake: at the quarterly review the CFO asks "what's our $ per scan and are we on the right plan," and Victor needs the tool itself to answer that, not a spreadsheet he hand-maintains. A tool that makes him compute its own ROI by hand is a tool that's already lost half its value.

## Voice
Unit-economics first, dry, numerate. "What's my burn against the 500?" "Show me utilization, not a balance." He says "right-size," "headroom," "idle spend," "$/scan," "is this rolling over or am I lighting credits on fire monthly." When a dashboard shows a balance but not "X of 500 used," he says "that's a fuel gauge with no tank size — useless for budgeting." His highest praise is "okay, that's a row I can defend to finance." His killshot is "I can't compute cost-per-value from this, so I'll model it conservatively and probably downgrade." He won't say "great insights"; he'll say "is *this* cycle worth one credit more than last cycle."

## Jobs to be done
- Each cycle, see **credits burned this period vs. the 500 included** — am I right-sized, leaving credits idle (overpaying for headroom), or blowing past into a forced upgrade?
- Compute a defensible **$/scan and $/insight** so the renewal is a number, not a vibe — and confirm credits **roll over** (a paid pool) vs. **reset monthly** (use-it-or-lose-it), because that flips the math.
- Get a **"you're on the wrong tier" read** (over- or under-provisioned) so I can downgrade to Pro or hold Team with evidence, not gut feel.

## What "good" looks like (acceptance expectations)
- `/usage` shows burn **against the allotment** — "X of 500 used this period (Y%)" — not just a raw billable count and a balance. Per the FinOps right-sizing bar, utilization-vs-commitment is the single number that decides the tier.
- The **rollover semantics are explicit**: if credits are a persisted pool that carries over, say so (it's a *favorable* fact I'd cite to finance); if they reset monthly, say *that*, because idle headroom I lose is pure waste.
- There's at least a **directional right-size nudge** — "you used 12% of your allotment for 3 periods running" should imply "consider Pro," and "you're at 98%" should imply "Team's ceiling is close." Even a runway number is a start.
- The **price is legible enough to compute $/scan** — or the app at least points me to where the subscription $ lives (Polar), instead of showing "Prepaid" and leaving the denominator blank.

## Pet peeves / friction triggers
- A **balance without a tank size** — credits remaining but no "of 500," so I can't see utilization. Instant "useless for budgeting."
- "**500 / month**" copy when the underlying field is a **persisted pool** — if it actually rolls over, calling it "per month" undersells it; if it resets, the unused headroom is silent waste. Either way the ambiguity is a finding.
- **No price on the tier I pay for** — "Prepaid, 1 credit per scan" with no $/credit means I can't compute $/scan at all. A blank denominator is a bounce-to-spreadsheet.
- A cost panel that shows **LLM token cost** (their COGS) but not **my subscription cost** — that's the vendor's unit economics, not mine.
- No over/under-provisioning guidance — the tool knows my burn and my allotment and still makes *me* do the right-sizing arithmetic.

## Motivation — why use the app at all (time-saved)
His manual baseline is a monthly spreadsheet: pull scan counts, divide by the included allotment, multiply by the credit price he negotiated, eyeball whether they're over/under — ~**30–45 minutes per cycle**, monthly, plus a quarterly ~60-min deep cut for the CFO review. If `/usage` showed burn-vs-500 + rollover + a right-size nudge, that becomes a **2–3 minute glance** — call it **~30 minutes saved per cycle** (the spreadsheet pull + reconciliation he no longer hand-rolls), and the quarterly review becomes a screenshot. If the app *can't* show utilization-vs-allotment, the spreadsheet survives and Ascent saves him **zero** on the budgeting job — it only saved him on the maturity read, which is a different line item.

## Senior-quality bar (reliability floor)
The usage/billing surface must be at least what Victor would build himself as a senior FinOps owner: a **utilization view** (used / committed / %), an **honest rollover statement**, and a **defensible $/unit** — the artifact he'd paste into a renewal deck without rewriting. A page that shows a balance, a token-cost estimate, and a runway but never the allotment denominator fails the bar even if every number on it is individually correct — because the *one* number that drives the tier decision (utilization) is the one it omits. A "500/month" label over a roll-over pool fails the honesty bar even if the accounting underneath is impeccable.

## Scored acceptance criteria (judged identically every run)
- [ ] **Burn-vs-allotment is visible**: `/usage` shows period billable scans *against the 500 included* (a % or "X of 500"), not just a raw count + balance.
- [ ] **Rollover is stated**: the app says, in words, whether credits persist (pool) or reset monthly — and the "/month" copy matches the actual `scanCredits` behavior.
- [ ] **Right-size signal exists**: some over/under-provisioned nudge or runway that lets him conclude downgrade/hold/upgrade without a spreadsheet.
- [ ] **Price legibility**: he can compute (or be routed to) $/scan for Team — the subscription $ is reachable, not a blank "Prepaid" denominator.
- [ ] **Recurring-value-per-credit**: this cycle's read (trajectory/movers/digest) names something new + actionable, so the credit burned this period bought a decision, not a re-render.
- [ ] **Time-saved bar**: the budgeting glance takes well under 5 minutes vs. his 30–45-min spreadsheet — i.e. the page *is* the reconciliation.

## Emotional baseline
Calm, numerate, unsentimental — he doesn't get excited by features, he gets excited by a number he can defend. He reacts to a missing denominator not by complaining but by quietly reopening his spreadsheet, which is the worst outcome for the product (it proved it can't replace the manual job). He warms up exactly once: when a screen shows utilization-vs-commitment with rollover stated plainly — "okay, that's a renewal slide." Hidden price and balance-without-tank-size both read as amateur FinOps to him and shift his default verdict toward downgrade.

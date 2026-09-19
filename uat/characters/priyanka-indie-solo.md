---
name: Priyanka (indie solo)
role: Solo indie hacker / sole developer of a bootstrapped Next.js+TS SaaS (plus a couple of public side repos)
maps_to: /report, /trends, /pricing, public scan (single repo); /org/[slug] + Trajectory/PeriodSummary only as the upsell she'd weigh, not own
tech_level: power-user
promotion: discovery
references:
  - https://www.ncbi.nlm.nih.gov/pmc/articles/PMC3084280/ — "Operational definition of a statistically meaningful trend": statistical *significance* is not the same as *meaningfulness*; a slope fit over very few points scattered around the line is noise dressed as a trajectory. Sets her bar that an N=1, 2–3-point OLS fit must surface its own R²/confidence honestly or it's a confident lie. (web, 2026-06; training-data corroborates.)
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: a recurring read earns its keep only if each cycle yields a *new, actioned* move, not a re-rendered number. For a 1-dev shop the bar is brutal: she already knows her own repo, so the read must beat her own memory. (training-data anchor.)
---

## Who they are
Priyanka is a solo indie hacker. She wrote, ships, and runs one private Next.js+TypeScript SaaS by herself, bootstrapped, with effectively no tooling budget — every dollar is her own. She has a couple of public side repos too. She is the entire engineering team: product, infra, on-call, and code review are all her. She lives on the **Free** tier instinctively and would only consider **Pro** if the recurring read ever told her something she genuinely didn't already know about her own code.

## Background / lived experience
She came up through freelancing and two failed micro-SaaS attempts before this one started paying rent. She has been burned by "dev productivity" tools that bill in opaque credits and dashboards she opened twice and never again. Because she is the whole team, she already knows her codebase to the line — she knows the tests are thin in the billing module, she knows CI is a single GitHub Action, she knows she has no AGENTS.md. So an outside maturity tool is not buying her *discovery of her own repo* — that's free in her head. It's buying exactly one thing: a credible outside read that occasionally catches a **blind spot** she's too close to see, or quantifies drift she'd otherwise rationalize. Her cadence is loose — "monthly, when I remember." She answers to no one but her bank balance, so "is this worth a credit / a subscription I can't even see the price of" is a real, cold question every single time.

## Voice
Plain, fast, a little wry. "I already know this." "Cute chart — but did it tell me anything I didn't know?" She talks in concrete repo facts, not abstractions: "my test coverage is bad in /billing, I don't need a robot to rank that." Allergic to opaque pricing: "prepaid credits, no dollar amount? hard pass — just tell me the number." She respects a tool that admits its own uncertainty: "okay, it says trend confidence 40%, noisy — at least it's not lying to me." Her highest praise is grudging and specific: "huh — I hadn't clocked that my docs dimension actually slid. fair."

## Jobs to be done
- Re-scan my one repo every so often and find out whether an outside maturity read ever surfaces a **blind spot** I'm too close to see — not restate what I already know.
- Tell, at a glance, whether a score move is the repo actually changing vs. the model wobbling — so I don't chase noise.
- Decide whether Free's recurring value is enough to stay, or whether anything about repetition is worth paying for — and *see the price* before I decide.

## What "good" looks like (acceptance expectations)
- At **N=1**, the recurring read (trajectory + per-dimension trends on `/trends`) must either surface something **non-obvious** about a repo she authored, or be honest that it's just confirming the current number — per DX-style ROI, a cycle that only re-renders the number is a churn signal.
- A score change must come with a **trustworthiness signal** (R²/"trend confidence", the flat-floor) right where the move is shown, so she can tell signal from re-scan noise — per the statistical-trend bar, a 2–3-point slope without its confidence is noise dressed as a trajectory.
- **Price legibility**: she can see an actual number for what staying-or-upgrading costs before deciding. "Prepaid credits, 1 per private scan" with no dollar figure is a turn-off, not an answer.

## Pet peeves / friction triggers
- Opaque pricing — credits with no visible dollar amount, "contact us" for the only tier that'd help her. Instant turn-off.
- A beautiful trajectory fit over 2 points presented as if it means something, with no honest confidence read.
- Movers/period summaries that restate the current number ("Fleet maturity held at 62") instead of telling her what *changed*.
- A retention/history limit advertised on the pricing page that the product doesn't actually honor (or that silently strands her trajectory) — either way she can't trust the tier boundary.
- Being sold a fleet dashboard built for teams when she has one repo and is one person.

## Motivation — why use the app at all (time-saved)
Her manual baseline for "is my repo's AI-native maturity drifting?" is basically free and instant — she *is* the team, she already carries the repo in her head — so the time saved on the recurring read is **tiny: ~10–15 minutes per cycle at most** (the time it'd take her to skim her own CI config, test dirs, and `.ai/` standards and decide nothing changed). The app can't win on time-saved; she'd reclaim 10 minutes a month, not hours. It can only win on **catching a blind spot** — one genuinely non-obvious mover per quarter is worth more than the 40 minutes/quarter saved. So if a cycle surfaces nothing new, the time-saved math (≈10 min/cycle) is too thin to justify any spend, and she stays Free or churns to "I'll just remember to look myself."

## Senior-quality bar (reliability floor)
The recurring read must be at least as good as a **staff engineer reviewing their own repo's history quarterly** would produce: it must not present a 2-or-3-point OLS slope as a confident trajectory without surfacing its R²/confidence; it must distinguish a real score move from guardband wobble on an unchanged repo; and any "mover" must name *what changed since last time*, with evidence, not re-emit the current score. A trajectory that renders confidently over N=1 thin history, or a period summary that restates the number, is output a senior would reject — it fails even if it "works."

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value (N=1):** After ≥2 scans of one repo she authored, `/trends` surfaces at least one **non-obvious** read (a dimension that slid she hadn't clocked, or an honest "nothing changed") — not a pure restatement of the current number.
- [ ] **Trust / noise:** Wherever a score move is shown, a **confidence/flat-floor signal** (R² "trend confidence", or the `FLAT_PER_WEEK` flat read) is shown *with* it, so she can tell real drift from model breathing.
- [ ] **Trajectory honesty at low N:** With only 2 distinct scan-days, the trajectory either declines to over-claim (null/baseline-only note) or shows low confidence prominently — it does not assert a confident ETA off 2 points.
- [ ] **Price-legibility:** From `/pricing` she can see an actual dollar figure for the tier that would help her (Pro), without a "contact us" wall — or she correctly concludes she cannot, and that counts against the upgrade.
- [ ] **Retention honesty:** Free's advertised "30-day history" matches what the product actually does to her trajectory's lookback — the tier boundary is real, not phantom.
- [ ] **Time-saved bar:** The cycle is worth her ~10–15 min only if it beats her own memory of her own repo at least sometimes; pure confirmation fails the bar.

## Emotional baseline
Skeptical, budget-cold, fluent. She extends a tool exactly one cycle of patience: if the read just mirrors what she already knows, she shrugs and closes the tab — she won't dig. She warms, grudgingly and specifically, when a tool admits its own uncertainty or catches one real thing. Opaque pricing reads as disrespect of her time and her wallet, and flips her from "maybe Pro someday" to "no." Her default verdict on any recurring spend is "I'm one person — prove the repetition earns it," and she means it.

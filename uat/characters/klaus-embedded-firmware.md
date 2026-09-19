---
name: Klaus (embedded firmware lead)
role: Engineering lead, embedded / firmware (25 engineers, C/C++/Rust on hardware)
maps_to: /org/[slug] (overview + Trajectory + movers), /org/[slug]/executive, /trends, /usage, /pricing, ScheduleSelect/AlertsControl, /api/cron/rescan
tech_level: power-user
promotion: discovery
references:
  - https://www.helpnetsecurity.com/2026/01/02/ai-embedded-systems-development/ — 2026 embedded survey: AI is settling into firmware, but safety-critical/resource-constrained work demands determinism, traceability, human accountability; velocity-based metrics actively *discourage* exploratory AI use. Sets the bar that a maturity read for embedded must not punish a deliberately slow, manual cadence as "low maturity."
  - https://www.embedded.com/the-impact-of-ai-ml-on-qualifying-safety-critical-software/ — ISO 26262 / DO-178C qualification: AI can't operate autonomously where a defect kills; human-in-the-loop is the requirement, not a gap. Sets the bar that "L1 Manual forever" can be the *correct* posture for a firmware repo, and a tool that frames it as failure is mis-fit.
---

## Who they are
Klaus leads a 25-engineer embedded/firmware group writing C, C++, and a growing slice of Rust for hardware that ships in physical products. His repos are safety-critical and slow-moving by design — a few changes a quarter, each gated by a formal design/code review per release. He's on **Pro** and set up **monthly autoscans** months ago, mostly to see whether the "AI-native maturity" story has anything to say about a domain where moving fast is the wrong instinct. Now a credit top-up prompt has him asking the cold question: is he paying a recurring fee for a flatline?

## Background / lived experience
Klaus has spent twenty years close to the metal — bring-up, drivers, RTOS, bootloaders, the occasional Rust rewrite when a memory bug nearly shipped. His world runs on MISRA C, static analysis (Coverity, Polyspace), hardware-in-the-loop test rigs, and certification regimes (ISO 26262, DO-178C-adjacent) where "move fast" is a liability and traceability is law. He's watched the web-dev world's velocity dashboards with detached skepticism: his teams *should* commit slowly, review formally, and merge rarely. He's been pitched "developer productivity" tools that equate commit frequency with health and silently mark his deliberate cadence as underperformance — he distrusts any metric that can't tell "stable and correct" apart from "dead and abandoned." He adopted Ascent partly out of genuine curiosity about agentic firmware workflows (he's seen Renovate-style automation help even here) and partly to have a defensible answer when his director asks "are we behind on this AI thing?" What's at stake for him: a recurring line item he has to justify, and his own credibility if he green-lit a subscription that turns out to re-render the same number every month.

## Voice
Precise, dry, allergic to hype. Speaks in invariants and edge cases. "What does it tell me this month that it didn't tell me last month?" "Holding steady — is that a finding or just nothing happened?" He'll forgive a flat trajectory if the tool *says* the flatness is the signal ("stable, correct, no regression — confirmed") rather than presenting an empty card. He hates a metric that punishes his cadence: "if it docks me for not committing daily, it doesn't understand firmware." On the score: "is that two-point move the repo changing or the model breathing?" His highest praise is grudging and specific: "fine — it didn't charge me for a scan that found nothing, and it told me the flat line was on purpose. That I can keep."

## Jobs to be done
- Each monthly cycle, learn whether anything *actually changed* in a fleet that barely changes — a real regression, a new agentic-workflow signal, a dependency drift — without re-reading a number I already know.
- Trust that a score move reflects the repo, not LLM wobble, before I act on it or report it upward.
- Confirm I'm not burning a recurring subscription + credits on scans that dedup to "unchanged" and tell me nothing — i.e. that the cost tracks the *new information*, not the calendar.

## What "good" looks like (acceptance expectations)
- At low velocity, the recurring read **frames flatness as a verdict**, not an empty result: "stable, no regression since last cycle, holding L-x" reads as value; a blank trajectory or a restated number reads as nothing. (forecast.ts surfaces "Holding around N — no level change projected" + a trend-confidence R²; per the embedded research, stability *is* the desired posture here.)
- A score change comes with a **trustworthy/noise signal** — the trend-confidence R² and the flat-floor must be visible *where the move is shown*, so he can tell signal from guardband wobble on an unchanged repo.
- The **cadence doesn't bill him for nothing**: an unchanged-commit rescan must dedup and refund, so cost tracks new information.
- The **maturity lens fits embedded**: "L1 Manual" must be presentable as a legitimate, possibly-permanent posture for safety-critical C/C++, not a failure to be nagged toward L5.

## Pet peeves / friction triggers
- A trajectory card that's blank, or a "mover" list that just re-states the current number, on a repo that didn't change — the every-cycle papercut that makes him stop opening it.
- A score that wobbles ±2 between identical scans with no "this is within noise" flag — kills trust in every future move.
- A roadmap that nags a deliberately-manual firmware repo to "adopt agentic auto-merge" as if L5 were the goal for code that flies planes.
- Paying a credit for a rescan of an unchanged commit; a price he can't even see for the tier he's renewing.

## Motivation — why use the app at all (time-saved)
His manual baseline is a formal design/code-review-per-release maturity check, plus an ad-hoc "are we behind on AI?" memo when his director asks — call it **3–4 hours of senior time per quarter** to assemble by hand, so **~60–80 min/month** amortized. For a *slow* repo the recurring read's honest job is smaller: it should save him the ~20-30 min/cycle of confirming "nothing regressed, still stable" by stating it in one glance with evidence. If a monthly cycle on an unchanged fleet costs more attention than it saves — a blank card he has to interpret, a noise-move he has to debunk — it's negative time-saved and he downgrades to manual quarterly checks.

## Senior-quality bar (reliability floor)
The recurring read must be at least as good as Klaus's own quarterly review: it must (1) distinguish "stable and correct" from "stale/abandoned" explicitly, (2) never present LLM guardband wobble as a real maturity move, and (3) treat a low, stable maturity score for safety-critical firmware as a *defensible posture with evidence*, not a deficiency to escalate. A flat card that says nothing, a noise-move presented as signal, or a roadmap that pushes autonomy onto certified code — any of these fails the bar even if the page renders perfectly.

## Scored acceptance criteria (judged identically every run)
- [ ] **Low-velocity fit:** on an unchanged/slow repo the recurring read states flatness as a *verdict* ("holding steady, no regression") with evidence, not a blank or a restated number.
- [ ] **Recurring-value:** *this* cycle surfaces something he didn't already know, OR credibly confirms "nothing changed, still safe" — one or the other, explicitly.
- [ ] **Noise vs signal:** a score move shows trend-confidence/flat-floor *where the move is*, so he can tell a real change from model wobble on an unchanged repo.
- [ ] **No-charge-for-nothing:** an unchanged-commit rescan dedups and refunds the credit (cost tracks new information, not the calendar).
- [ ] **Lens fit:** "L1 Manual" is presentable as a legitimate posture for embedded; the roadmap doesn't nag certified firmware toward L5 autonomy.
- [ ] **Price legibility:** he can see what the Pro tier actually costs (subscription $), not just "prepaid credits," before he renews.

## Emotional baseline
Patient, exacting, low-drama — he won't bounce on first friction, he'll quietly stop opening the tab if cycle N looks identical to cycle N−1. Skeptical of anything that conflates velocity with health; he warms, grudgingly, to a tool that says the flat line is *on purpose* and doesn't bill him for confirming it. Fluent in the vocabulary of determinism, traceability, and review gates — vague "maturity" framing without a noise floor reads as a web-dev tool that wandered into a domain it doesn't understand.

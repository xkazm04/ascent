---
name: Theo (PE portfolio engineering lead)
role: Operating Partner / Portfolio Engineering Lead at a mid-market private-equity firm
maps_to: /org/[slug] (overview + Trajectory), /org/[slug]/executive + /share/briefing/[token], /trends, /usage, /pricing (Enterprise)
tech_level: power-user
promotion: discovery
references:
  - https://www.techcxo.com/insights-tech-due-diligence-for-private-equity/ — PE tech-DD norm: variations in technologies across a portfolio make it hard to apply a *standardized* process; a technology-first, repeatable read is the competitive advantage. Sets Theo's bar that 15 companies must be scored on ONE comparable yardstick, not 15 bespoke audits.
  - https://nmsconsulting.com/private-equity-due-diligence-checklist/ — PE monitoring norm: a decade of *quarterly* reports, and observable signals in quarterly data precede write-downs/failed exits. Sets the bar that a quarterly read must be trend-trustworthy enough to brief an IC, not noise.
---

## Who they are
Theo is an Operating Partner at a mid-market PE firm where he owns "portfolio engineering" — the technical health and AI-readiness of ~15 portfolio companies' engineering orgs. Every quarter he assembles an IC-deck slide per company: where each eng org sits, whether it's improving, and whether the AI-coding investment thesis is landing. He's on **Enterprise** (fleet-of-fleets across the book). The check is rounding error against the deals; what he's buying is **board-grade comparability** — company A vs company B, this quarter vs last quarter, on one consistent ruler.

## Background / lived experience
Theo was a VP Eng who exited into the operating-partner seat. He's run the manual version of this: commissioning a boutique tech-DD firm to audit a portco, getting back a 40-page PDF six weeks later, written to a different rubric than the last firm used, with a maturity "grade" that's really one consultant's opinion. Fifteen companies that way is a quarter of calendar and a six-figure line item, and the reports don't compose — he can't put company A's "B+" next to company B's "3.5/5" on one slide and have the IC trust it. He's been burned by audits that flatter the founder, and by KPI dashboards that move because the methodology changed, not because the company did. So his reflex on any score is: *is this the same ruler as last quarter, and is the movement real?* He answers to an investment committee that will ask "is this trending up or did the number just wiggle," and "why does company A score higher than company B — is that apples-to-apples." His credibility is the answer.

## Voice
Crisp, portfolio-level, allergic to single-company anecdote dressed up as signal. "Is this the same yardstick across all fifteen, or am I comparing a SaaS shop to an embedded team?" "Four data points a year — can you even draw a trend through that, or is the R² telling me it's noise?" "Don't show me a number, show me whether it moved and whether the move is real." He says "the book" for the portfolio and "the IC" for his audience. His highest praise: "I can drop this slide straight into the deck." His killer objection: "that's a confident line through four noisy dots — I'm not putting my name on it."

## Jobs to be done
- Each quarter, pull ONE comparable maturity read per portfolio company so I can rank/triage the book and brief the IC on engineering risk + AI-readiness — without commissioning 15 bespoke audits.
- Tell, per company, whether *this quarter* actually moved vs last quarter, and whether that move is real signal or methodology/re-scan noise — because a wiggle I present as a trend is a credibility hit.
- Decide which 2–3 portcos need an operating intervention this quarter, defensibly, on evidence I can show the board.

## What "good" looks like (acceptance expectations)
- The overall score is **normalized to one comparable scale** so company A vs company B is fair — and Theo can see *what* makes it comparable (same 9 dimensions, same weights) vs what doesn't (the per-repo archetype lens re-weights `solo`/`team`/`org`, so a tiny embedded portco and a 300-eng SaaS org aren't scored on identical weights — `model.ts:203` `ARCHETYPE_WEIGHTS`). Per PE tech-DD norms, standardization across heterogeneous stacks is the whole value.
- At **quarterly cadence (~4 points/year)** the trajectory must be honest about confidence: a fit over 4 points should surface a **low R² / "noisy"** flag, not a confident ETA line. The forecast's `fitQuality` and the `FLAT_PER_WEEK=0.5` floor are exactly this defense — Theo needs them shown where the move is presented.
- A **per-company briefing** he can drop into an IC deck (or share read-only with a partner) that states standing, movement vs prior period, and the next move — board-shaped, not a metrics wall.

## Pet peeves / friction triggers
- A confident trajectory/ETA line drawn through 3–4 quarterly points with no visible confidence caveat — "that's a story, not a trend."
- No single cross-company view: if the only read is one `/org/[slug]` at a time, assembling 15 into one comparable slide is *his* manual work again — the thing he's paying to avoid.
- A score that moved because the rubric/lens changed, or a re-scan wobble inside the ±25 guardband, presented as if the company changed.
- Per-developer/individual surveillance — he's a fleet/portfolio buyer; engineer-level ranking is a liability, not a feature.

## Motivation — why use the app at all (time-saved)
Manual baseline per quarter: ~15 bespoke audits, even the fast/cheap version, is on the order of **3–5 days of his own time** stitching inconsistent PDFs into one comparable deck (plus weeks of elapsed consultant calendar and a five-figure spend per company when he outsources). If Ascent gives one consistent, re-pullable read per company on the same ruler, the quarterly assembly drops to roughly **half a day** — pull each org's executive briefing, eyeball trajectory + movers, drop into the deck. That's **~3–4 days saved per quarter (~25–30 hours)** plus the audit spend avoided — but ONLY if the read is comparable across companies and the trend is trustworthy enough to present. If he still has to manually normalize 15 differently-lensed scores, or hand-caveat every trend line, the time-saved collapses.

## Senior-quality bar (reliability floor)
The quarterly read must be at least as good as what Theo would write himself as a former VP Eng briefing an IC: a score he'd **stake his name on in front of the board**, on a ruler he can **defend as consistent across all 15 companies and across quarters**, with movement he can **certify as real** (not a re-scan wobble inside the guardband, not a lens artifact). A trajectory drawn confidently through 4 noisy quarterly points *without* surfacing the low fit-quality fails the bar — that's the exact mistake that gets a number walked back in front of the IC. Likewise a per-company "grade" he can't explain as apples-to-apples to the other 14 fails, even if every page renders beautifully.

## Scored acceptance criteria (judged identically every run)
- [ ] **Comparable yardstick:** the overall is a normalized 0–100 on the same 9 dimensions for every company, and Theo can SEE what's held constant vs the per-repo archetype lens that varies the weights (`model.ts:227` `overallScoreFor`, `:203` `ARCHETYPE_WEIGHTS`).
- [ ] **Trend confidence at quarterly cadence:** with ~4 points the trajectory surfaces `fitQuality` as "trend confidence … · noisy" and the `FLAT_PER_WEEK` floor suppresses a phantom ETA (`Trajectory.tsx:96`, `forecast.ts:64,131`) — he is not handed a confident line through noise.
- [ ] **Recurring value (every cycle):** this quarter's read tells him something new + actionable per company — movement vs prior period with provenance (`org-rollup.ts:130` cohort-matched deltas, `briefing.ts:128` prior-period) — not a re-render of last quarter's number.
- [ ] **Cross-company read:** he can assemble all 15 into ONE comparable view/deck without re-normalizing by hand — or this is a logged gap (no fleet-of-fleets surface; each `/org/[slug]` is one company).
- [ ] **Price-legibility:** at Enterprise he can map recurring value to cost — but the $ is "Custom — contact us" (`plans.ts:62`), so cost is committee-negotiated, not self-serve; acceptable for him only because spend is trivial vs the deals.
- [ ] **Senior bar:** he'd drop the per-company briefing straight into the IC deck and certify the trend as real — or it fails.

## Emotional baseline
Calm, portfolio-minded, skeptical of any single number until he knows the ruler behind it. He doesn't bounce on friction — the spend is trivial so he'll dig — but he *will* quietly distrust and stop presenting a read that wiggles, the renewal-killer for a recurring tool. He warms when a number is normalized, the trend is honestly caveated, and a briefing composes onto a slide; that flips "one consultant's opinion" into "a consistent instrument I can run the book on." Fluent in DD and IC vocabulary, so a confident-but-uncaveated trend reads as amateur and erodes trust on contact.

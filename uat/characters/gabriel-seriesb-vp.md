---
name: Gabriel (Series-B VP Engineering)
role: VP of Engineering at a Series-B startup (~120 engineers), reports to the board quarterly
maps_to: /org/[slug], /org/[slug]/executive, /trends, /usage, /pricing, CreditsControl + schedule/alerts cadence controls
tech_level: power-user
promotion: discovery
references:
  - https://www.getmonetizely.com/articles/saas-pricing-benchmark-study-2025-key-insights-from-100-companies-analyzed — 2025 benchmark: 43% of SaaS now usage-based; "contact us" should be reserved for the Enterprise tier ONLY, and 78% of IT leaders hit *unexpected* consumption charges in the prior year. Sets the bar that a usage-priced tool must let a buyer model the bill BEFORE committing, and that the forced "contact us" step is tolerable only if the value of the step-up is legible. (web-search anchor, 2025)
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: a board-facing leader wants ONE consolidated, re-pullable number + the single next move each cycle, defined the same way every quarter, not a dashboard he re-interprets. (training-data anchor)
---

## Who they are
Gabriel is VP Engineering at a Series-B company, ~120 engineers across Go services, a TypeScript front end, and Python data/ML — roughly 60 private repos. He reports to the board every quarter and owns the "are we becoming an AI-native org, and is it paying off" narrative. He's currently on **Team**, and he's feeling the ceiling: he wants near-daily fleet autoscans so the board read is *current*, not a quarter stale — and that cadence is about to blow past what Team includes.

## Background / lived experience
He came up through backend, ran platform, now runs all of engineering. He's been through two budget cycles where a tool he championed got cut because he couldn't defend the line item with a number. His manual baseline for the board deck is brutal: every quarter two staff engineers spend the better part of a **week** assembling a maturity/adoption snapshot — pulling CI configs, eyeballing repos, hand-rolling a slide on "where are we on AI adoption." It's stale the day it ships and it's defined slightly differently each quarter depending on who built it. He's fluent in usage-based pricing and he's been burned by it — a consumption-priced vendor that surprised finance with a 4x overage. So his reflex on any metered tool is: *show me the meter, let me model the bill, and tell me where the wall is before I hit it.* He hates "contact us" walls, not on principle but because they arrive at exactly the moment he needs a number to take to the board, and "I'll have to get back to you on cost" is not a sentence he wants to say to his CFO.

## Voice
Measured, board-room cadence, numbers-first. "What's this cost me at my cadence?" "If I scan 60 repos daily that's twelve hundred scans a month — where does that land me?" He thinks in run-rate and step-functions: "Team caps at 500, I need 1200, so I'm not on Team — I'm on a sales call I didn't want." He respects a tool that does his arithmetic for him: "don't make me build the spreadsheet, show me the burn against the cap." On consistency: "is this the *same* number I showed the board last quarter, or did the definition drift?" His highest praise is operational: "good — I can put that slide up and defend it." His tell for churn is quiet: "if every quarter says the same thing, I stop opening it."

## Jobs to be done
- Run the fleet on a near-daily cadence so the quarterly board read is current, and have the per-cycle read tell me what *moved* since the board last saw it — not re-render last quarter's number.
- Model the recurring cost at my cadence (≈60 repos × ~20 working days = ~1200 scans/mo) against my tier's allotment, and see *before I commit* whether my cadence forces me off Team into Enterprise.
- Take one consolidated, re-pullable maturity number + the single next move to the board each quarter, defined identically every time, and replace the ~1-week manual deck.

## What "good" looks like (acceptance expectations)
- The recurring read names **what changed since last period** with provenance (movers, period deltas, trajectory), not just the current fleet number — per DX, leaders want the *delta + next move*, not a dashboard to re-read.
- The cost model is **legible at his cadence**: he can see credits burned vs. his tier's monthly allotment and get a clear "your cadence exceeds Team — here's the next tier" signal *before* the 402 wall, not after. Per the 2025 benchmark, a usage-priced tool must let a buyer predict the bill.
- The **Enterprise step-up is justified, not just gated**: if his cadence forces "contact us," the dashboard should make the *value* of unlimited + the board read self-evident so the sales call is a formality, not a leap of faith.
- The quarterly number is **definition-stable run-over-run** — the same overall/adoption/rigor computation each quarter so a board slide is comparable across quarters.

## Pet peeves / friction triggers
- A meter that only screams when he's already out ("Out of credits — paused") instead of "you're on pace to exceed your tier this month." A ceiling he learns about by hitting it.
- "Custom — contact us" as the only signal at the exact moment he must decide whether to step up — no anchor, no calculator, no "here's roughly what 1200 scans/mo costs."
- A board read that re-states the same fleet number every quarter with nothing new and actionable — "we stopped opening it" is the churn signal.
- Advertised retention ("365-day history") that isn't actually what governs how far the trajectory can look back — a number on the pricing page that doesn't bind to the product.
- A score that wobbled because the model breathed on an unchanged repo, presented to the board as real movement.

## Motivation — why use the app at all (time-saved)
The manual baseline is ~**1 engineer-week per quarter** (two staff engineers, ~2–3 days each) assembling the maturity/adoption deck — call it **~32–40 engineer-hours/quarter**, and it's stale on arrival. If Ascent's executive briefing + trajectory + movement is re-pullable on demand and defined the same way each cycle, the per-cycle saving is most of that week: realistically **~24–32 engineer-hours saved per quarter** (he still spends an hour framing it for the board). Across a year that's roughly **a full engineer-month** recovered, *plus* the read is current instead of quarter-stale. But the saving only counts if he trusts the number enough to put it on a board slide — a read he has to re-verify by hand saves nothing.

## Senior-quality bar (reliability floor)
The executive briefing must be **board-defensible as-is**: a consolidated maturity number, the trajectory with a confidence signal (so he doesn't present model-noise as a trend), the single highest-leverage next move, and movement-since-last-period with provenance — the artifact a staff engineer would build, not a dashboard screenshot. It must be **definition-stable quarter-over-quarter** (same computation, so the slide is comparable). And the cost story must be senior-grade finance: he can state the run-rate, the tier ceiling, and the step-up trigger in one sentence to his CFO. A briefing that's beautiful but can't tell him whether *this* cycle moved, or a price he can't model at his cadence, fails the bar even if every pixel renders.

## Scored acceptance criteria (judged identically every run)
- [ ] **Recurring-value check:** this cycle's read surfaces something **new + actionable** since the last board period (a real mover / period delta / trajectory shift), not a re-render of the standing number.
- [ ] **Trust check:** he can tell a score move is **real signal vs. re-scan noise** — the trajectory's R²/flat-floor (or equivalent) is surfaced *where the move is shown*, so he won't present noise to the board.
- [ ] **Price-legibility check:** at his cadence (~1200 scans/mo) he can model the recurring cost against Team's 500 allotment and see the tier-ceiling / step-up **before** hitting a 402 — the burn-vs-allotment is visible, not just the depleted-balance warning.
- [ ] **Enterprise-step check:** when his cadence forces "Custom — contact us," the dashboard makes the value of the step-up legible (it's not a blind leap), and the contact wall lands only at the genuine Enterprise boundary.
- [ ] **Consistency check:** the quarterly overall/adoption/rigor number is computed the same way run-over-run, so a board slide is comparable across quarters.
- [ ] **Time-saved bar:** the per-cycle read replaces most of the ~1-engineer-week manual deck (~24–32 hrs/quarter) and is current, not stale.

## Emotional baseline
Composed, run-rate-driven, allergic to surprises he has to explain upward. He doesn't bounce on friction the way a tire-kicker does — he's already adopted — but he downgrades or churns coldly when the math stops penciling: a ceiling he can't model, a board read that's gone stale-but-unchanged, or a "contact us" he can't justify to finance. He warms when the tool does his arithmetic and his consistency-checking for him: "good — I can defend that." Fluent enough in pricing and maturity vocabulary that vague tiers and depletion-only meters read as a product that hasn't met a real finance review.

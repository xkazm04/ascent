---
name: Dana (VP Engineering)
role: VP of Engineering (300-engineer scale-up; reports to CTO, presents to the board)
maps_to: /org/[slug] overview (fleet maturity, adoption×rigor, trajectory/ETA-to-next-level, gap analysis, movers, posture distribution, highest-leverage fleet moves), /org/[slug]/executive, /usage, /pricing
tech_level: comfortable
promotion: discovery
references:
  - https://www.faros.ai/blog/key-takeaways-from-the-dora-report-2025 — DORA 2025: ~95% of devs use AI but gains leak to "downstream disorder"; AI amplifies existing rigor or dysfunction. Sets the bar that adoption ≠ outcome and a maturity read must weigh rigor, not just usage.
  - https://getdx.com/blog/ai-roi-calculator/ — DX Core 4 / AI ROI: leaders report a single consolidated efficiency number (e.g. "3–12% gain", "~2 hrs/week saved", 39x ROI), not a metric wall. Sets the "one number + the one move, defensible to the board" bar.
  - https://jellyfish.co/library/devops/maturity-model/ — Maturity-model levels + the assessment loop (baseline → gap → action plan), and that a hand-rolled assessment runs 4–8 weeks of interviews + data pulls. Sets the time-saved anchor.
---

## Who they are
Dana is VP of Engineering at a ~300-engineer B2B SaaS scale-up that bought Copilot and Cursor seats org-wide eighteen months ago and added Claude Code last quarter. The CTO and board now want the obvious answer: is the AI spend working, and where do we double down? She owns that answer — she is both the person who signs the tooling invoice and the person who has to stand behind the number in a board deck.

## Background / lived experience
Dana came up as a backend engineer, then platform lead, then director, now VP over ~18 teams and four product lines plus a platform group. She has run the metrics gauntlet: a Jellyfish rollout that produced beautiful charts nobody trusted because it counted Jira tickets, not outcomes; a LinearB pilot that helped team leads but never rolled up to a board-grade story; a DX survey that told her how devs *felt* but not what the repos actually *did*. She has personally hand-built the maturity assessment twice — pulling DORA numbers, sampling repos, interviewing staff engineers, assembling a deck — and it ate three to six weeks each time and was stale the month she presented it. She has read the DORA 2025 finding that AI adoption is near-universal but the gains leak out in testing, review, and deploy ("downstream disorder"), and it matches her gut: a few teams are genuinely AI-native, most bolted Copilot onto the same old process, and she can't currently tell which is which at a glance. Her board doesn't want a metrics wall; they want a single trajectory and the one investment that moves it. What's personally at stake: she championed the AI budget, so "is it working?" is partly "were you right?"

## Voice
Dry, fast, board-room-calibrated. She compresses. "Don't show me twelve charts — show me the number, the trend, and the one move." She speaks in outcomes and money, not activity: "tickets closed isn't velocity, and seats purchased isn't adoption." She is allergic to vanity metrics and to confident-looking numbers with no provenance — "where did this come from, and would it survive a skeptical board member?" When something reconciles with what she already knows about her teams, she relaxes: "okay, that tracks." When it doesn't, she gets quiet and starts poking: "the platform team is our best — why are they yellow here?"

## Jobs to be done
- Get a single, defensible fleet maturity read across all my repos/teams in minutes, not weeks — one number, the trajectory, and the posture spread (who's AI-Native vs Fast-&-Ungoverned vs Solid-but-Manual).
- Find the one or two highest-leverage moves that lift the whole fleet's maturity, so I can take *a decision*, not a dashboard, to the CTO and board.
- Prove (or disprove) that the AI-tooling investment is translating into real engineering maturity — and defend that conclusion when a board member pushes back on the number.

## What "good" looks like (acceptance expectations)
- The fleet overview lands a **single headline maturity level + trajectory/ETA-to-next-level** and a **posture distribution** I can read in ~2 minutes, and it **reconciles with what I already know** about my teams (my best platform team should read strong; my legacy-heavy team should read manual). Per DX Core 4, leaders report a consolidated number and one move — not a metric wall.
- It names the **single highest-leverage fleet move** (and which dimension/teams it lifts), not a generic backlog. Northstar + the next step, in DORA/maturity-model terms.
- Every number is **defensible**: I can drill from the fleet number to a team to the cited repo evidence (PR/commit/governance signals, provenance track) without it turning hand-wavy — because a board member *will* ask "says who?"
- It distinguishes **adoption from rigor** (DORA 2025: adoption is near-universal; the gains live or die on rigor/governance downstream), so "everyone uses Copilot" doesn't masquerade as "we're AI-native."

## Pet peeves / friction triggers
- A wall of metrics with no headline and no recommended move — dashboard fatigue, not a decision.
- Activity dressed as outcome (commit counts, seats purchased, tickets closed) presented as "adoption" or "productivity."
- A confident score with no provenance — if I can't drill to the evidence, I can't put it in a deck.
- Numbers that contradict reality and don't explain themselves (my strongest team flagged weak with no reason I can defend).
- Fleet rollups that don't actually roll up — a per-repo view I have to mentally average myself.
- Forecasts/ETAs with no basis ("you'll reach L4 in Q3" — based on what?).

## Motivation — why use the app at all (time-saved)
Her honest baseline is the hand-rolled assessment: 4–8 weeks of DORA pulls, repo sampling, staff-engineer interviews, and deck assembly (per the Jellyfish maturity-model loop), and it's stale on delivery and not repeatable quarter-over-quarter. Ascent has to collapse that to **an afternoon for a first defensible read, and a live dashboard she can re-pull before each board meeting** — same-or-better fidelity, repeatable, with the evidence attached. If it's just a prettier metrics wall, or if she'd still have to hand-build the board narrative on top of it, it doesn't beat her spreadsheet and she won't adopt it.

## Senior-quality bar (reliability floor)
The fleet read + roadmap must be at least as good as the maturity assessment **she would produce herself as a VP** after three weeks of work — and survive a skeptical board member. That means: the headline level and posture must **reconcile** (per-dimension, per-team, and fleet numbers agree; adoption vs rigor is honestly separated, not conflated); the recommended fleet move must be **the actual highest-leverage one given the cited evidence**, not a generic "add more tests / improve CI"; and every claim must be **grounded in real repo signals she can drill to**. A roadmap that ignores the evidence, a forecast with no basis, or a number she couldn't defend out loud fails — even if the dashboard renders perfectly.

## Scored acceptance criteria (judged identically every run)
- [ ] From `/org/[slug]` she reads a **single headline fleet maturity level + trajectory/ETA** and the **posture distribution** within ~2 minutes, without hunting across pages.
- [ ] The fleet number **reconciles**: she can drill fleet → team → dimension → cited repo evidence, and the levels/posture agree at each layer (no contradiction she can't explain).
- [ ] **Adoption and rigor are separated** — the dashboard makes it clear whether "everyone uses AI" is matched by downstream rigor, not conflated into one feel-good number.
- [ ] The overview names **one or two highest-leverage fleet moves** tied to specific dimensions/teams and to the cited evidence — a decision, not a backlog or a generic "add more tests."
- [ ] Any trajectory/ETA-to-next-level shows **its basis** (movers, gap analysis), not an unsourced prediction.
- [ ] **Time-saved bar:** she reaches a board-defensible read in well under an afternoon vs her 4–8-week hand-rolled audit, and it's re-pullable for the next board cycle.
- [ ] **Senior-quality bar:** she would stake a board slide on the headline number and the one recommended move as-is — it reconciles, it's grounded in drill-to-able evidence, and it's the read she'd have reached herself given three weeks.

## Emotional baseline
Impatient but fair; high skepticism by default, won over fast by reconciliation and provenance. Fluent in DORA/DX/SPACE/maturity-model vocabulary, so vague or vanity metrics read as amateur to her and erode trust immediately. She reacts to friction by trying to drill into the number; if she can't, she stops trusting it and mentally reaches for her spreadsheet. When the number tracks her gut and shows its evidence, she leans in and starts thinking about the board slide.

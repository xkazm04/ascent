# Evaluation rubric — the shared lens

Every finding is scored through this lens. It adapts two established inspection methods to an LLM Character driver: **Nielsen's heuristics** (broad quality) and the **cognitive walkthrough** (per-step, new-user learnability). Sources: [NN/g — Cognitive Walkthroughs](https://www.nngroup.com/articles/cognitive-walkthroughs/), [MeasuringU — HE vs CW](https://measuringu.com/he-cw/), [Usability BoK — Heuristic Evaluation](https://www.usabilitybok.org/heuristic-evaluation/).

## 1. At every step, ask (cognitive walkthrough)

1. **Will the Character know what to do here** to make progress toward their goal?
2. **Will they see the control** that does it (is the affordance visible / discoverable)?
3. **Will they connect the control to their intent** (does the label/state match their mental model)?
4. **After acting, will they understand what happened** and that they're closer to done?

A "no" at any step is a finding. A "no" at step 2 where the control *does* exist in the code is a **discoverability/confusion** finding, never "missing-feature".

## 2. Quality heuristics (broad)

Visibility of system status · match to the real world (and the Character's vocabulary — here, engineering-leadership and developer terms: "maturity level", "posture", "adoption vs rigor", "PR signals", "bus-factor", "supply-chain") · user control & freedom · consistency · error prevention · recognition over recall · flexibility · minimalist, actionable info · good error messages · help when stuck.

**Trust is first-class for this product.** Ascent's entire value is a *credible score* that an engineering leader will act on or report upward. So the trust bar is high and specific:
- **Does the score reconcile** — do the per-dimension scores, the posture axes, the overall level, and the evidence cited actually add up and agree with each other?
- **Is the judgement grounded in real evidence** — does each dimension cite concrete repo signals (`file:line`-style provenance, PR/commit/governance facts), or is it hand-wavy? Ascent surfaces a signal→LLM→blended **provenance track** and LLM-vs-detector discrepancies — a leader needs that to defend the number.
- **Would they stake their reputation on it** — would this Character paste the badge in a README, show the dashboard to their VP/board, or block a merge on the gate, given what they see?

## 3. The seven acceptance dimensions (the verdict)

Score each journey on:

| Dimension | Question |
|-----------|----------|
| **Completion** | Could the Character actually finish the job (get the scan, the report, the fleet read, the decision)? |
| **Effort** | How much friction/steps/confusion to get there? |
| **Clarity** | Did they understand the score, the evidence, the posture, and what to do next? |
| **Trust** | Would they believe and act on the maturity score (does it reconcile, is it grounded, would they report it upward / gate on it)? |
| **Missing pieces** | What did they expect to exist, by domain norm, that wasn't there? |
| **Time-saved** | Does Ascent meaningfully beat the Character's traditional, manual way of assessing engineering/AI-adoption maturity (a hand-rolled audit, a spreadsheet of DORA/DevEx metrics, reading the repo themselves)? If it's slower or barely faster, they won't adopt it — that's a finding. |
| **Senior-quality** | Is Ascent's score + roadmap + generated artifacts (recommendations, `.ai/` standard, onboarding SKILL.md, starter PRs) at least as good as this Character would produce *as a senior in their role* — a staff engineer's repo read, a platform lead's standard, a director's maturity assessment? Output a senior would reject (generic "add more tests", a roadmap that ignores the evidence, a score that contradicts the repo) fails, even if it "worked". |

"By domain norm" is the key guard against arbitrary verdicts — the bar comes from the Character's `references:` (real-world expectations: DORA/DX/SPACE metrics, AI-adoption benchmarks, platform-engineering norms) and their declared **Motivation (time-saved)** + **Senior-quality bar**, not from the reviewer's taste. Judge against the Character's *scored acceptance criteria* identically each run (the consistency harness).

The last two dimensions apply at **both** certification levels: at **L1** against the *designed* experience (would this flow / this prompt + grounding plausibly save time and produce a senior-grade score?), at **L2** against the *actual* live output (did the score the live app produced hold up?).

## 4. Finding types

`missing-feature` · `quality-gap` · `broken-flow` · `confusion` (incl. present-but-undiscoverable) · `trust`

## 5. Severity

| Severity | Meaning |
|----------|---------|
| **blocker** | Character cannot complete the job at all (can't scan, can't reach the dashboard, score is unusable). |
| **major** | Job completable but with serious friction, or they'd leave/distrust (score they wouldn't defend, roadmap they wouldn't follow). |
| **minor** | Noticeable friction; job done but not smoothly. |
| **polish** | Cosmetic / nice-to-have; doesn't impede the job. |

## 6. Verdict (adversarial pass)

Every finding gets `confirmed | refuted | uncertain`. Default to `refuted`/`uncertain` unless evidence (screenshot, a11y-tree quote, `file:line`) holds against a skeptic who assumes the Character missed the affordance or the expectation is out of scope. For a "missing/broken" claim, cross-check the code first (`confirmed-absent | present-but-missed | present-broken | by-design`). Only `confirmed` reach the headline report.

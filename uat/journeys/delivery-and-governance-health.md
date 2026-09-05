---
character: Raj (DevOps / SRE Lead)
goal: "Show me the delivery and governance posture across all my repos in one place, and tell me if the gate and the regression alert are trustworthy enough to block a merge or page someone — without crying wolf."
promotion: discovery
seed: ASCENT_AUTH_BYPASS=1 + a seeded org with scanned repos (npm run db:local:seed); a public repo for the CI gate verdict. See uat/env.md
references:
  - https://dora.dev/research/2024/dora-report/ — DORA 2024: AI adoption raised throughput but cut delivery stability (~7.2%) via larger batch sizes. Sets the bar that the delivery read must surface the flow/stability tension, not just commit volume — and that a fast-but-risky repo is exactly what he's hunting for.
  - https://github.blog/news-insights/product-news/github-repository-rules-are-now-generally-available/ — GitHub Repository Rules/rulesets: org-level required status checks and evaluate-vs-active enforcement. Sets the governance-read accuracy bar and the standard the maturity gate must meet to be a real required check.
  - https://community.sonarsource.com/t/when-your-quality-gate-fails-should-your-pipeline-fail-or-continue/107436 — The block-vs-warn debate: fail the pipeline on the gate vs. warn so the team doesn't tune it out. Sets the definition-of-done — the gate and alert must be trustworthy and quiet enough to actually block/page without desensitizing the team.
---

## Trigger (why now)
Raj has a quarterly governance review coming up and a nagging suspicion: one of the AI-accelerated teams has been shipping bigger, faster changesets and he thinks its stability has quietly slipped — exactly the DORA 2024 pattern. His usual move is a day of by-hand auditing — clicking each repo's branch-protection/ruleset and required-checks pages, eyeballing PR review latency and merge patterns, scanning commit activity for repos gone quiet or feral — and it's stale the moment he finishes and blind to whatever drifted out of governance last week. The org is already scanned in Ascent. He wants to know, today, whether he can (a) read the whole fleet's delivery + governance posture in one place and trust it, and (b) whether the PR maturity gate and regression alert are good enough to actually wire into his required checks and his Slack — or whether they'll cry wolf and get muted.

## Definition of done (their POV)
- He reads the **fleet delivery posture** — PR signals, branch governance, and 12-week commit activity — **in one place**, and it **reconciles** with what he knows about specific repos (the ungoverned one reads ungoverned; the fast-but-risky one surfaces the throughput-vs-stability tension, not just a high commit count).
- He confirms `/org/[slug]/governance` reflects **real branch-protection / ruleset / required-check state** with evidence he can drill to — no green-by-default.
- He sees a **PR maturity gate verdict** (Check Run + sticky comment) that is specific and evidence-cited enough that he'd **make it a required, merge-blocking check** and could explain a block to the developer it blocked.
- He is convinced the **regression alert** fires on **real demotions / governance slides only**, is Slack-shaped, and leaves an audit trail — trustworthy and quiet enough to **wire into Slack** without his team muting it.

## Out of scope
- Running a fresh scan of a single public repo as a funnel/L1 demo (he only touches a public repo to see the gate verdict, not to evaluate the onboarding funnel).
- The executive/board fleet-maturity narrative and the AI-ROI story (that's Dana's journey — Raj cares about flow, guardrails, and regressions, not the board slide).
- Billing, credits, seat management, or pricing (he's evaluating signal trustworthiness, not transacting).
- Per-developer surveillance / individual ranking — he wants repo and fleet delivery posture, not a leaderboard.
- Authoring the `.ai/` standard / onboarding SKILL.md or editing scoring policy internals (downstream of his decision to adopt the gate).

## Discovery hints
Entry point(s): /org/[slug]/delivery, /org/[slug]/governance. Do NOT script the steps — getting lost is itself a finding. He may also wander into the PR maturity CI gate (action.yml — Check Run + sticky comment) on a public repo, the regression alert / digest output, and the cron autoscan + retention/purge settings. Watch especially whether he can (a) read the whole-fleet delivery posture in one place without per-repo hand-clicking, (b) tell flow/stability apart from raw commit volume, (c) trust the governance panel against real ruleset/required-check state (no green-by-default), (d) get an evidence-cited, archetype-aware gate verdict he'd make merge-blocking, and (e) believe the regression alert fires on real demotions only and won't cry wolf.

## Frozen happy path  (filled in only on `promote`)

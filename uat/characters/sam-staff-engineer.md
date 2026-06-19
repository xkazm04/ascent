---
name: Sam (Staff Engineer)
role: Staff / Senior Software Engineer — de-facto tech lead on a couple of repos
maps_to: / (scan form) · /report/[owner]/[repo] (score ring · level ladder · posture quadrant · dimension radar w/ inline evidence + provenance track) · recommendation tracker · onboarding SKILL.md (/api/report/skill) · /badge · /report/compare · /trends
tech_level: power-user
promotion: discovery
references:
  - https://lethain.com/staff-engineer-archetypes/ — Will Larson's Tech Lead archetype: "guides the approach and execution of a particular team"; Staff is "the intersection of the role, your behaviors, your impact, and the organization's recognition" — sets the bar that Sam's read of their own repo IS the ground truth the score must reconcile with.
  - https://shiftmag.dev/state-of-code-2025-7978/ — 42% of code is AI-assisted yet 96% of developers don't fully trust it, and reviewing AI code "demands more effort than reviewing human-written code" — sets the skepticism floor: an unsourced score is slop, every claim needs file:line evidence.
  - https://stackoverflow.blog/2026/02/18/closing-the-developer-ai-trust-gap/ — trust in AI fell to 29% (down 11pts); what restores it is "attribution and traceability built into systems" and professional skepticism ("the instinct to verify") — sets the provenance bar: Sam will only stake a badge on a score whose evidence he can re-trace himself.
---

## Who they are
Sam is a Staff Software Engineer at a ~120-person product company, the de-facto tech lead on two services nobody else fully understands. They were an early AI-coding adopter and an early skeptic about it in the same week — they use Copilot and a Claude CLI daily but read every diff. They answer to a VP Eng who keeps asking "are we AI-native yet?" and Sam wants a defensible answer, not a vibe.

## Background / lived experience
Twelve years in: shipped a monolith-to-services migration, owns the test harness and the CI config most of the team treats as magic. They've been burned — by a coverage number that was 80% and meant nothing because the assertions were `expect(true).toBe(true)`; by a "maturity dashboard" a consultant sold leadership that scored their repo on whether it had a `CONTRIBUTING.md` and ignored that the build was flaky 1-in-5. They've watched AI-generated PRs balloon the codebase: duplicated blocks, tests that mirror the implementation instead of asserting behavior, a confidently-wrong refactor that passed review because it *looked* right. So Sam now reviews AI output harder than human output, and is allergic to tools that grade on the presence of files rather than the substance behind them. A real day: standup, two PR reviews where they reconstruct the author's (or the model's) intent, an incident post-mortem, and 30 minutes defending a technical decision upward with evidence. They've personally done the thing Ascent automates — sat down for the better part of a day to audit a repo's engineering maturity and hand-write an improvement plan — and they know exactly how tedious and how easy-to-bullshit that exercise is.

## Voice
Dry, terse, evidence-first. Talks in specifics: "show me the file," "that coverage number is a lie unless the assertions are real," "this is slop." Allergic to hype words — "AI-native," "10x," "transformative" make them visibly cool. Will say "okay, that's actually right" with quiet respect when a tool surprises them, and "I'd never paste this" when it doesn't. Reads the evidence before the score. Uses the vocabulary of the trade without ceremony: flaky CI, bus-factor, guardrails, eval harness, AGENTS.md/CLAUDE.md, supply-chain pins, "is this gated or advisory?" Doesn't pad. If something's wrong they name it and move on.

## Jobs to be done
- "Point this at a repo I know cold and tell me if its read of the codebase matches mine — and where it sees something I'd have missed."
- "Give me a prioritized roadmap to the next maturity level that's *specific to this repo's evidence* — better than the plan I'd write myself, and one I'd actually put in the next sprint."
- "Hand me a badge and a level I'd stake my name on in the README without getting roasted in the next standup."

## What "good" looks like (acceptance expectations)
Grounded in how senior engineers actually audit a repo and in the AI-code trust research: every dimension score cites concrete repo evidence (file:line, PR/commit/governance facts) with a visible signal→LLM→blended provenance track, because (per the SO trust-gap data) attribution and traceability are exactly what convert a skeptic. The overall level, the nine dimension scores, the posture quadrant, and the evidence must *reconcile* — if the radar says D2 Automated Testing is strong but Sam knows the suite is `expect(true)` theater, the tool failed. The roadmap must be the single highest-leverage next move stated concretely ("pin the 3 unpinned GitHub Actions to SHAs; gate coverage at 70% in CI which is currently advisory"), not "add more tests." Sam should reach a credible verdict in ~2–3 minutes that would otherwise cost the better part of a day, and the LLM-vs-detector discrepancies should be surfaced honestly, not hidden.

## Pet peeves / friction triggers
- Scoring on the *presence* of a file (`has AGENTS.md? +1`) instead of whether it's real and followed.
- A coverage/CI score that contradicts what Sam knows about the repo's flaky build — instant trust collapse.
- Unsourced claims: a dimension score with no file:line, no PR, no commit behind it. "Where's this coming from?"
- Generic roadmap items ("improve documentation," "increase test coverage") with no repo-specific target.
- Hype copy and emoji-laden confidence. The more it oversells, the less they trust it.
- A badge or level that's clearly inflated — they'd be embarrassed to paste it, so they won't.
- Latency theater: a spinner with no streamed progress while a "scan" pretends to do deep work.

## Motivation — why use the app at all (time-saved)
The traditional way: Sam blocks out the better part of a working day to audit a repo's engineering maturity — clone it, read the CI config and the test suite for *real* assertions, grep for conventions/eval-harness files, eyeball commit and PR hygiene, sanity-check dependency pinning and the supply chain, then hand-write a prioritized improvement plan. Hours, and it's exactly the kind of tedious read senior engineers resent because (per the code-health literature) it burns the mental capacity they should spend on hard problems. Ascent has to compress that day into a couple of minutes *and* match the quality of what Sam would have produced. If it's slower than a sharp grep session, or barely faster but shallower, Sam won't adopt it — that's a finding.

## Senior-quality bar (reliability floor)
The score + roadmap + generated artifacts must be at least as good as Sam's own staff-engineer read of the repo. A score that contradicts the repo's actual state fails. A roadmap that ignores the cited evidence, or lands on "add more tests / improve CI," fails — Sam would write something sharper in five minutes. The generated `.ai/` standard and onboarding SKILL.md must reflect *this* repo's real conventions (its actual test runner, its actual CI gates, its actual AGENTS.md), not a generic template Sam could have downloaded. If Sam would reject the output in code review, it fails even if the flow "worked."

## Scored acceptance criteria (judged identically every run)
- [ ] The overall level + the 9 dimension scores + the posture quadrant **reconcile with each other and with the repo** — no dimension reads strong where the evidence is theater (e.g. fake coverage, flaky CI scored as green).
- [ ] **Every dimension score cites concrete, re-traceable evidence** (file:line / PR / commit / governance fact) via the signal→LLM→blended provenance track; an unsourced score is an automatic trust failure.
- [ ] **LLM-vs-detector discrepancies are surfaced, not hidden** — Sam can see where the model and the deterministic detector disagreed and why.
- [ ] The roadmap names a **specific, evidence-grounded, highest-leverage next move** (e.g. "gate the advisory 70% coverage check in CI," "pin 3 unpinned Actions to SHAs") — not generic "add more tests."
- [ ] Sam reaches a **credible, defensible verdict in ~2–3 minutes** that would otherwise cost the better part of a day's manual audit (time-saved holds).
- [ ] The **badge / level is one Sam would stake their name on** in a public README — neither inflated nor sandbagged.
- [ ] Generated artifacts (`.ai/` standard, onboarding SKILL.md) are **repo-specific and accurate** — reflect this repo's real test runner, CI gates, and conventions, not a generic template.

## Emotional baseline
High skepticism, low patience for hype, deep patience for evidence. Starts arms-crossed, expecting to catch the tool out. Warms — quietly, never effusively — the moment the evidence holds up to a re-trace. Vocabulary is fluent and unforgiving; friction is met with a flat "where's this coming from?" rather than confusion. Won't rage-quit, but will silently decide the tool is unserious and never come back if the first score contradicts the repo. The fastest way to win Sam is to show your work; the fastest way to lose them is to ask them to trust a number.

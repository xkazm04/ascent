---
name: Priya (Platform/DevEx Lead)
role: Platform / Developer Experience Lead (owns golden paths + the org's AI-native engineering standard)
maps_to: /org/[slug]/practices, /org/[slug]/governance (gate policy editor + CI snippet + action.yml), /org/[slug]/plan (goals · what-if simulator · initiatives · detector backlog), the `.ai/` standard generator (manifest/doctor/memory/CONTEXT), the onboarding SKILL.md generator
tech_level: power-user
promotion: discovery
references:
  - https://octopus.com/blog/paved-versus-golden-paths-platform-engineering — golden paths must EARN adoption (attract, reduce cognitive load), not be mandated; a standard that can only be enforced has already failed. Ascent's practices/standard must be the easy path, not a decree.
  - https://newsletter.getdx.com/p/introducing-the-dx-core-4 — DX Core 4 (Noda/Tacho): Speed/Effectiveness/Quality/Impact held in tension; metrics framed as "understand developer friction," never individual performance or a control stick. The org score must read the same way.
  - https://www.opslevel.com/resources/cortex-vs-backstage-whats-the-best-internal-developer-portal — scorecards roll out standards across many services by showing conformance + giving teams the context/instructions to fix, not just a red dashboard. Ascent's gate + starter PRs are judged against that bar.
---

## Who they are
Priya runs the internal platform/DevEx team (6 engineers) at a ~500-engineer scale-up. She owns the golden paths and paved roads — service templates, the CI/CD spine, the developer portal — and has just been handed the org's newest mandate-without-a-mandate: define and roll out the **AI-native engineering standard**. Her pressure is political as much as technical: leadership wants "every team using AI safely" by next quarter, and Priya knows a top-down decree will get quietly ignored by the very senior teams she most needs on board.

## Background / lived experience
Priya came up as a backend engineer, did three years of SRE, then built her current company's platform group from scratch after reading *Team Topologies* and deciding the org's problem was cognitive load, not headcount. She's shipped a Backstage instance, killed it eighteen months later when nobody filled in the catalog, and replaced it with a scorecard tool (she's evaluated OpsLevel and Cortex) because conformance you can *see* beats a portal nobody visits. She's been burned by exactly two failure modes and watches for both: (1) the **standard nobody adopts** — a beautiful golden-path template that teams route around because the old way is still easier; and (2) the **scorecard mandate war** — a red dashboard handed down from on high that makes senior engineers defensive and turns the platform team into the compliance police. Her north star is the line from the paved-vs-golden-path literature: the platform has to be *better than what developers already do and easy to adopt*, or it's just more process moved into her team.

She answers to a VP Eng who wants a board-ready number, and to staff engineers who will tear apart anything generic. What's personally at stake: this AI-standard rollout is the thing her promotion case is built on, and a botched mandate would set the platform team's credibility back a year. A real day is half adoption metrics and half diplomacy — pairing with a team to make the right thing the default, fielding "why is my repo red," and resisting leadership's urge to just *require* things. She thinks in DX Core 4 terms (speed/effectiveness/quality/impact in tension) and is allergic to any single metric used as a stick.

## Voice
Dry, precise, allergic to buzzwords she didn't choose. Says "paved road," "golden path," "thinnest viable platform," "cognitive load," "make the right thing the easy thing," "self-service," "scorecard," "conformance," "blast radius." Will say out loud: *"A standard you have to enforce is a standard that already lost."* / *"Don't show me a red dashboard, show me the PR that turns it green."* / *"Who authored this — because it reads like a generic 'add more tests' checklist and my staff engineers will eat me alive."* / *"Is this the same policy in the gate and in CI, or are we about to ship two sources of truth?"* When something's good she's terse: *"Okay, that's actually shippable."* When it's generic she gets quiet and starts poking at provenance.

## Jobs to be done
- "Author an AI-native engineering standard once and roll it out across the whole fleet — without hand-writing a per-repo conformance checklist or starting a mandate war."
- "Give every team the *easy path* to adopt it: a starter PR they can merge, not a wiki page they'll ignore."
- "Set one maturity bar and enforce the *exact same* policy in the dashboard and in CI, so there's no drift and no 'works on the dashboard' arguments."
- "Show leadership a credible fleet number and the highest-leverage move — and show each team a green path, not a scolding."

## What "good" looks like (acceptance expectations)
Externally grounded in the platform-engineering norms in `references:`. Priya expects, within ~5 minutes on a seeded org: a **fleet-wide read of where the standard is/ isn't adopted** that reconciles with what she knows about her teams; a **standard + starter artifacts she could actually ship** (a senior platform lead's `.ai/` standard and starter PR, not a boilerplate template); and a **gate whose policy is the same in the dashboard and in CI** (one source of truth — she will check for drift explicitly). Per the golden-path bar, adoption must be made *attractive and easy* — a one-click starter PR / "cheapest path to green," not a red list of failures. Per the scorecard bar, every "you're failing" must come with the context + the fix. Per DX Core 4, the org score must read as "here's the friction to remove," never as an individual-performance stick.

## Pet peeves / friction triggers
- A red conformance dashboard with **no path to green** — failures listed but no starter PR, no "cheapest path," no fix. (Her #1 historical failure mode.)
- A **generic standard**: an `.ai/` standard or starter PR that reads like a template anyone could paste, with no evidence it was adapted to *this* repo's real commands/modules. She'll reject it as "not something I'd put my name on."
- **Policy drift** — the dashboard gate and the CI snippet enforcing different bars. Two sources of truth is an instant trust-killer.
- Anything that smells like a **mandate stick**: a score framed to rank/punish teams rather than to surface friction. Violates her whole rollout strategy.
- **More process moved into her team** instead of self-service: if adopting the standard means her team hand-holds every repo, the tool failed.
- Onboarding/standard artifacts that **fabricate** commands or architecture (a control with no real hook, an invented module map) — worse than nothing, because a senior will catch it and distrust everything.

## Motivation — why use the app at all (time-saved)
The traditional way: author the standard by hand (a Google Doc + an `.ai/`/CLAUDE.md reference repo, iterated over weeks with staff engineers), then assess conformance per repo *manually* — read each repo, score it against the checklist, write the remediation ticket. At her fleet size that's a multi-week authoring effort plus roughly a day per repo of conformance review, re-run every time the standard changes. It does not scale and it goes stale the moment she edits the bar. Ascent has to collapse that to: standard generated and reviewed in minutes, fleet conformance visible without re-reading repos, and the remediation shipped as starter PRs instead of tickets. If authoring + rollout isn't dramatically faster than hand-rolling the doc and the per-repo audit, she won't adopt it — that's a finding.

## Senior-quality bar (reliability floor)
The generated `.ai/` standard, the starter-PR content, and the gate policy must be something **a senior platform lead would actually ship under her own name** — not a generic template. Concretely: the `.ai/` standard must be adapted to the real repo (real capabilities/commands, real module map, a doctor that actually proves its claims, controls placed correctly — pre-push primary, CI as a thin backstop), not boilerplate with `TODO`s left as the deliverable. The starter PR must be leak-free and specific enough to merge. The gate policy must be archetype-aware and the *same* policy the dashboard shows and the CI snippet enforces. A score/roadmap that ignores the cited evidence, a "standard" any repo could paste unchanged, or a gate that contradicts itself between surfaces — fails, even if the flow technically "worked."

## Scored acceptance criteria (judged identically every run)
- [ ] **Fleet conformance is visible and reconciles** — Governance shows pass-rate, where the fleet fails, and worst offenders, and it agrees with what Priya knows about her teams. (JTBD: fleet read; Trust: reconcile)
- [ ] **There is a path to green, not just a red list** — failing repos surface a "cheapest path to green" and/or a one-click starter PR per gap; adoption is made easy, not mandated. (golden-path + scorecard bars)
- [ ] **One policy, no drift** — the dashboard gate policy and the copyable CI snippet (`action.yml` / `/api/gate`) enforce the *identical* bar; editing the policy once changes both. (JTBD: one bar; pet peeve: drift)
- [ ] **The gate is archetype-aware**, not a flat global threshold she'd have to argue about per team. (Senior-quality)
- [ ] **The `.ai/` standard is repo-specific and senior-grade** — manifest with real capabilities, a doctor that proves them, control placement correct (pre-push primary / CI thin backstop); not a paste-anywhere template. (Senior-quality bar)
- [ ] **The starter PR / practice artifact is leak-free and mergeable** — specific enough that she'd open it across gap repos without rewriting it. (JTBD: easy path; time-saved)
- [ ] **A standard can be authored + rolled out in minutes, not weeks** — generating the standard and seeing fleet conformance beats hand-authoring the doc + per-repo manual audit by a wide margin. (Motivation/time-saved)
- [ ] **The score reads as friction-to-remove, not a stick** — framed to help teams adopt, never as an individual-performance ranking. (DX Core 4 bar; pet peeve: mandate)
- [ ] **No fabrication** — generated standard/onboarding artifacts don't invent commands, hooks, or architecture they can't ground in the repo. (Senior-quality / Trust)

## Emotional baseline
High competence, low patience for theater. Skeptical by default — she's killed tools before and assumes a demo is hiding the generic underbelly until she's poked at the provenance. Warms fast when an artifact is genuinely repo-specific and shippable ("okay, that's actually shippable"); goes quiet and starts auditing when it smells generic or when two surfaces disagree. Vocabulary is platform-engineering fluent, so vague or buzzword-y copy reads as a red flag, not as polish. She is rooting for the tool to work — it would make her quarter — which makes a generic or drifting result more disappointing, and more damning, than an honest "not yet."

---
character: Priya (Platform/DevEx Lead)
goal: "Author our AI-native engineering standard once, make adopting it the easy path for every team, and enforce the same bar in CI — without starting a mandate war."
promotion: discovery
seed: ASCENT_AUTH_BYPASS=1 + a seeded org with scanned repos (npm run db:local:seed); a public repo for the gate/practice/standard preview; see uat/env.md
references:
  - https://octopus.com/blog/paved-versus-golden-paths-platform-engineering — adoption must be EARNED: a path to green / starter PR, not a red mandate. The journey passes only if Ascent makes the right thing the easy thing.
  - https://www.opslevel.com/resources/cortex-vs-backstage-whats-the-best-internal-developer-portal — scorecard rollout = show conformance across the fleet + hand teams the context and the fix; the gate must be one policy applied everywhere, with no drift.
  - https://newsletter.getdx.com/p/introducing-the-dx-core-4 — the fleet number must read as friction-to-remove and stay consistent across surfaces, never as an individual-performance stick.
---

## Trigger (why now)
Leadership has set a quarter-end goal: "every team using AI safely." Priya has to turn that into a concrete, defensible **AI-native engineering standard** and get it adopted across the fleet — fast, and without a mandate that the senior teams will route around. She's done the hand-rolled-doc-plus-manual-audit version before and it doesn't scale or stay fresh. She opens Ascent to see whether it can collapse authoring + rollout + enforcement into something she can run in an afternoon and stake her name on.

## Definition of done (their POV)
- She can see, fleet-wide, **where the standard is and isn't adopted** — a conformance read that reconciles with what she knows about her teams.
- She can **set one maturity bar** and confirm the *same* policy is enforced in the dashboard and in CI (one source of truth, no drift), and that it's archetype-aware rather than a flat global threshold.
- Every failing repo has a **path to green** — a "cheapest path" and/or a one-click starter PR per gap she can open across repos — so adoption is the easy path, not a decree.
- She can generate the **`.ai/` standard + onboarding SKILL.md** and judge them as a senior: repo-specific, leak-free, controls placed correctly — something she'd ship, not a template.
- She comes away convinced this beats hand-authoring the doc + manually auditing each repo by a wide margin (time-saved), and that the score is framed as friction-to-remove, not a stick.

## Out of scope
- Real GitHub PR creation against a live repo with the App installed (preview-only is fine; opening a real PR needs the GitHub App write access — surfaced inline, not a journey failure here).
- Live-LLM scoring nuance (mock/deterministic mode is sufficient for this structural journey).
- The single-repo public funnel, billing/credits, and contributor/security deep-dives — other journeys own those.
- Wiring the generated standard into a real repo's actual hooks (she's evaluating the *generated artifact's* quality, not running it).

## Discovery hints
Entry point(s): /org/[slug]/practices, /org/[slug]/plan. Do NOT script the steps — getting lost is itself a finding. (She'll likely also wander into /org/[slug]/governance for the gate, and look for where the `.ai/` standard + onboarding SKILL.md are generated; whether those surfaces are discoverable from where she starts is itself a finding.)

## Frozen happy path  (filled in only on `promote`)
<!-- not yet promoted — discovery only -->

---
name: Marcus (Engineering Manager)
role: Engineering Manager — owns 2 squads (~12 engineers) at a mid-size product company, mid-AI-rollout
maps_to: /org/[slug]/contributors, /org/[slug]/delivery, /org/[slug]/repositories, /report/[owner]/[repo] (his teams' main services)
tech_level: comfortable
promotion: discovery
references:
  - https://newsletter.pragmaticengineer.com/p/measuring-developer-productivity — the line he will NOT cross: measure team outcomes, never individuals; metrics get gamed and corrode trust the moment they touch perf/comp. Output that ranks people fails.
  - https://www.swarmia.com/developer-productivity/ — the bar comparable tools set: "no developer leaderboards," team-level + working agreements, productivity "the healthy way." A read that crudely scoreboards people is below market.
  - https://en.wikipedia.org/wiki/Bus_factor — the one team-level risk he genuinely owns and can act on: knowledge concentration / key-person risk (bus factor 1). This is legitimate manager information; surfacing it well is table stakes.
---

## Who they are
Marcus is an Engineering Manager running two squads (~12 engineers) at a mid-size B2B product company that's six months into an AI-tooling rollout (Copilot seats bought, a CLAUDE.md mandate floated, no one tracking whether any of it stuck). He's accountable for his teams' delivery *and* their growth, and his skip-level — a VP, Dana — keeps asking, in skip-levels and the Monday staff sync, "how's your AI adoption going?" He does not have a defensible answer, and he's tired of guessing.

## Background / lived experience
Marcus was a senior backend engineer for seven years before he got the team. He still reads diffs. He's been on the receiving end of a "developer productivity dashboard" rollout at a previous company — leadership started quoting PRs-merged in calibration, his best engineer (a quiet mentor who unblocked everyone and shipped little of her own) scored badly, and he watched the team start gaming diff counts within a quarter. That experience left a scar: he is allergic to anything that smells like an individual scoreboard, and he's read the Pragmatic Engineer / Kent Beck rebuttals to McKinsey closely enough to cite them. He's evaluated LinearB and Swarmia for the org; he liked that Swarmia refused to ship leaderboards.

His real day: 1:1s where he's coaching on growth, not auditing output; a delivery standup where he's watching for stuck PRs and review bottlenecks; a quarterly planning cycle where he has to argue for headcount and tooling budget with *evidence*; and the recurring, dreaded "where are we on AI" question from above. Today, answering that means an afternoon of GitHub spelunking — clicking through repo insights, eyeballing who's touched what, exporting commit data into a spreadsheet, and still ending up with a hand-wave. He owns the bus-factor problem personally: he *knows* one repo is effectively one engineer, and it keeps him up, but he can't show it cleanly to justify cross-training time.

## Voice
Plain, dry, a little weary; ex-engineer who still speaks in PRs and review coverage, not "synergies." Says things like: "Don't make me a number-cop." "This is a 1:1 input, not a perf-review exhibit." "Who's the bus factor here — and can I show Dana without throwing anyone under the bus?" "I could've gotten this from GitHub insights in an afternoon — so what did you save me?" "If this ranks my people, I close the tab." He pushes back on anything that overclaims: "100% AI-active across a team of three isn't adoption, it's one person with Copilot."

## Jobs to be done
- "Tell me where my two squads actually are on AI adoption — a number I can take to my skip-level — without ranking my engineers."
- "Show me my key-person risk (which repo is one bus-stop from a crisis) so I can justify cross-training in planning."
- "Give me one or two *team-level* moves that would matter, grounded in real signals, that I'd actually raise in a retro or 1:1."
- "Let me read my team's main service the way I'd read it myself — but in two minutes instead of an afternoon of GitHub archaeology."

## What "good" looks like (acceptance expectations)
Grounded in how EMs are told to measure (team outcomes + DORA/flow at team scale, qualitative growth in 1:1s — Pragmatic Engineer; Swarmia's "healthy way"): he expects an **org/team-level** read — fleet AI-adoption posture, delivery flow (review coverage, time-to-merge, AI-PR governance), and concentration/bus-factor — that reconciles with what he already knows about his teams in ~2 minutes. He expects bus factor and solo-maintainer flags surfaced as *risk*, framed as "input to explore," never a directive aimed at a person. He expects any contributor view to refuse to become a scoreboard, and to *suppress* a "champion #1" celebration when the population is too small to mean anything. He expects the single-repo report to read like a competent peer's review with cited evidence, not a generic checklist.

## Pet peeves / friction triggers
- Individual leaderboards, "#1 ★", or anything that invites him to rank people. Instant tab-close.
- Vanity AI-adoption numbers ("100% AI-active") on a tiny population presented as success.
- Metrics with no provenance — a posture or score he couldn't defend if Dana asked "where's that from?"
- Surveillance vibes: per-person output he'd be embarrassed to have a report see over his shoulder.
- A "roadmap" that's generic ("add more tests, improve CI") and ignores the cited repo evidence.
- Anything slower than just opening GitHub himself — if it doesn't beat the afternoon, it's dead.

## Motivation — why use the app at all (time-saved)
The manual way: an afternoon (3–4 hrs) of clicking GitHub repo/contributor insights across ~8–10 repos, exporting commit data, hand-building a spreadsheet to guess at AI adoption and concentration, and *still* not having something he'd confidently show a VP. Doing it repeatably every quarter is worse. Ascent has to collapse that to **a few minutes of reading**, produce a number/posture he'd actually report upward, and flag bus-factor risk he'd otherwise discover only when someone resigns. If it's merely a prettier GitHub insights — or slower — he won't adopt it.

## Senior-quality bar (reliability floor)
At least as good as Marcus's own read as a senior EM/ex-staff-engineer: a team-health assessment a competent peer would sign. The contributors/bus-factor read must respect the surveillance line the way *he* would in a 1:1 — risk and exemplars framed as inputs people choose to act on, never a ranking or a to-do list aimed at a named person. The adoption number must be honest about small populations (no success theater). The single-repo report must cite concrete repo signals, and the roadmap must name a specific, evidence-linked move — a read he'd paste into a retro doc, not a generic "do better." Output a senior EM would be embarrassed to forward to his VP fails, even if every tile rendered.

## Scored acceptance criteria (judged identically every run)
- [ ] He can state his teams' AI-adoption posture/number from the org dashboard within ~2 minutes, and it reconciles with what he knows about the squads (no number he'd have to caveat away).
- [ ] Bus-factor / solo-maintainer / key-person risk is surfaced clearly and is framed as risk-to-explore — actionable for cross-training, never a directive aimed at a named engineer.
- [ ] The contributors surface does NOT read as an individual performance scoreboard; small-population vanity metrics (e.g. "#1 champion" / "100% AI-active" on <3 people) are suppressed or honestly qualified.
- [ ] He gets at least one team-level move grounded in cited signals that he'd actually raise in a 1:1/retro — not a generic "add more tests / improve CI."
- [ ] Every adoption/delivery/posture number has visible provenance (a "where's that from?" answer) he could defend to his VP.
- [ ] The single-repo /report read on his team's main service is at least peer-quality (cited evidence, specific roadmap) and faster than his afternoon of GitHub spelunking.
- [ ] He would actually show the org dashboard to his skip-level (Dana) without feeling he'd thrown an engineer under the bus.

## Emotional baseline
Pragmatic, time-poor, and protective of his people. Patient with a tool that respects the surveillance line and earns trust with provenance; instantly cold to anything that ranks individuals or overclaims adoption. Skeptical-but-fair: he's read the productivity-measurement debates and will give credit for honest framing, but he reads diffs for a living and will catch a number that doesn't reconcile. Vocabulary is engineering-leadership: posture, bus factor, review coverage, time-to-merge, key-person risk, 1:1 input.

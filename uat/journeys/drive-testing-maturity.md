---
character: Oliver (QA / Test Lead)
goal: "Give me an honest, evidence-backed read on this repo's testing maturity — not a coverage number — a specific plan of testing moves I'd actually endorse, and a trend line I can use to prove the number moved."
promotion: discovery
seed: a public repo for the scan + D2 evidence; ASCENT_AUTH_BYPASS=1 + seeded scans for /trends over time (npm run db:local:seed). See uat/env.md
references:
  - https://www.tmmi.org/tmmi-model/ — TMMi 5-level testing maturity ladder, assessed via interviews/document review/process observation. Sets the definition-of-done shape (a level + reason, not a checkbox) and the manual time-saved anchor.
  - https://about.codecov.io/blog/mutation-testing-how-to-ensure-code-coverage-isnt-a-vanity-metric/ — coverage is execution not validation; test *quality* (mutation/assertion density) is what matters. Sets the bar that the D2 read he leaves with must reflect quality, not a coverage %.
  - https://www.confident-ai.com/blog/llm-testing-in-2024-top-methods-and-strategies — AI-assisted tests scale volume but risk low-value tests with no harness/groundedness checks. Sets the bar that D8 must reward a real AI eval/test harness and the roadmap must guard against AI-inflated coverage.
---

## Trigger (why now)
His org turned on Copilot/Cursor fleet-wide a year ago and the number of tests roughly doubled — and coverage went *up*, which is exactly what's bothering him. His gut says a chunk of that new green is low-value AI-generated tests that assert nothing, and that under the rising number his real test quality may be flat or sinking. The VP just asked him to "raise testing maturity across the squads this half and show it improving." He needs (a) an objective read he didn't hand-build, (b) a credible plan of testing moves he can stand behind, and (c) a way to *prove the number moved* — and his usual day-per-repo manual audit won't scale to six squads or prove movement over time. He picks one repo to see if Ascent's D2/D8 read holds up to what he'd write himself.

## Definition of done (their POV)
- He leaves with a **D2 testing-maturity read he believes**: a level with a *reason*, grounded in cited repo evidence (test presence, CI, coverage gating, provenance he can drill into) — and it reflects **quality, not just a coverage number or a tests/ folder**.
- He's checked **D8 AI Process & Harness** and can tell whether the team has a real **AI eval/test harness** or is just shipping AI output ungated.
- He has a **prioritized roadmap of specific testing moves** he'd endorse as a senior QA lead, and he's moved at least one recommendation **open→in-progress→done** in the tracker.
- He's confirmed **/trends shows the D2 (and ideally D8) score over time**, so he can prove an initiative moved the number — and he's seen the **CI maturity gate** can actually fail a merge below a policy.
- Net: he'd roll this out across his squads instead of his spreadsheet, and would stake the read + roadmap on it as-is.

## Out of scope
- Org-wide fleet rollup / board-grade trajectory across all repos (that's the VP/Dana journey — Oliver is the per-repo testing-depth read, one repo at a time).
- Buying credits, billing, or seat management (he only touches those incidentally, not to transact).
- Authoring the team's actual test code or wiring real CI — he's assessing maturity and planning moves, not implementing them in this session.
- The non-testing dimensions (security, supply-chain, docs) except as context — his lens is D2 and D8.

## Discovery hints
Entry point(s): / (scan) → /report/[owner]/[repo] (D2 Automated Testing), /trends. Do NOT script the steps — getting lost is itself a finding.

He may scan a public repo from `/`, land on the report, and hunt for the testing dimension; he'll also look for **D8 AI Process & Harness**, the **roadmap + recommendation tracker**, **/trends**, and the **PR CI gate**. Watch especially whether he can (a) reach the D2 read and understand the **level and its reason** without a coverage number standing in for maturity, (b) **drill to the cited evidence** behind the level (signal→LLM→blended provenance) so he'd defend it, (c) tell whether the read reflects **test quality vs. mere volume / AI-inflated coverage**, (d) find a **specific, prioritized roadmap** of testing moves (not "add more tests") and move one through the tracker, and (e) confirm **/trends** can actually show the D2 score moving over time and that the **gate** can fail a merge below policy. If any of these collapses into a vanity number or a generic recommendation, that's the finding.

## Frozen happy path  (filled in only on `promote`)

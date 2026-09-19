---
note_type: engine-expected
call_site: mentor
use_case: UC3
implied_by: docs/GOLDEN-USE-CASES.md - UC3 design, "The skill - /mentor" + sequencing step 4 "Tiger certifies the mentor's LLM surface"
status: expected
tags: [engine, expected, uc3, privacy]
---

# Expected call site - `mentor` (UC3 individual care)

The `/mentor` skill's reflection lane (`intake` / `retro` / `weekly` / `moves`) - an LLM piece
that runs on the developer's machine (the public distributable, `npx ascent mentor init`), not
in the SaaS. Not built yet; the bar is written here first.

## The job it will serve
reflect on real usage -> interview -> personal profile -> moves -> re-measure. The output is
advice to ONE developer about how they work with LLM tools, ranked by estimated time saved for
them. The senior bar is "a good staff-engineer mentor", not generic hygiene.

## Grounding bar (what must reach the prompt on day one)
Canonical source list - score `grounding N/5`:
1. the developer's **own journal** (`journal.jsonl`: counts and shapes only - sessions/week,
   turns/session, tool mix, plan-mode ratio, permission denials, re-prompt loops, tests before
   commit, skill invokes) - the memory-grounding question: does `weekly` carry "what moved since
   last week"?
2. the developer's **profile.md** (self-stated goals, boundaries, archetype hint they confirmed)
   - the interview contract; advice that ignores a stated boundary fails
3. the **repo's gaps** via the SaaS MCP door (`get_repo_standing`,
   `list_open_recommendations`) when a token exists - UC1 grounds UC3
4. the **registry catalog** (`catalog.json`: which skills exist, fleet invokes / outcomes) -
   UC2 grounds UC3; offline -> catalog only, say so
5. the developer's **prior moves** and their `kept | dropped (reason)` - nothing is re-asked
   (the passport's decline memory at the individual scale)

OUT direction: every move carries `why (evidence from your journal)`, `expected saving`,
`try for: N sessions`; `share` pushes aggregates only.

## Hard check - UC3 privacy (Lens A, never waived)
- no transcript CONTENT in the prompt, in any log, in any eval capture, in any telemetry - only
  counts and shapes; assert it in the prompt builder and in the capture path
- nothing leaves the machine the developer did not choose: `share` is explicit; hook events
  carry no prompt content; per-person attribution off by default
- an eval log for this call site, if any, lives under `<repo>/.ascent/mentor/` (gitignored) -
  never in a shared sink
A violation is a `use_case: UC3`, `type: trust` finding at the top of the backlog regardless of
output quality.

## Machinery bar (Lens A dials it must clear on day one)
- provider abstraction that works without an account (local CLI engine) and degrades to
  "no model - here are your raw counts" loudly, never to invented advice
- structured output for `moves` (`{ move, why, evidence[], expectedSaving, tryFor }`) with a
  never-throw validator and a quality gate (a move without journal evidence is dropped)
- bounds on journal excerpts sent (shapes, not content) and on move count
- latency budget: a `retro` runs on a Stop hook - it must be cheap and fast (seconds, not the
  30-130 s of the scan assessor); this shapes Lens C

## Lens C starting hypothesis
Short, structured, extraction-like outputs over small inputs -> a cheap model is likely the floor
for `retro` / `weekly`; `intake` (interview synthesis into `profile.md`) and `moves` are the
reasoning-heavy sub-tasks - benchmark those, not the counts. Judge for "generic hygiene vs
mentor-grade" blind.

## Judges
Priyanka (must-pass), Sam-as-IC, Elena; Nadia enforces the privacy hard check. Fixture: a
synthetic 30-day journal with a planted pattern (same error re-prompted >= 3x; tests never run
before commit) the moves must catch, plus one stated boundary the advice must respect.

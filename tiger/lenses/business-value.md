---
note_type: lens
lens: business-value
level: L1 (designed output) → L2 (live output)
inherits: ../../uat/rubric.md
tags: [lens-b, character-driven]
---

# Lens B — Business Value (UAT method, scoped to the LLM output only)

Inherits the **seven acceptance dimensions** from [`uat/rubric.md`](../../uat/rubric.md) (completion · effort · clarity · trust · missing · time-saved · senior-quality) and the cognitive-walkthrough + JTBD method — but the **surface-binding is narrowed to the part of the experience the model generates**: the maturity score nuance, the per-dimension summaries/strengths/gaps, the headline, the roadmap, and the discrepancies. Don't judge the chrome around it — judge what the model *produced*.

## The two questions that matter most here
1. **Grounding (`N/M`)** — of the Character's real context the output *should* use, how much actually reaches the prompt? For [[scan-assess]] the answer is high (5/5 sources) but **depth-capped** (22KB file window) and **memory-less** (no "since last scan"). A Character who knows their repo cold ([[sam-staff-engineer]]) will test whether the output reflects evidence beyond the 10 excerpts it could see.
2. **Senior-quality** — is the output at least as good as this Character would produce as a senior in their role? A generic roadmap ("add more tests"), an ungrounded score, or a discrepancy pass that misses an obvious detector error **fails** even if the JSON validated.

## Run scope
- **L1 (this sweep):** judge the *designed* prompt+grounding (`src/lib/scoring/prompt.ts`) — would this plausibly produce a senior-grade, defensible output for THIS Character? Cite `file:line`.
- **L2 (later):** run the real model, assert the live output *uses* the grounding and clears the bar (real quality, latency, determinism on a re-run — the [[mariam-fintech-audit]] "same repo twice" test).

## Verdict
Findings carry `lens: business-value`, a required `character`, and `dimension ∈ {trust, senior-quality, time-saved, clarity, missing, completion, effort}`. Each Character also writes a first-person **felt verdict** (would I trust this number? would I paste this badge? is the roadmap one I'd run?). Across Characters the voices form the **value panel**.

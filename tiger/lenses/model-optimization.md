---
note_type: lens
lens: model-optimization
level: L1 (predicted frontier) → L2 (live benchmark = `benchmark` mode)
tags: [lens-c, cost, model-fit]
---

# Lens C — Model Optimization (the alternative-scenario lens)

Treats **model × thinking-level** as a variable for each LLM piece and answers one question:

> *What is the cheapest model/thinking config that still clears every must-pass Character's senior-quality bar — and does a premium config meaningfully upgrade business value, or just cost more?*

## The key lever for THIS app (read before judging)
The [[scan-assess]] model is **guardbanded**: it's told to calibrate scores to the deterministic signalScore, and the engine clamps the LLM ±25 and blends 60/40. So:
- **Scoring** is nearly model-insensitive (a cheap model can't move the number much even if it wanted to) → likely **over-provisioned** on the cheap↔mid axis *for scoring*.
- **Roadmap quality** + **discrepancy audit** (real reasoning over file excerpts) are **unbounded** and model-sensitive → they set the quality **floor**.
- **Thinking-budget** helps only the discrepancy audit; it's waste on scoring/summarizing. No thinking knob is exposed today (`src/lib/llm/config.ts` has temperature/maxTokens only) — recommending a scoped one is a valid Lens-C output.

## Method
- **L1 (theoretical):** from task shape + the quality bar + the [[models]] price table, predict the quality↔cost frontier and place the current default on it (over- / right- / under-provisioned). Emit the **benchmark matrix**.
- **L2 (`benchmark`):** hold input fixed, run each matrix row live, score with 2-3 Character judges (multi-sample → majority) → `quality_delta` vs the default + `cost_delta` ($/call and projected $/month at real volume). Recommend the **floor** (cheapest holding every must-pass bar) and the **ceiling** (most a premium row buys).

## Verdict
Findings carry `lens: model-optimization`, a `character` (whose bar moved), `model_variant`, `quality_delta`, `cost_delta`, `dimension ∈ {cost, senior-quality, trust}`. The per-piece recommendation updates [[scan-assess]] `default_model` + the [[backlog]]. **Never fabricate a benchmark number** — env-blocked → predicted frontier, labelled (see [[models]] caveat).

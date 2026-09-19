---
note_type: model-matrix
price_snapshot: 2026-06-12 (from src/lib/llm/config.ts MODEL_PRICES — USD per million tokens)
tags: [lens-c, benchmark, cost]
---

# Model × thinking-level matrix — the Lens-C benchmark plan

The variable Lens C optimizes for the [[scan-assess]] call site. Hold the **input fixed** (same repo + grounding) across every row; the only thing that changes is model × thinking. Score each output with the Character panel ([[_roster]]) and price it against the table below.

## Price basis (dated snapshot — `src/lib/llm/config.ts:39-55`)
| Tier | Model | $ in / MTok | $ out / MTok | Notes |
|---|---|---|---|---|
| cheap | `gpt-4o-mini` | 0.15 | 0.60 | OpenAI cheap baseline |
| cheap | `gemini-3-flash` | 0.50 | 3.00 | **current MVP/public default** |
| cheap | `haiku` (4.x) | 1.00 | 5.00 | Claude cheap |
| mid | `gpt-4o` | 2.50 | 10.00 | |
| mid | `sonnet` (4.x) | 3.00 | 15.00 | **current dev + enterprise default** |
| premium | `opus` (4.x) | 5.00 | 25.00 | |

> Estimates only (list prices; negotiated `LLM_*_COST_PER_MTOK` envs override). The scan prompt is **input-heavy** (rubric + schema + ~22KB excerpts ≈ several K input tokens; output is one bounded JSON object), so **input price dominates** — which is exactly why prompt-caching ([[scan-assess#T-A1]]) and a cheaper model matter most on the input axis.

## Benchmark matrix (rows to run in `benchmark` mode)
| # | Model | Thinking | Hypothesis (predicted, pre-benchmark) |
|---|---|---|---|
| 1 | `gpt-4o-mini` | none | cheapest possible; score holds in guardband, roadmap generic → fails skeptics |
| 2 | `gemini-3-flash` | none | current MVP floor; is the public-tier output already senior-grade? |
| 3 | `haiku` | none | cheap Claude; summaries fine, discrepancy-audit weak |
| 4 | `sonnet` | none | **the default** — the comparison baseline |
| 5 | `sonnet` | low | does a little thinking sharpen the discrepancy audit for ~same cost? |
| 6 | `opus` | none | premium scoring/roadmap; worth 1.7× sonnet? |
| 7 | `opus` | high | ceiling — best discrepancy-catching on a complex repo; the upper bound of value |

## ✅ Benchmarked 2026-06-20 (Claude spine — real outputs, blind-judged) → [[2026-06-20-tiger-benchmark]]
| Model | Thinking | Cleared must-pass bar? | Result |
|---|---|---|---|
| `haiku` | none | ❌ FAIL/FAIL | busts the ±25 guardband on the planted dim (D2=75→clamped 47); thinnest discrepancy; weak roadmap |
| `sonnet` | none | ✅ floor (Mariam PASS; Sam borderline) | cheapest tier that clears; one prompt-fixable roadmap-title slip |
| `opus` | none | ✅ PASS/PASS | ceiling — 2 discrepancies + sharpest roadmap; +1.7× cost for incremental gain |
| `gpt-4o-mini` · `gemini-3-flash` · `gpt-4o` | — | **not run** (no keys) | predicted ≈ haiku (cheap-tier degradation on roadmap/discrepancy); run live before trusting the public tier |
| `sonnet`/`opus` + thinking | low/high | **not run** (harness can't vary thinking) | predicted to help only opus's discrepancy audit on complex repos |

**Headline:** sonnet is the empirically-confirmed default floor; haiku degrades on the un-guardbanded sub-tasks (the guardband protects the *number*, not the *roadmap/audit*); opus is a premium toggle, not a default. Per-scan list-price cost: haiku ~$0.011 · sonnet ~$0.032 · opus ~$0.054.

## How to read the result
- **Floor** = the cheapest row where **every must-pass Character** ([[sam-staff-engineer]], [[mariam-fintech-audit]], [[tomas-prospective-buyer]]) still clears their senior-quality bar. That's the cost-optimal default.
- **Ceiling** = the most a premium row improves the Character panel's value score, expressed as `quality_delta` vs row 4, against its `cost_delta`. If the delta doesn't move a must-pass verdict, the premium is waste.
- **Per-piece recommendation** goes back into [[scan-assess]] frontmatter `default_model` and the [[backlog]].

## Caveat (honesty rule)
Live benchmarking needs working provider keys + the ability to make real model calls. In this sandboxed/local-dev env the only live engine is `claude-cli` (shells out to a local `claude` binary; slow, 30-130s/call). Where the matrix can't be run live, emit the **predicted** frontier above, clearly labelled — never fabricate benchmark numbers. The live sweep is a deliberate, billed, follow-up pass (like a UAT L2).

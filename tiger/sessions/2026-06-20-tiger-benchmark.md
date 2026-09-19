---
note_type: session
session: 2026-06-20-tiger-benchmark
mode: benchmark (Lens C — empirical, LIVE model calls)
call_site: scan-assess
axis: model tier (Claude price spine — haiku · sonnet · opus). Thinking-level + gemini/openai tiers NOT run (see caveats).
engine: REAL — three subagents pinned to haiku/sonnet/opus produced actual assessments on a fixed input; two must-pass Characters blind-scored them.
verdict: sonnet is the floor (confirmed); haiku fails the un-guardbanded sub-tasks; opus is the premium ceiling
tags: [session, lens-c, benchmark, model-fit, empirical]
---

# Session 2026-06-20 · Tiger `benchmark` · model-tier frontier for [[scan-assess]]

First **empirical** Lens-C pass — real model outputs, not a predicted frontier. Method:
1. **Fixed input** — the app's *actual* production prompt (`buildAssessmentPrompt`) for a hand-built, realistic fixture (a mid-maturity TypeScript payment service) with a **planted detector miss**: D2 signal says "no tests, signalScore 22" while `tests/checkout.test.ts` (real Vitest assertions), `"test":"vitest run"`, and a `test(checkout)` commit are all in the evidence. The plant stress-tests the two model-sensitive sub-tasks (discrepancy audit + roadmap accuracy). Input: `input/system.txt` (8360 chars ≈ stable/cacheable) + `input/user.txt` (4463 chars ≈ per-repo). Fixture: `input/fixture.json`.
2. **Three engines** — subagents pinned to `haiku`, `sonnet`, `opus`, each given the identical system+user and told to act as the Ascent engine and return only the JSON assessment. Raw outputs: `out/{haiku,sonnet,opus}.json`.
3. **Blind panel** — outputs anonymized A/B/C (A=sonnet, B=haiku, C=opus; mapping withheld from judges). Two must-pass skeptics — [[sam-staff-engineer]] (roadmap/grounding) and [[mariam-fintech-audit]] (calibration/defensibility) — scored them blind.

## Result — both judges, independently: **opus > sonnet > haiku**

| Tier (de-anon) | ~$/scan¹ | D2 raw (band [0,47]) | Discrepancies | Sam | Mariam | Read |
|---|---|---|---|---|---|---|
| **haiku** (B) | **$0.011** | **75 — BUSTS band by 28** (clamps to 47) | 1 (thin: file+pkg, no commit) | ❌ FAIL | ❌ FAIL | degrades exactly on the un-guardbanded parts; "solid test discipline" headline unsupportable |
| **sonnet** (A) | **$0.032** | 38 ✓ | 1 (regulator-grade: file+pkg+commit+devDeps) | ⚠️ FAIL² | ✅ PASS | **the floor** — clears the audit bar; one self-contradicting roadmap *title* |
| **opus** (C) | **$0.054** | 41 ✓ (+ shows calibration math in prose) | **2** (D2 miss **+** self-caught "CI never runs the suite") | ✅ PASS | ✅ PASS | **the ceiling** — sharpest, most self-auditing |

¹ ~3.2K input + ~1.5K output tokens at [[models]] list prices; before prompt-cache (P0-1), which trims the input ~16-18% on re-scans (the input is ~65% of tokens, but output dominates $).
² Sam's only objection to sonnet: the top D2 roadmap **title** says "Tests run in CI but don't gate" while its own rationale correctly says "ci.yml does not invoke pnpm test" — a wording slip, not a number slip. A one-line prompt nudge clears it.

## What this confirms — and *sharpens* — about the engine

**The L1 prediction was "cheaper-holds the score, sonnet floors roadmap+discrepancies." The benchmark refines it:**

1. **The guardband protects the NUMBER, not the OUTPUT.** Haiku's D2=75 overshoot is *clamped to 47* by `engine.ts`, so the user-facing score is safe — but the **un-guardbanded** parts (roadmap accuracy, discrepancy depth, summary quality) are where haiku visibly degrades, and both skeptics caught it blind. So "cheaper-holds the score" is *true and irrelevant*: the score was never the value. The value is the roadmap + audit, and those need ≥ sonnet.
2. **sonnet is the right default — empirically.** It's the cheapest tier that clears the audit bar (Mariam PASS; Sam's sole objection is one prompt-fixable wording slip). Haiku does not clear it. This **confirms the current `default_model` choice** rather than cutting it.
3. **opus is a premium lever, not a default.** +$0.022/scan (~1.7×) buys a 2nd discrepancy + a sharper roadmap — real but incremental. Reserve for high-stakes repos (enterprise audit, M&A DD — [[mariam-fintech-audit]], a Helena-type) where catching the *second* detector miss is worth it.
4. **The "two-model split" (P2-6b) saves less than L1 hoped.** Because **output tokens dominate the bill** (the JSON assessment), not input, splitting "cheap model for scoring / strong model for roadmap" saves little — and haiku's *summaries* were also weak, not just its roadmap. Verdict: **single-model sonnet beats a split** here; the split's complexity isn't worth its marginal saving. (This is a correction to the L1 prediction.)

## Recommendation (→ [[scan-assess]] `default_model`, [[backlog]] P2)
- **Keep `sonnet` as the default** (dev + enterprise) — floor confirmed. **Do not downgrade to haiku** for the scoring task: the score is clamp-protected but the roadmap/discrepancy audit drops below the senior bar.
- **Cheap prompt win:** add one line to the roadmap instruction — *"the title must state the gap accurately and agree with its own rationale"* — which would have cleared sonnet's only Sam-FAIL. Cheaper than any model change. (New backlog item P2-8.)
- **Offer `opus` as a premium/enterprise toggle** for high-stakes audits (the 2nd-discrepancy catch), not the default.
- **Public/MVP tier (`gemini-3-flash`) NOT benchmarked here** (no key) — predicted to behave like haiku (cheap-tier degradation on the un-guardbanded parts), so [[tomas-prospective-buyer]]'s "the buyer judges the product on the cheap public scan" risk stands. **Run a live gemini-flash vs sonnet pass before trusting the public tier.**

## Caveats (honesty)
- **Tiers covered:** the Claude price spine only (haiku/sonnet/opus). `gemini-3-flash`, `gpt-4o-mini`, `gpt-4o` need provider keys not present in this env — left as **predicted**, labelled, in [[models]].
- **Thinking-level axis NOT run** — the harness (subagents) couldn't vary thinking budget. Predicted: thinking helps only opus's discrepancy audit on complex repos. Future: re-run via the real providers with a thinking knob (the knob itself is backlog P2-6c).
- **Engine = subagents, not raw provider API.** A pinned subagent is a faithful proxy for its model tier's *reasoning quality* on this task (the relative ranking is sound), but absolute latency/token counts would differ from a direct API call. The **quality ranking** is the robust output; the **costs** are list-price estimates.
- **n=1 fixture.** One repo, one planted discrepancy. The ranking is sharp and both judges agreed blind, but a production decision should re-run across 3-5 fixtures (web / ML / large monorepo). Captured as P2 follow-up.

Raw artifacts: `out/*.json` (the three real assessments), `blind/candidate-{A,B,C}.json`, `input/*`.

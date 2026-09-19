# LLM model matrix: which model for the repo-maturity assess op (judged, 10 repos × 6 models)

**What ran:** Ascent has exactly one LLM call site, `assess()`, the repo-maturity assessment. This bench
ranks candidate models on that one op three ways at once: judged output **quality**, **calibration**
against the labeled benchmark (does the model's assessment blend to the right maturity level), and
**reliability** (did it return a usable assessment at all), plus speed.

**Method: capture & replay.** The model-independent input (`scoreInput` + repo `snapshot`) is captured
once per labeled repo through the real scan pipeline (`scripts/matrix/capture.mts`, forcing the mock
provider so no LLM key is needed, only GitHub). Then `scripts/matrix/run.mts` **replays** `assess()`
across every model on IDENTICAL inputs (no re-fetch), blends each result through the real engine
(`assembleReport`) to a maturity level, and scores the assessment 1–10 with an LLM judge
(`anthropic/claude-sonnet-5`). Every model runs through **OpenRouter** (one key, apples-to-apples).
Corpus: 10 labeled repos from `bench/repos.json` (a level-balanced spread, L1–L4).

## Leaderboard (overall = 60% judged quality + 40% calibration, scaled by reliability)

| model | overall | quality | within-1 | reliability | p50 latency | out tok |
|---|--:|--:|--:|--:|--:|--:|
| **google/gemini-3.5-flash** | **7.9** | 6.9 | 100% | 100% | 15s | 2552 |
| openai/gpt-5.4-mini | 7.8 | 6.7 | 100% | 100% | 23s | 2848 |
| openai/gpt-4o-mini | 6.7 | 4.9 | 100% | 100% | 22s | 1544 |
| deepseek/deepseek-v4-flash | 2.9 | 6.5 | 100% | **40%** | 45s | 4008 |
| z-ai/glm-5.2 | 2.5 | 7.0 | 100% | **30%** | 77s | 3715 |
| anthropic/claude-sonnet-5 | 0.0 | — | — | **0%** | 45s | 4096 |

Quality is the judge's 1–10 over the repos where the model produced a **usable** assessment; calibration
and quality both count usable outputs only (an unusable assessment still blends to a level via the
deterministic-signal fallback, which would otherwise credit the model for the baseline it didn't produce).

## Headline reads

1. **gemini-3.5-flash is the pick.** Top overall: high judged quality (6.9), 100% reliable, and the
   fastest in the panel (15s). `gpt-5.4-mini` is a close second (quality 6.7, 100% reliable, a bit slower).
   Both are safe defaults for the assess op.

2. **Reliability is the real differentiator, not calibration.** Every model that returns a usable
   assessment lands **within one level 100% of the time** (calibration is dominated by Ascent's strong
   deterministic signals, which the LLM only nuances). So the axis that separates models is whether they
   reliably produce the assessment *shape* at all.

3. **glm-5.2 and deepseek are good when they work, but flaky here.** glm has the highest raw quality
   (7.0) but only **3/10** usable (4 hard errors); deepseek **4/10**. Their overall sinks accordingly.
   Not safe to route production scans to on this evidence.

4. **claude-sonnet-5 is unusable through this path (0/10).** Every attempt returned valid JSON that
   wasn't the assessment shape (7 zero-dimension replies + 3 hard errors); see below. Note the judge is
   also claude-sonnet-5, but as a *contestant* it scored nothing, so there is no self-preference concern
   in the ranking.

## The `json_object` shape finding

> **Superseded for future runs (not yet re-baked).** Both adapters now request a STRICT
> `response_format: { type: "json_schema", … }` derived from `ASSESSMENT_JSON_SCHEMA`, falling back to
> `json_object` only when a target/upstream rejects the format. The numbers below were measured on the
> old json_object-only path and are expected to change (upward for glm/deepseek/sonnet) on the next
> bench run. Until then, read the reliability column as path-specific, not as a model verdict.

At the time of this run, the OpenRouter (and OpenAI-compatible) adapter decoded with
`response_format: { type: "json_object" }`, which guarantees **valid JSON but not the assessment SHAPE**, unlike Gemini's `responseJsonSchema` or
Bedrock's forced tool schema, which constrain the structure up front. On this multi-field assessment
schema (9 scored dimensions + headline + roadmap + discrepancies):

- **gpt-4o-mini / gpt-5.4-mini / gemini-3.5-flash** follow the schema from the prompt reliably (10/10).
- **glm-5.2 / deepseek-v4-flash** often return valid-but-wrong JSON (a summary object, or `{}`), which
  `validateAssessment` coerces to zero dimensions → `isAssessmentUsable` = false.
- **claude-sonnet-5** never produced the shape via `json_object` (0/10).

This is an adapter-compatibility signal, not only a model-quality one: a schema-constrained decode path
for OpenRouter (where the model supports it) would likely lift glm/deepseek/sonnet reliability. Until
then, prefer a model proven reliable on this path (the three above).

## Where this shows up (org settings)

The baked leaderboard is surfaced to operators in **org → Settings** (`ModelScorecard.tsx`) so a BYOM
org picks a model on evidence. Both connect-your-model cards write the org's single active provider:

- **Bring your own model (Bedrock)**: in-boundary inference in the org's AWS account (the privacy path).
- **Bring your own model (OpenRouter)**: the org's OpenRouter key, any model behind it (a
  cost/flexibility path; routes to third-party upstreams, *not* in-boundary). New in this change.

Pipeline: `run.mts` → `bake.mts` → `src/lib/llm/matrix-scores.data.ts` (generated, **do not hand-edit**)
→ pure helpers in `src/lib/llm/matrix-scores.ts` → the scorecard.

```bash
# 1. capture fixtures (once; GitHub only, no LLM key):
ASCENT_MATRIX_CAPTURE_DIR=bench/matrix-inputs npx vite-node --config vitest.config.js scripts/matrix/capture.mts
# 2. run the judged matrix (spends OpenRouter tokens):
OPENROUTER_API_KEY=… npx vite-node --config vitest.config.js scripts/matrix/run.mts
# 3. bake into the UI data (commit the result):
npx vite-node --config vitest.config.js scripts/matrix/bake.mts
```

## Caveats (don't over-read this)

- **n = 10 repos, one op.** Directional, not a leaderboard to the decimal. Calibration barely separates
  models because the deterministic signals dominate the blended level.
- **Judge = one model (claude-sonnet-5).** A single judge engine; a second judge from a different family
  would strengthen it. (No self-preference risk here: sonnet-5 scored nothing as a contestant.)
- **No cost axis.** OpenRouter list prices for these slugs aren't booked; output tokens + latency are the
  cost/speed proxy (glm/deepseek/sonnet are the token-heaviest and slowest).
- **Reliability is path-specific.** The low glm/deepseek/sonnet reliability is against the `json_object`
  decode path, not an absolute model verdict; a schema-constrained decode could change it.

_Generated 2026-07-07 from `bench/matrix/records.json`. 10 repos × 6 models, judge claude-sonnet-5,
quality + calibration + reliability from real (usable) LLM output._

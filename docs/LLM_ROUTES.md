# LLM routes — what the LightTrack gateway runs for Ascent, and why

Ascent's LLM calls can run through `lt-gateway` (LightTrack's local OpenAI-compatible endpoint in
front of the seat-metered CLIs: Claude via `claude -p`, GPT via `codex exec`). The gateway owns the
route, the usage-limit failover between seats, and the per-attempt telemetry; the app keeps its
prompt, its schema, and its parsing. Routes live in [`gateway.toml`](../gateway.toml); this file is
the evidence behind each line. Enable with `LLM_PROVIDER=gateway` (see `.env.example`).

| Use case | Primary | Fallback | Hard-tier mean (primary / fallback) | Benchmark / runs | Date |
|---|---|---|---|---|---|
| `assess` (repo-maturity assessment, `LLMProvider.assess`) | `codex/gpt-5.5@low` | `anthropic/sonnet@low` **(caveat below)** | 0.987 / 0.743 | `044161af-97ee-489d-9a46-98b5421fd7f6` — runs `b18e1052` (primary), `08657165` (fallback) | 2026-09-15 |

## `assess`

**Corpus.** Dataset `d172e1fa-3bb7-44da-848c-84f39f7b6b33` (frozen; `assess-bench-folded`), 21
cases from the `bench/matrix-inputs/` captures of 10 public repos, graded by input: **easy** (7) =
small repos with clear labels (awesome, coding-interview-university, slugify, express) and their
signals-only variants; **medium** (7) = large-monorepo captures (ruff, react, deno, astro,
claude-code), an injected signal-vs-file conflict on express, react signals-only; **hard** (7) = the
next.js capture (largest), five injected conflicts on the largest captures (the strongest
deterministic signal zeroed against contradicting file excerpts, so the model must flag a
discrepancy), and next.js signals-only. `expected` carries the repo's `bench/repos.json` level and,
for conflicts, the dimension that must appear in `discrepancies`.

**Rubric** `c00a7357-395b-41a1-9efa-cd3e47d50005` (threshold 0.85): five `json_valid` checks on the
required paths of the assessment schema (`/headline`, `/dimensions`, `/roadmap`, `/discrepancies`,
`/claims`; the first two are gates), a `regex` that all nine dimension ids D1..D9 are scored
(weight 2), and one `llm` dimension, *calibration* (weight 3: scores within a band of the
signalScores, level consistent with the label, required discrepancy flagged, nothing invented).
Judge: `openrouter/google/gemini-2.5-flash` — a third family, so `self_preference` is `false` on
every row.

**Prompt shape.** Every target got the app's exact system prompt (`buildAssessmentPrompt`), folded
into the single user turn (`system + "\n\n---\n\n" + user`). That is the shape `GatewayProvider`
sends, because the Codex CLI takes a system message on its command line capped at 16,000 chars and
the assessment prefix is 22,456 — a separate system turn fails every Codex attempt before the
model runs (measured: benchmark `779caf3d` v1, both Codex rows 0/21 with that error).

### Scorecard (run 2026-09-15, `--jobs 3`, 21 cases per row)

| Target | easy (n=7) | medium (n=7) | hard (n=7) | mean | pass | errors | p50 / p95 latency | cost | JSON dims | calibration |
|---|---|---|---|---|---|---|---|---|---|---|
| `codex/gpt-5.5@low` | 1.000 | 1.000 | **0.987** | 0.996 | 21/21 | 0 | 83.7 s / 98.8 s | seat (unpriced) | 1.00 | 0.986 |
| `codex/gpt-5.5@medium` | 1.000 | 1.000 | 0.974 | 0.991 | 20/21 | 0 | 89.8 s / 101.1 s | seat (unpriced) | 1.00 | 0.971 |
| `anthropic/sonnet@low` | 0.714 | 0.786 | 0.743 | 0.748 | 11/21 | 0 | 73.0 s / 97.1 s | $3.65 (~$0.17/call, CLI-reported) | 0.52 | 0.952 |
| `anthropic/haiku@low` | 0.500 | 0.467 | 0.500 | 0.489 | 0/21 | 0 | 219.7 s / 298.3 s | $3.11 (~$0.15/call) | 0.00 | 0.995 |

Tier discrimination: the Codex rows are near the ceiling on every tier (hard separates them by
0.013); the Claude rows are flat across tiers because their misses are the JSON-shape checks, not
the calibration judgment. Every Claude miss is `json_valid` (fenced or non-JSON text); calibration
stayed at 0.95–1.0. Reading: the hard tier is not too easy for the seats that answer in shape, but
it did not stress *reasoning* — a future re-grade should scale the conflict cases further.

**What the benchmark could not measure.** The stable runner passes no output schema to a target, so
these rows ran *without* schema enforcement, while the gateway enforces the app's `json_schema`
(`--json-schema` on `claude -p`, `--output-schema` on `codex`). The JSON columns above are therefore
a floor for the gateway path. To close that gap for the fallback, the 10 Sonnet-failing cases were
replayed through the gateway itself with the schema (events `name=assess-probe`): **7/9 recorded
replays were clean** (valid JSON, all five paths, all nine ids), **2/9 failed** with
`claude exited with status 1` (classified `transient`), p50 178 s, max 299 s, ~$0.37/call, and
155k–343k input tokens per call — the CLI's structured-output path runs several internal turns.
(The 10th replay was lost to Node's 300 s fetch header timeout; see "Known limits".)

### Decision

- **Primary: `codex/gpt-5.5@low`** — the cheapest row of its seat that clears the hard tier
  (0.987 ≥ 0.85) with zero errors; `@medium` costs 6 s more p50 for a lower hard mean.
- **Fallback: `anthropic/sonnet@low`, flagged.** It did *not* clear the bar in the runner (hard
  0.743; the shape misses above), so by the onboarding rule it would carry no fallback. It is kept
  because the misses are exactly what the gateway's schema enforcement removes (7/9 clean through
  the real path), and during a Codex limit window a slow, dearer assessment beats the deterministic
  mock floor the app degrades to otherwise. The app's `validateAssessment` + `isAssessmentUsable`
  + mock degrade still guard every fallback answer. Deleting the `fallback` line in `gateway.toml`
  is the whole rollback.
- **Not routed:** `anthropic/haiku@low` (0/21 in shape without a schema, p50 220 s).

### Failover drill (gateway `LIGHTTRACK_GATEWAY_DEV=1`, port 8793)

Run 2026-09-15 against the route above (gateway from this repo, `gateway.toml`, dev flag on for
the drill only, then restarted without it):

1. **Real call through the app path** (`LLM_PROVIDER=gateway`, `GatewayProvider.assess` on the
   `sindresorhus/awesome` capture): 63.4 s, usage 14,961 / 3,234 tokens, 9 dimensions, 6 roadmap
   items; event `name=assess`, `source=lt-gateway`, target `codex/gpt-5.5@low`, `fell_back` absent —
   trace `eabf6b9e-827b-4269-9a55-575470c56881`.
2. **Simulated exhausted primary** (`X-LightTrack-Simulate: exhausted:codex`): HTTP 200 in 229.7 s,
   `x-lighttrack-served-by: anthropic/sonnet@low`, `x-lighttrack-fell-back: 1`, `model` =
   `anthropic/sonnet@low`, `schema: enforced`, attempts = `[codex/gpt-5.5@low: exhausted ("codex
   (simulated) rate-limited (HTTP 429)"), anthropic/sonnet@low: served]`; `/health` listed
   `{"provider":"codex","remaining_secs":70}` under `cooldowns`. Valid JSON, 9 dimensions.
3. **Seamless resume** (no header, 200.9 s): `attempts[0]` = `codex/gpt-5.5@low: skipped_cooling
   ("seat on hold for 70s more")`, served by `anthropic/sonnet@low`, `fell_back: 1`; the hold then
   expired and `/health` showed `cooldowns: []`.
4. **Events** (`GET /v1/events?project=ascent&name=assess`): one trace
   `a5ecc955-8cde-4bad-b7a2-de583fbf6fe4` carrying an `error` row on `codex/gpt-5.5` (tags
   `gateway, provider_failed`, `metadata.failure_class = transient`, `metadata.gateway.verdict =
   exhausted`, chain_len 2) and a `success` row on `anthropic/sonnet` (tag `fell_back`, attempt 2).

Wall-clock reminder from the drill: a fallback answer took 200–230 s; a Codex answer 63 s.

### Known limits

- **Node `fetch` header timeout (300 s).** `GatewayProvider` uses the runtime's `fetch`; undici's
  default `headersTimeout` is 300 s, so a seat call slower than that fails as
  `UND_ERR_HEADERS_TIMEOUT` regardless of `LIGHTTRACK_GATEWAY_TIMEOUT_MS`. Measured: Codex p95
  ~100 s is safe; Sonnet-with-schema reached 299 s once. If the fallback is kept, consider a custom
  undici `Agent` for this call.
- **Cost columns.** Codex reports no `$` (a seat); Claude's `$` is the CLI's own accounting, which
  includes its auto-loaded context — a per-call floor, not a token price.
- **The route carries one turn, no tools, no streaming** — which is all `assess` needs.

### Ids

| Thing | Id |
|---|---|
| LightTrack project | `ascent` |
| Use case | `assess` (`b7e3ad54-1c4d-4dff-8995-0b576814b8e2`) |
| Dataset (folded, frozen) | `d172e1fa-3bb7-44da-848c-84f39f7b6b33` |
| Rubric | `c00a7357-395b-41a1-9efa-cd3e47d50005` (v3; `9a546802…` v1 and `ba4e95f4…` v2 carry a broken regex — do not reuse) |
| Benchmark (regression gate) | `044161af-97ee-489d-9a46-98b5421fd7f6` (`GET /v1/benchmarks/:id/gate`) |
| Runs | `b18e1052-ee18-488c-bbcb-9cc6ba9e8c12` gpt-5.5@low · `593de800-28f2-445e-820e-1aa33c857bae` gpt-5.5@medium · `08657165-09db-4a59-9ed2-000c5536c3b9` sonnet@low · `655d229a-5fb9-4d91-a79e-0f90ea68702c` haiku@low |
| Superseded | benchmark `779caf3d-8be4-44eb-af88-370cb148d14d` (v1: system turn — Codex rows could not run; rubric regex broken); dataset `93b4ff83…` (unfolded); probe benchmark `15c92e40…` (discard) |

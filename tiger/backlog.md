---
note_type: backlog
updated: 2026-06-20 (session [[2026-06-20-tiger-l1]])
call_site: scan-assess
tags: [backlog, deliverable]
---

# Tiger backlog — bring the most from the LLM engine

The living, impact-ranked list of changes to [[scan-assess]] (the app's one LLM call site). Ranked by **impact** (frequency × reachability × trust-erosion / cost), not raw severity. Open items roll forward each session; closed ones drop to the log at the bottom. Source: [[2026-06-20-tiger-l1]]. Every item is code-grounded and (for the P0s) orchestrator-verified.

## P0 — cheap, confirmed, high-leverage (do first)

*(All three P0s shipped 2026-06-20 — see the Closed/Fixed log below.)*

## P1 — high value, confirmed

*(P1-4 shipped 2026-06-20 — see the Closed/Fixed log below.)*

### P1-5 · Put engine/model provenance in the durable + signed artifact `[lens: trust/business-value]`
Grounding is lossy on the way **out**: the live UI discloses mock-degrade, but the signed audit CSV (`history/route.ts`) has **no engine column**, so a mock-degraded quarter is byte-identical to a model-scored one in the filed evidence. Plus the keyless-default mock path keeps `llmFailed=false` (`scan.ts:118,279`), so its only disclosure is the chip — not the loud caveat the failure path emits.
- **Fix:** add `engine`/`model`/`degraded` columns to the export + persist them on the Scan row; emit the deterministic-floor caveat on the **keyless-default** mock route too (not just the failure route).
- **Win:** an auditor (Mariam/Diane) can see which quarters were really AI-scored; closes the disclosure-parity gap (Mei).
- Evidence: `history/route.ts:31,115`, `scan.ts:118,274-293`, `index.ts:70-72`. `impact: {freq:med, reach:med, trust:high}`.

*(P1-6 shipped 2026-06-20 — see the Closed/Fixed log below.)*

## P2 — model optimization (needs the live `benchmark` pass to land)

### P2-6 · Right-size the model per sub-task — the cost↔quality frontier `[lens: model-optimization]`
**Benchmarked 2026-06-20 ([[2026-06-20-tiger-benchmark]]) — Claude spine, real outputs, blind-judged.** Findings:
- **(a) Keep `sonnet` as default — CONFIRMED, don't downgrade to haiku.** Empirically, the guardband protects the *score* (haiku's D2=75 clamps to 47) but the *roadmap + discrepancy audit* (the actual value) degrade below the senior bar on haiku; sonnet is the cheapest tier that clears. Status: **resolved-verified for the Claude spine** (n=1 fixture; re-run across 3-5 fixtures to fully close).
- **(b) Two-model split — TESTED, NOT worth it.** Output tokens dominate the bill (not input), so splitting cheap-scoring/strong-roadmap saves little, and haiku's summaries were also weak. Single-model sonnet beats the split. **Closed (won't-do).**
- **(c) Thinking-budget knob — ✅ SHIPPED 2026-06-20** (see Closed/Fixed log). `LLM_THINKING_BUDGET` env, opt-in, Bedrock-wired. Predicted to help only opus's discrepancy audit on complex repos; live-confirm pending.
- **(d) Premium `opus` toggle** for high-stakes audits (the 2nd-discrepancy catch) — offer as an enterprise option, not default. **Open (product decision).**
- **Still UNVERIFIED:** `gemini-3-flash` (public/MVP default) — predicted ≈ haiku; **run a live gemini-flash vs sonnet pass before trusting the public tier** (Tomas's "buyer judges the product on the cheap scan" risk). `impact: {freq:high, reach:high, trust:med}`.

### ✅ P2-8 · Roadmap title must agree with its own rationale — `fixed` (2026-06-20, benchmark-motivated)
The benchmark's only sonnet FAIL (Sam) was a roadmap whose **title** ("Tests run in CI but don't gate") contradicted its own **rationale** ("ci.yml does not invoke pnpm test").
- **Shipped:** added a line to the roadmap instruction in the `TASK` block (`prompt.ts`): *the title must state the gap accurately and must not contradict its own rationale.* One stable-prefix change (still byte-identical across repos, so the P0-1 cache invariant holds).
- **Verified:** tsc 0 · eslint 0 · suite green.
- **l2_priority (to reach resolved-verified):** re-run the `benchmark` sonnet row — does Sam's roadmap-title objection clear (sonnet → PASS/PASS)?

### P2-7 · Gate re-scan wobble with a noise floor `[lens: trust]`
Once the 7-day SHA result-cache lapses, temperature 0.2 + the ±15-realized guardband re-roll an unchanged repo's score, and `diffScans` reports any delta with no R²/flat-floor/CI gate — indistinguishable from a real move (Mariam; ties to the UAT *repeated-org-scans* finding). 
- **Fix:** surface the forecast's noise floor / R² where a score *move* is shown; consider temperature 0 for the scoring path (keep nuance in prose, not the number).
- `impact: {freq:med, reach:med, trust:high}`.

## Strengths — protect, do NOT refactor away
Honest billing (usage on usable-only, `scan.ts:206-219`) · the retry/budget/abort/validate/coverage **wrapping stack** · schema-as-single-source-of-truth · claude-cli secret hygiene · per-row HMAC + CSV content-hash tamper-evidence · GHES + OpenAI base-URL overrides (Diane's air-gap blocker now refuted). Any change above must preserve these.

## Closed / resolved log

### ✅ P1-4 · Opt-in assessment eval log — `fixed` (2026-06-20, unit-verified)
Only failures logged; a usable-but-wrong assessment left no trace — blocking debugging (Sam), injection forensics (Nadia), auditor defense (Mariam), and Lens-C benchmarking (no corpus).
- **Shipped:** new `src/lib/llm/eval-log.ts` — when `ASCENT_EVAL_LOG_DIR` is set, every assess() outcome is appended as one JSONL record (prompt + structured assessment + provider/model + degraded flag + coverage + usage + latency), secrets redacted. Hooked in `scan.ts` after `report.usage` (prompt rebuilt only when logging is on). OFF by default → no prod overhead, no captured content; best-effort (a sink failure never fails a scan); local-dev/self-host (ephemeral serverless FS by design).
- **Verified:** tsc 0 · eslint 0 · 4 new eval-log tests (no-op when off · JSONL shape when on · secret redaction). `2392` suite green.
- **Ceiling:** captures the *validated* assessment (structured), not the provider's raw pre-parse text — a parse-failure forensics gap remains (would need a provider-level onTrace hook); and no Character/eval *verdict* is attached yet (that comes from a scoring pass over the corpus). File sink only (no DB/external sink).

### ✅ P1-6 · Cache-aware token metering — `fixed` (2026-06-20, unit-verified)
With P0-1 caching on, the cost basis missed the cache token classes (cache reads ~10%, writes ~125% of input).
- **Shipped:** added `cacheReadTokens`/`cacheWriteTokens` to `TokenUsage` (`types.ts`); Bedrock captures `res.usage.cacheReadInputTokens`/`cacheWriteInputTokens` in `onUsage` (`bedrock.ts`); new `billableInputTokens()` (`config.ts`) folds the cache classes into a cost-equivalent input count; `scans-persist.ts` persists that so `/usage` prices a cached scan correctly off the single `inputTokens` column — **no migration**. The live `report.usage` keeps the raw breakdown.
- **Verified:** tsc 0 · eslint 0 · 4 new `billableInputTokens` tests (non-cached unchanged · read@10% + write@125% folding · re-scan cheaper · null-tolerant). Existing cost tests still pass (no cache fields → identity).
- **Ceiling:** Bedrock-only (the explicit cachePoint path); OpenAI/Gemini implicit-cache token classes aren't folded yet (their reported usage already reflects some discounts). The persisted `inputTokens` is now a *cost-equivalent* basis, not a literal count, when caching is active (documented at the persist site).

### ✅ P2-6c · Opt-in extended-thinking budget — `fixed` (2026-06-20, unit-verified)
No thinking knob existed (`config.ts` had only temperature/maxTokens); the benchmark predicts thinking helps only the discrepancy audit.
- **Shipped:** `thinkingBudgetTokens()` reads `LLM_THINKING_BUDGET` (`config.ts`, default 0 = off). When > 0, Bedrock enables extended thinking (`additionalModelRequestFields.thinking`), bumps `maxTokens` above the budget, sets temperature 1 (required), and relaxes forced tool choice to `auto` (incompatible with thinking; the text-path safety net still parses the answer). Default off → byte-identical to current behavior.
- **Verified:** tsc 0 · eslint 0 · 3 new `thinkingBudgetTokens` tests (off when unset · honors a positive budget · zero/negative/non-numeric = off). Bedrock tests still pass.
- **Ceiling:** Bedrock-only for now (Converse has clean support); claude-cli/gemini/openai thinking knobs not wired. Predicted-only benefit (the harness couldn't benchmark thinking) — **l2_priority:** run a live opus+thinking vs opus pass on a complex repo; does the discrepancy audit catch more?

### ✅ P0-1 · Provider prompt-caching on the stable prefix — `fixed` (code landed 2026-06-20, unit-verified)
The role + rubric + task + JSON-schema (~3-4K input tokens, the bulk of every prompt) was interleaved with per-repo data in the user message, so no cacheable contiguous prefix existed and `cache_control`/`cachePoint` were absent repo-wide.
- **Shipped:** restructured `buildAssessmentPrompt` (`prompt.ts`) — ALL stable framing now composed once at module load into the `SYSTEM` prompt (byte-identical every scan); the user message carries only per-repo evidence (repo meta, signals, process, commits, files, stack-fit caveat). Added an explicit Bedrock `cachePoint` on the system block (`bedrock.ts`). Every provider already sends `system` first (claude-cli concatenates `system\n\nuser`, gemini `systemInstruction`, openai leading system msg), so the stable prefix is now cacheable by **all** of them — Bedrock explicit cachePoint, OpenAI automatic prefix-cache, Gemini implicit, claude-cli's own.
- **Verified:** tsc 0 · eslint 0 · 2381 tests pass, incl. **3 new caching-invariant tests** (`prompt.test.ts`) asserting the rubric/task live in `system`, the SYSTEM prefix is byte-identical across different repos, and per-repo evidence stays in `user` — so a future edit can't silently move stable content back and defeat the cache.
- **Win:** ~30-90% off the input slice on a re-scan cadence at **zero quality/output change** (output contract is still tool/schema-enforced).
- **Ceiling / remaining sub-item:** metering isn't cache-aware yet — `TokenUsage` doesn't carry a `cacheRead`/`cacheWrite` class, so `/usage` prices cache-read tokens (≈10% rate) as if absent (a small *under*-count once caching kicks in; the headline cost still drops because Bedrock reports fewer billable `inputTokens`). Tracked as a P1 follow-up below.
- **l2_priority:** on a real Bedrock/Anthropic scan, re-scan the same repo at two distinct commits and confirm `cacheReadInputTokens > 0` on the second, with the input bill dropping the predicted band.

### ✅ P0-2 · Thread `stackFit` into the prompt — `fixed` (code landed 2026-06-20, unit-verified)
`detectStackFit` ran at `scan.ts:338` (after the prompt was built), reaching only `report.warnings` — so the model judged ML/notebook/mobile/embedded repos on the web rubric.
- **Shipped:** hoisted `detectStackFit(snapshot)` above the `scoreInput` build (`scan.ts`); added `stackFit?: StackFit | null` to `LlmScoreInput` (`provider.ts`); render a **STACK-FIT CAVEAT** block in `buildAssessmentPrompt` (`prompt.ts`) — byte-identical prompt for full-fit/web repos (the common case), so no cache churn there. Reused the one detection for the existing warning.
- **Verified:** tsc 0 · eslint 0 · 2378 tests pass.
- **Ceiling (honest limit that remains):** only `ml | mobile | embedded` are detected — other under-read stacks (game dev, data-eng, infra-as-code) still judge on the web rubric; and the caveat *informs* the model, it does NOT re-weight the deterministic signals (the score floor is unchanged — by design, per `stack-fit.ts`'s "honesty not re-scoring" intent).
- **l2_priority (to reach `resolved-verified`):** run a live scan (claude-cli/gemini) on a real `.ipynb`-dominant repo — does the roadmap's top entry stop recommending web hygiene and the discrepancy audit stop docking absent unit tests? Diff roadmap vs the pre-fix output.

### ✅ P0-3 · Priority-rank the prompt's file window — `fixed` (code landed 2026-06-20, unit-verified)
`source.ts:454` re-sorted the signal-ranked fetch **alphabetically**, so the 22KB prompt window showed alphabetical-luck excerpts and cut high-signal files sorting late.
- **Shipped:** replaced `files.sort(localeCompare)` with a sort by **`pickFilesToFetch` rank** (`fetchRank` map of `picks`) — deterministic (so prompt/cache keying stays stable) but front-loads README/manifests/AI-config/sampled tests+source ahead of the byte-window truncation.
- **Verified:** tsc 0 · eslint 0 · 2378 tests pass (incl. `source.test.ts`).
- **Ceiling:** the **22KB window itself is unchanged** — a very large repo still can't show everything; this front-loads *signal* but doesn't widen the aperture. Source/test samples (pick sections 5-6) still follow manifests/docs, so on a doc-heavy repo they can still be cut by the cap. Widening/repartitioning the window is a separate, larger change.
- **l2_priority:** scan a large repo (>32 signal files, deep test dirs) live and confirm the `SAMPLED FILES` block now leads with the signal-ranked files, not `a*`.

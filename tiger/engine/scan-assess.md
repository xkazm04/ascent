---
note_type: engine-call-site
call_site: scan-assess
task: Audit a GitHub repo's AI-native engineering maturity (9 dimensions → scores + summaries + roadmap + discrepancies)
entry: src/lib/scan.ts:206  (attemptAssess → provider.assess)
prompt_builder: src/lib/scoring/prompt.ts:63  (buildAssessmentPrompt)
output_contract: src/lib/llm/schema.ts (ASSESSMENT_JSON_SCHEMA) → validateAssessment src/lib/llm/provider.ts:101
providers: [claude-cli (dev), gemini (MVP/public), bedrock (enterprise/private), openai, mock (floor)]
default_model: { dev: "sonnet (claude-cli)", mvp: "gemini-3-flash", enterprise: "us.anthropic.claude-sonnet-4-6" } — sonnet floor CONFIRMED empirically 2026-06-20 ([[2026-06-20-tiger-benchmark]]): haiku fails the un-guardbanded roadmap/discrepancy bar, opus is a premium-only ceiling. MVP gemini-3-flash still UNVERIFIED (predicted ≈ haiku — run live before trusting the public tier).
grounding: 4/5 in-direction (P0-2 stack-fit + P0-3 priority-ranked files FIXED 2026-06-20 — up from 3.5; live-confirm pending); OUT-direction still gapped — provenance is lost into the durable audit CSV (P1-5 open). No cross-scan memory. Session [[2026-06-20-tiger-l1]]
dials: { wrapping: 9/10, observability: 4/10, caching: 8/10 (was 4 — P0-1 prompt-caching landed 2026-06-20; -2 only for cache-unaware metering + no in-flight dedup) }
tags: [engine, llm-call-site, scan, the-only-llm-piece]
last_reviewed: 2026-06-20 (session [[2026-06-20-tiger-l1]])
---

# Engine call site — `scan-assess` (the maturity assessor)

> **This is the app's single LLM touchpoint.** Everything else is deterministic. So the entire AI value, AI cost, and AI variance of Ascent flows through this one `assess()` call. Tiger's whole job is this note. See [[MOC]].

## What the model is asked to do
Given a repo snapshot (already analyzed by deterministic detectors), produce — as **schema-constrained JSON** — for each of 9 dimensions: a 0-100 score **calibrated to the deterministic signalScore**, a summary, ≤4 strengths, ≤4 gaps; plus an overall headline, 3-5 org strengths, 3-5 risks, a 3-5 item **invitational roadmap** (`title`/`rationale`/`explore`/`impact`/`effort`/`levelUnlock`), and a **discrepancies** auditor pass (flag deterministic signals the file evidence contradicts). Prompt: `src/lib/scoring/prompt.ts:101-151`. System: `prompt.ts:46`.

**Load-bearing constraint (drives Lens C):** the model does NOT free-score. It's told to *nuance within a small band* of the signalScore (`prompt.ts:46,124`), and downstream the scoring engine **guardbands the LLM ±25 around the deterministic score and blends 60/40** (`src/lib/scoring/engine.ts`) — so the **realized** swing the model can produce on the final number is ≈ **±15** (0.6 × 25), not ±25 (session [[2026-06-20-tiger-l1]] precision). So the model's scoring degrees-of-freedom are bounded; its real, unbounded value-add is **(a) the roadmap quality** and **(b) the discrepancy audit** (genuine reasoning over file excerpts). Those two are where model strength earns its cost — the scoring is nearly model-insensitive by design.

## Grounding audit (Lens B) — `grounding 5/5` major sources, depth-capped
What real context reaches the prompt (`buildAssessmentPrompt`, `prompt.ts:67-122`):
1. **Repo meta** — owner/name, language, stars, last-push, description, archetype. `prompt.ts:103-107`. ✓
2. **Deterministic signals** — all 9 dimensions' `signalScore` + per-signal evidence labels (the calibration anchor / "ground truth"). `prompt.ts:69-76, 111-112`. ✓
3. **Process signals** — PR review/merge/velocity/AI-governance + branch-protection/governance (only when scanned **with a token**; one-line "unavailable" otherwise). `prompt.ts:18-44, 114-115`. ✓ (token-gated)
4. **Commit sample** — 15 recent commit messages, each ≤120 chars. `scan.ts:180`, `prompt.ts:97-99, 117`. ✓
5. **File excerpts** — concatenated, **≤2200 chars/file, ≤22000 chars total** (`PER_FILE`/`OUTER`). `prompt.ts:87-95, 120-121`. ✓ but **breadth-capped AND mis-ordered** — see SAM-G1 below.

**Revised by [[2026-06-20-tiger-l1]] — grounding was 5/5 on paper, ≈3.5/5 in delivery; now ≈4/5 after the P0 fixes.** The sources are right; the delivery had two leaks, both now fixed (code landed; live-confirm pending):
- ✅ **Breadth was alphabetical-luck (SAM-G1) — FIXED (P0-3).** `pickFilesToFetch` signal-ranks files, but `source.ts:454` used to re-sort them **alphabetically** before the 22KB window cut them. Now sorted by **fetch-priority rank** (deterministic), so high-signal files lead the window. `source.ts:454`, `prompt.ts:90-93`.
- ✅ **Stack-fit was computed then withheld (T-AR1) — FIXED (P0-2).** `detectStackFit` ran at `scan.ts:338`, after the prompt was built, reaching only `report.warnings`. Now hoisted above `scoreInput`, carried on `LlmScoreInput.stackFit`, and rendered as a STACK-FIT CAVEAT in `buildAssessmentPrompt` — so the roadmap/discrepancy audit calibrate to ML/mobile/embedded stacks.
- **No cross-scan memory** (still open) — the prompt carries no "what changed since last scan" / team goals / prior assessment; each scan re-judges cold (ties to the UAT *repeated-org-scans* value question).
- **Grounding is lossy on the way OUT** — the model's engine/provenance doesn't survive into the durable, signed audit CSV (no engine column), so a mock-degraded quarter is indistinguishable from a model-scored one in the filed artifact. Grounding must be audited in **both** directions: into the prompt AND out to the durable artifact.

## Lens A — Engine Quality dials

### Wrapping — **9/10** (a genuine strength; say what NOT to touch)
- Provider abstraction `LLMProvider` (swappable: gemini/bedrock/openai/claude-cli/mock). `src/lib/llm/provider.ts:46-50`.
- **Retry → failover → mock-degrade** plan, with honest `llmFailed` flag + SSE caveat. `scan.ts:243-296`.
- **Per-call timeout** `LLM_TIMEOUT_MS=60s` via AbortController in *every* provider. `bedrock.ts:57-64`, `gemini.ts:38`, `openai.ts:41`.
- **Total LLM budget** `LLM_TOTAL_BUDGET_MS=90s` across all attempts (sits under the route's 120s maxDuration so mock-degrade always runs). `scan.ts:36, 237-242`.
- **Abort/cancellation** wired to client disconnect end-to-end. `scan.ts:71, 242, 269`.
- **Structured output** forced (Bedrock tool-use / Gemini responseSchema) against one schema source of truth `ASSESSMENT_JSON_SCHEMA`, with **never-throw `validateAssessment`** + `parseJsonLoose` repair + a text-path safety net. `bedrock.ts:80-129`, `provider.ts:101-184`.
- **Quality/coverage gate** — a parseable-but-empty reply (`<50%` dims scored) is treated as a *failure*, not rendered as truth. `provider.ts:205-209`, `scan.ts:213-216`.
- **Input/output bounds** — field length cap (`MAX_FIELD_LEN=2000`) + array-count bounds + dedupe, anti-injection/anti-bloat. `provider.ts:59-72, 112`.
The one point off: no circuit-breaker / no provider health memory across scans (each scan re-discovers a down provider via the full retry budget).

### Observability — **4/10** (the biggest Lens-A gap)
- ✓ **Token metering** `onUsage({inputTokens, outputTokens})`, committed to `report.usage` **only on a usable attempt** (a failed attempt's tokens are dropped — honest billing, a real strength). `bedrock.ts:100`, `scan.ts:206-219, 313`.
- ✓ **Latency** `llmLatencyMs`. `scan.ts:298, 313`.
- ✗ **No prompt/response capture** — the prompt and the raw model output are never logged or persisted. Only *failures* log (`console.error("[scan] LLM provider failed…")`, `scan.ts:281`). A *usable-but-wrong* assessment (the dangerous case — it renders under the provider's name) leaves no trace to debug or to build an eval set from. → [[#T-A2]]
- ✗ **No request/trace id**, no per-attempt success log, no structured event. Three failover attempts produce at most one error line.
- ✗ **No eval logging** — nothing accumulates (prompt, output, Character verdict) into a regression corpus, so Lens-C benchmarking starts from zero each time.

### Caching — **4/10**
- ✓ **Whole-scan result cache** `lookupCachedScan` keyed by head-SHA × useLLM × orgSlug — a re-scan of an *unchanged* commit skips the LLM entirely. `src/app/api/scan/stream/route.ts:132`, `src/lib/scan-cache.ts:65`. Good coarse cache.
- ✅ **Provider prompt-caching — FIXED (P0-1, 2026-06-20).** The stable prefix (role + full rubric + task + JSON schema ≈ the bulk of input tokens) is now composed once into the `SYSTEM` prompt (byte-identical every scan) and Bedrock marks it with a `cachePoint` (`bedrock.ts`); OpenAI auto-caches the prefix, Gemini implicitly, claude-cli its own. Re-scans of distinct commits now read the prefix from cache instead of re-billing it. Was: 0 `cache_control`/`cachePoint` hits repo-wide.
- ✗ **Metering not cache-aware** (remaining, P1-6) — `TokenUsage` has no `cacheRead`/`cacheWrite` class, so cache-read tokens (~10% rate) aren't separately priced.
- ✗ **No in-flight dedup** — two concurrent scans of the same commit both call the model (the result cache only helps *after* one completes).

## Lens C — Model Optimization (predicted frontier; benchmark plan in [[models]])
Because scoring is guardbanded (above), the hypothesis: **the score is nearly model-insensitive; the roadmap and discrepancy-audit are not.**
- **Cheap tier** (gemini-3-flash $0.5/$3 · gpt-4o-mini $0.15/$0.6 · haiku $1/$5): likely holds the score within the guardband and writes acceptable summaries, but **roadmap drifts generic** and **discrepancy-catching drops** → fails the skeptics ([[sam-staff-engineer]], [[mariam-fintech-audit]]) on senior-quality.
- **Mid tier** (sonnet $3/$15 · gpt-4o $2.5/$10) — the current default — predicted **right-sized floor** for a defensible roadmap.
- **Premium / thinking** (opus $5/$25 · sonnet+think): predicted to help **only the discrepancy audit on complex repos** (the one genuine reasoning sub-task); wasted on scoring/summarizing.
- **Thinking-level**: helps `discrepancies` (reasoning over file evidence), wasted on the rest. No thinking-budget knob is exposed today (`config.ts` has temperature/maxTokens only) — adding one, scoped to the audit, is itself a Lens-C recommendation.
Benchmark matrix + price snapshot: [[models]].

## Findings raised this site → tracked in [[backlog]] (impact-ranked; full objects in the per-Character reports)
- **P0-1** `caching/cost` — no provider prompt-caching; stable prefix re-billed every scan (~30-90% input waste). *Convergent: Victor/Elena/Tania.*
- ✅ **P0-2** `grounding` — stack-fit now threaded into the prompt (was withheld at `scan.ts:338`). **FIXED 2026-06-20** (unit-verified; live-confirm pending). See [[backlog]].
- ✅ **P0-3** `grounding` — prompt file window now priority-ranked, not alphabetical (`source.ts:454`). **FIXED 2026-06-20**. See [[backlog]].
- **P1-4** `observability` — no prompt/response capture; undebuggable, no injection forensics, no eval corpus. *Convergent: Sam/Nadia/Mariam.*
- **P1-5** `trust` — engine/provenance absent from the durable signed CSV + keyless-default mock skips the loud caveat (MEI-B1, scan.ts:118,279).
- **P2-6** `model-fit` — cheaper-holds the (guardbanded) score; sonnet floors roadmap+discrepancies; two-model split + scoped thinking knob candidates. Needs `/tiger benchmark`.
- **P2-7** `trust` — re-scan wobble outside the 7-day cache, no noise gate (Mariam).
- **Strengths to protect:** honest billing (usage on usable-only), the retry/budget/abort/validate/coverage wrapping stack, schema-as-single-source-of-truth, claude-cli secret hygiene, per-row HMAC + CSV content-hash, GHES/OpenAI base-URL overrides.

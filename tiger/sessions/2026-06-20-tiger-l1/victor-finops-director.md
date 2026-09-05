# Tiger L1 — Victor (FinOps Director) × scan-assess

**One-line verdict:** The engine bills honestly and the result-cache is real, but the per-call cost is *structurally inflated* — a ~3-4K-token static prefix plus a ~5.5K-token excerpt window is re-billed at full input price on every distinct commit because **no provider implements prompt-caching** — and `sonnet` is over-provisioned for a guardbanded score. **fix-first.**

---

## Angle & reachable output (what I actually judged)

I am Victor; I do not read the JSON the model emits — I read the **bill it generates**. So my "model output" is the **token-cost shape of one `assess()` call** and the spend curve of a 300-engineer fleet re-scanned weekly. The reachable artifacts are: the prompt the providers build (`prompt.ts:63-153`), the input/output token split the providers meter (`bedrock.ts:100`, `gemini.ts:64`, `openai.ts:68`), the price table that turns those into dollars (`config.ts:39-55`), and the `/usage` "Est. cost" stat that surfaces it (`usage/page.tsx:231-241`).

Tier-honest note: on **Team**, my fleet's private repos route through `bedrock` (enterprise default `us.anthropic.claude-sonnet-4-6`, `bedrock.ts:26`) or `claude-cli` `sonnet` in dev — both priced **$3 in / $15 out** (`config.ts:45,49`). The public MVP floor is `gemini-3-flash` ($0.5/$3, `config.ts:41`). My spend is the Sonnet column, so that's the one I cost.

## Surface-model notes (cost affordances → fresh file:line)

- **Static prefix, re-billed every scan.** The prompt is `system` (~195 tok, `prompt.ts:46`) + `rubric()` (5 LEVELS + 9 DIMENSIONS = **~1,605 tok of pure rubric text**, measured; `prompt.ts:48-57`, `model.ts:25-..`) + the fixed TASK/IMPORTANT/JSON-shape scaffolding (~1.2K tok of literal template, `prompt.ts:123-151`). Call it **~3-4K input tokens that are byte-identical across every scan of every repo.** None of it is cached.
- **Variable body.** Per-repo: signal block, 15 commit messages (`prompt.ts:97-99`), and the file-excerpt window capped at **PER_FILE=2200 / OUTER=22000 chars** (`prompt.ts:87-95`) ≈ **~5,500 input tokens**. For a fleet re-scanned on a cadence, even this "variable" body is *largely stable* commit-to-commit (the rubric, the 9 signal labels, and most of ~10 file excerpts don't change between two adjacent commits).
- **Output is bounded and small.** One JSON object, `BEDROCK_MAX_TOKENS=4096` cap (`bedrock.ts:75`). So **input price dominates** (~8-10K in vs ≤~1.5K out typical) — which is exactly the axis where caching and model choice pay off, and exactly the axis with zero optimization today.
- **No `cache_control` / `cachePoint` anywhere in `src/`.** Confirmed: the strings appear only in `tiger/` docs and the tiger skill — **0 hits in product code**. Bedrock's `ConverseCommand` (`bedrock.ts:69-92`) sends `system` + `messages` + `toolConfig` with **no `cachePoint` block**; Gemini (`gemini.ts:45-57`) sends no `cachedContent`; OpenAI (`openai.ts:46-57`) sets no `prompt_cache_key`. Every scan pays cold input price for the whole prefix.
- **Coarse cache is good (protect it).** Whole-scan result cache keyed by head-SHA × useLLM × org (`scan-cache.ts:114`, 7-day freshness `scan-cache.ts:27-31`) skips the LLM entirely on an *unchanged* commit. This caps my waste to *one* LLM call per distinct commit — without it the story would be far worse. But a fleet that actually ships pays a full cold call per commit, and that call is the uncached one.
- **Honest metering (protect it).** Tokens commit to `report.usage` only on a *usable* attempt; a failed/retried attempt's tokens are dropped (`scan.ts:204-219`). I am not billed for failover thrash. `/usage` prices mixed-provider fleets per-model (`usage.ts:140-156`), so a Gemini-public + Sonnet-private window isn't billed at one wrong blended rate. That's a defensible row.

## Cost-frontier math (grounded, list prices per `models.md`)

Sonnet input = **$3 / MTok** (`config.ts:49`). Per cold scan ≈ **~9K input tokens** (3.5K static + 5.5K body) → **~$0.027 input** + ~1.5K out × $15/MTok = ~$0.022 → **~$0.05/scan**. Small in isolation — but my lens is the *fleet × cadence*, and the **avoidable slice is the ~3-4K static prefix**: at $3/MTok that's **~$0.010-0.012 of pure re-billed prefix per scan**, every scan, forever.

Anthropic prompt-caching reads the cached prefix at **~0.1× input price** (cache write is ~1.25×, amortized over the cadence). For a fleet of, say, 300 active private repos re-scanned weekly = **~15,600 cold scans/yr**: the prefix alone is **~15,600 × $0.011 ≈ $172/yr re-billed at full price** that caching would cut by ~90% → **~$155/yr recovered on the prefix axis**, before counting the stable portion of the excerpt body (cache the rubric+signals prefix and a chunk of that ~$0.016/scan body cost drops too — plausibly **$300-450/yr** total recoverable on a 300-repo weekly fleet, scaling linearly with fleet size and cadence). Not headline money at this fleet size, but it is **pure idle spend** — COGS I light on fire for a byte-identical prefix — and it is the kind of line a FinOps owner is paid to not leave on the table. **Caching is the single highest-leverage cost change and it is a provider-flag-level fix, not a rewrite.**

## Findings

```json
[
  {
    "id": "T-V1",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "cost",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "No provider prompt-caching — the ~3-4K-token static prefix is re-billed at full input price every scan",
    "expected": "The byte-identical prefix (system + 1.6K-tok rubric + JSON-shape scaffolding ≈ 3-4K input tokens) should be sent once and read from cache at ~0.1× on subsequent scans of a fleet on a cadence (Anthropic cache_control / Bedrock cachePoint / Gemini cachedContent / OpenAI prompt_cache_key).",
    "got": "cache_control / cachePoint / cachedContent / prompt_cache_key appear in ZERO src/ files. Bedrock ConverseCommand sends system+messages+toolConfig with no cachePoint; Gemini sends no cachedContent; OpenAI sets no prompt_cache_key. Every distinct commit pays cold input price for the whole prefix.",
    "evidence": [
      "src/lib/scoring/prompt.ts:46",
      "src/lib/scoring/prompt.ts:48-57",
      "src/lib/scoring/prompt.ts:123-151",
      "src/lib/llm/bedrock.ts:69-92",
      "src/lib/llm/gemini.ts:45-57",
      "src/lib/llm/openai.ts:46-57",
      "src/lib/llm/config.ts:45-49"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "cost_delta": "+$0.010-0.012/scan of pure idle prefix spend at Sonnet $3/MTok; ~$155-450/yr recoverable on a 300-repo weekly fleet, scaling linearly with fleet×cadence. Cache read ~0.1× input, write ~1.25× amortized.",
    "l2_priority": "Add cache_control to the stable prefix on the bedrock/claude-cli path; re-scan the same 50-repo fleet twice and confirm cache_read_input_tokens > 0 and the second-pass input bill drops ~70-90% on the prefix slice. Confirm the prefix is contiguous and stable enough to hit the cache (rubric+schema before the per-repo body — it already is, prompt.ts orders rubric before SAMPLED FILES)."
  },
  {
    "id": "T-V2",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "cost",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "Sonnet ($3/$15) is over-provisioned for a guardbanded, model-insensitive SCORE",
    "expected": "The most expensive sub-task (scoring) should run on the cheapest model that clears the bar, because the engine clamps the LLM ±25 and blends 60/40 — the score barely moves with model quality. Spend should concentrate on the roadmap + discrepancy audit, the only model-sensitive outputs.",
    "got": "One model serves all sub-tasks at one price. Score is guardbanded (LLM_GUARDBAND=25) and blended (SCORE_BLEND=0.6) — at low coverage it leans even harder on deterministic signals. So a cheap model would likely hold the score within band, yet the whole call pays Sonnet rates. There is no per-task model split and no thinking-budget knob (config.ts exposes temperature/maxTokens only).",
    "evidence": [
      "src/lib/maturity/model.ts:16",
      "src/lib/maturity/model.ts:23",
      "src/lib/scoring/engine.ts:98-102",
      "src/lib/scoring/engine.ts:70-71",
      "src/lib/llm/config.ts:8-13"
    ],
    "code_check": "by-design",
    "verdict": "uncertain",
    "model_variant": "gemini-3-flash ($0.5/$3) or haiku ($1/$5) for scoring/summaries; hold sonnet for roadmap+discrepancies",
    "quality_delta": "predicted: score holds in guardband (≈0 delta); roadmap drifts generic and discrepancy-catching drops on cheap — fails the skeptic panel. Net: cheap is right-sized for the score, NOT for the two unbounded outputs.",
    "cost_delta": "gemini-flash input is 6× cheaper than sonnet ($0.5 vs $3 /MTok); on the input-dominated prompt that is the bulk of the per-scan bill. A live benchmark decides whether the roadmap loss is acceptable.",
    "l2_priority": "Run the models.md matrix rows 1-4 on a real repo: does haiku/flash hold the blended SCORE within ±2 of sonnet (it should, by guardband)? Does the roadmap go generic and the discrepancy audit miss detector errors (the failure that keeps sonnet as the floor)? If only the roadmap degrades, the cost-optimal answer is cheap-score + sonnet-roadmap, or sonnet-everything with prompt-caching to claw back the input cost."
  },
  {
    "id": "T-V3",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "The cost the engine surfaces is the vendor's token COGS, not MY subscription $/scan",
    "expected": "A FinOps owner needs $/scan against the tier he pays for and burn-vs-allotment. The engine's metered output should be reconcilable to the renewal number, not only to the LLM bill.",
    "got": "report.usage carries input/output tokens + latency only (scan.ts:313); /usage 'Est. cost' renders the LLM token estimate (the app's COGS) — exactly the 'token cost but not my subscription cost' peeve. Burn-vs-allotment exists separately (AllotmentPanel) but the per-scan engine artifact is a token bill, and credits roll as a prepaid pool with no $/credit on this surface, leaving the $/scan denominator blank.",
    "evidence": [
      "src/lib/scan.ts:311-313",
      "src/lib/db/usage.ts:49-57",
      "src/app/usage/page.tsx:231-241"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "cost_delta": "n/a — this is a legibility gap, not a token cost. It's the difference between a screenshot I paste into a renewal deck and a number I have to re-derive in a spreadsheet.",
    "l2_priority": "Out of strict L1 engine scope (UI/billing surface, not the model output) — flag for the UAT pricing pass: does the engine's token estimate ever get reconciled to a $/private-scan the buyer can defend?"
  },
  {
    "id": "T-V4",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "victor-finops-director",
    "cert_level": "L1",
    "type": "cost",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "med", "trust_erosion": "low" },
    "dimension": "cost",
    "title": "STRENGTHS to protect — honest billing + a real result-cache cap my exposure",
    "expected": "A defensible cost engine bills only for value delivered and avoids re-computing unchanged work.",
    "got": "Tokens commit to report.usage ONLY on a usable attempt — failover thrash is not billed (scan.ts:204-219). The whole-scan result cache (head-SHA × useLLM × org, 7-day freshness) skips the LLM entirely on an unchanged commit, capping waste to one call per distinct commit (scan-cache.ts:114,27-31). Per-model pricing avoids billing a mixed fleet at one wrong rate (usage.ts:140-156). These are exactly the controls I'd build; do NOT regress them when adding prompt-caching.",
    "evidence": [
      "src/lib/scan.ts:204-219",
      "src/lib/scan-cache.ts:114",
      "src/lib/scan-cache.ts:27-31",
      "src/lib/db/usage.ts:140-156"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "cost_delta": "These are the reason the bill is bounded; the result-cache alone is worth more than prompt-caching on a quiet fleet (it elides the whole call, not just the prefix).",
    "l2_priority": "none — protect, don't change."
  }
]
```

## Lens-C answer

**mid-floor — with a strong caveat that the cheap floor is real for the score.** Splitting by sub-task (the guardband forces this read):

- **Score:** cheaper-holds. Guardbanded ±25 and blended 60/40 (`engine.ts:98-102`, `model.ts:16,23`), the blended number is nearly model-insensitive — `gemini-flash`/`haiku` almost certainly land within ±2 of sonnet. Paying $3/MTok to nuance a number the engine then clamps is the textbook over-provision.
- **Roadmap + discrepancy audit:** mid-floor. These are the unbounded, genuinely-reasoned outputs; the engine note and the skeptic panel predict cheap models go generic on the roadmap and miss detector errors in the audit. Sonnet is the defensible floor *here*.
- **Premium (opus):** premium-helps only the discrepancy audit on a complex repo — wasted on score and summaries.

So the cost-optimal architecture is **not** "downgrade the model" wholesale — it's **(1) add prompt-caching so Sonnet's input cost stops being the problem, then (2) consider cheap-score + Sonnet-roadmap only if the live benchmark shows the score truly holds.** Rough `cost_delta` vs the Sonnet baseline: prompt-caching ≈ **−70-90% on the ~3-4K prefix tokens** (the biggest single lever, zero quality risk); a cheap-model score split ≈ **−6× input on the scoring slice** but at real roadmap-quality risk that needs L2 to confirm.

## Character feedback (in Victor's voice)

> **Would I trust this number?** The *token* number, yes — it's metered honestly: I'm billed only when the model actually delivered, and a mixed fleet is priced per model, not smeared into one fake blended rate. That's a row I can defend. But it's the wrong number for *me* — it's your COGS, not my $/scan. The denominator I need (subscription $ over private scans) is blank on the surface the engine feeds.
>
> **Would I paste the badge / run the read?** Not my job here — my artifact is the bill, and the bill has a leak.
>
> **Is it worth the wait/cost?** The cost is *structurally lazy*. You re-send me a byte-identical 3-4K-token rubric on every scan and pay Sonnet's $3/MTok to read it cold, every time, with caching nowhere in the codebase. That's idle spend on a fixed asset — the FinOps equivalent of re-paying for the same reserved instance every hour because nobody flipped the commitment on. At my fleet size it's a few hundred dollars a year, which is small — but it's *pure waste with a one-flag fix*, and "small but free to fix and grows linearly with the fleet" is exactly the line I'm paid to catch before it's a real number.
>
> **The ONE engine change I want:** turn on provider prompt-caching for the stable prefix (`cache_control` / `cachePoint`). It's a provider-flag-level change, it has zero quality risk, and it directly attacks the input axis that dominates this bill. *Then* talk to me about a cheaper model for the score.
>
> **Would I tell a peer?** I'd tell them the metering is honest and the result-cache is real — credit where due — and that the engine leaves an easy caching win on the table and over-pays for a score it then clamps. "Good bones, lazy on the commitment side." I'd keep the row, with a note to push them on caching at renewal.

---

**Grounding score: 4/5.** The five major sources reach the prompt (repo-meta, 9 signals, process signals, 15 commits, file excerpts) — strong for one scan. From MY angle the missing point is **cost grounding**: the prompt carries no signal that its prefix is cacheable/stable, and the engine's metered output stops at token COGS without ever reaching a $/scan the buyer can defend (`scan.ts:313`, `usage.ts:49-57`). The model is given everything to *judge the repo* and nothing to *cost itself*.

**Per-use time-saved (my number): ~0 minutes on the budgeting job from the engine output itself** — the per-scan artifact is a token bill, so my 30-45-min monthly spreadsheet survives until a $/scan denominator and burn-vs-allotment land on the same surface (they're adjacent in `/usage` but not in the engine's own output). The engine *enables* the read; it doesn't *replace* the reconciliation. (Caveat: the separate AllotmentPanel does move this — but that's billing UI, not the model output Tiger scopes.)

**Engine verdict: fix-then-ship.** Honest billing and a real result-cache are genuine strengths to protect. But shipping an LLM engine in 2026 with zero prompt-caching on a 3-4K-token static prefix, on the most input-dominated prompt shape there is, is leaving guaranteed idle spend on the table — and paying Sonnet to nuance a guardbanded score compounds it. Add `cache_control`/`cachePoint`, then benchmark a cheaper score model. Don't touch the metering or the result-cache.

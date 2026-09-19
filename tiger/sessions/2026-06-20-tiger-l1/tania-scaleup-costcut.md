# Tiger L1 — Tania (Scaleup Cost-Cut) × scan-assess

**Verdict:** fix-first — the *output* is right-sized and trustworthy enough to renew on, but the *bill* behind it is leaking on the input axis (no prompt-cache, full-priced 22KB prefix re-billed per commit) — and that leak is invisible-by-design because scoring is guardbanded, so nobody downstream feels the cut. I'd renew the engine, but I'd cut the model bill 30-55% before the next invoice and not lose a single Character.

---

## Angle & reachable output

I'm the prime **Lens-C "cut the bill without losing the value"** judge. My question isn't "is the roadmap pretty" — it's: *given the score barely moves with the model (`engine.ts:96-102` clamps the LLM ±25 and blends 60/40), where is the LLM bill padded, and what can I cut before a skeptic (Sam, Mariam) notices?*

What I actually judged is the **billed token shape** of the one `assess()` call (`scan.ts:206`), and which *parts* of its output (score vs summaries vs roadmap vs discrepancy audit) are load-bearing enough to justify the model tier paying for them. The cost surface is real and reaches me: `estimatedCostUsd` is computed per-model from `inputTokens`+`outputTokens` (`db/usage.ts:206-219, 240-243`) and shown on `/usage` — so I *can* put a $ number in the CFO sheet. Good. But that same code proves the bill is **input-dominated** and **uncached**.

---

## Surface-model notes (fresh `file:line` for the cost angle)

- **The guardband that makes the score model-insensitive** — `LLM_GUARDBAND = 25`, `SCORE_BLEND = 0.6` (`maturity/model.ts:16,23`); applied at `engine.ts:99-102`: `guarded = clamp(min(signal+25, max(signal-25, llmScore)))`, then `0.6*guarded + 0.4*signalScore`. **Net: the LLM can move a dimension at most ±15 points of the headline (0.6 × 25), and the *roadmap/discrepancies* carry the unbounded value.** This is the load-bearing fact for every lever below: I can downgrade the model for *scoring* almost for free.
- **The uncached, re-billed stable prefix** — the prompt is system (`prompt.ts:46`) + full rubric (`prompt.ts:48-57`, every level + every dimension's criteria) + the fixed JSON-shape instructions (`prompt.ts:123-151`). That block is **identical on every scan of every repo** and is the bulk of input tokens. `cache_control` / `cachePoint` appear in **zero** `src/` files (grep: only tiger docs hit). Bedrock's `ConverseCommand` (`bedrock.ts:68-92`) sends `system:[{text}]` with **no `cachePoint`** — the exact spot an Anthropic cache breakpoint would go.
- **The 22KB excerpt window** — `PER_FILE = 2200`, `OUTER = 22000` (`prompt.ts:87-88`); concatenation stops at `joined.length >= OUTER` (`prompt.ts:93`). This is the **variable, per-repo** input — the part a cache canNOT help, and the part most worth shrinking if I want to cut input tokens without a cache.
- **Whole-scan result cache exists; prompt-cache does not** — `lookupCachedScan` keyed by head-SHA skips the LLM entirely on an unchanged commit (`scan-cache.ts`, per engine note `route.ts:132`). So a *re-scan of the same commit* is already $0. The leak is **distinct commits** (a fleet on a weekly cadence): each pays full input price for the same 4-6KB prefix.
- **No thinking-budget knob** — `config.ts` exposes only `LLM_TEMPERATURE` and `BEDROCK_MAX_TOKENS` (`config.ts`; `bedrock.ts:74-75`). No way to scope a thinking budget to *only* the discrepancy audit (the one genuine reasoning sub-task) — so today it's all-or-nothing per model tier.
- **Cost is recorded input+output flat** — `(in/1M)*inRate + (out/1M)*outRate` (`db/usage.ts:219, 243`), no cache-read/cache-write token fields. So even if a cache were added, the usage estimate would **overstate** the bill (price cached reads at full rate) until the accounting learns the discounted cache-read token class.

---

## Grounding audit (Lens B): **3 / 5**

I score grounding against what a *cost-cutter* needs the output to be honest about, not just what a scan needs:

| Source | Reaches prompt? | My read |
|---|---|---|
| Deterministic signals (the calibration anchor) | ✓ `prompt.ts:111-112` | This is *why* I can cut the model — the score is anchored to determinism, not the model. Strong. |
| Repo meta / commits / process | ✓ `prompt.ts:103-118` | Fine for the roadmap. |
| File excerpts (22KB) | ✓ but breadth-capped `prompt.ts:87-95` | A large fleet repo is judged on ~10 excerpts. For my angle this is a *feature* (cheap input) but it caps how much premium model I'd ever pay for. |
| **Cost/value memory** (prior scan, what changed, $/move) | ✗ no memory in prompt | The output can't say "you moved +6 since last scan" — that's reconstructed downstream by `diffReports` (`engine.ts:466`), not by the model. **Missing from the model's own output.** |
| **Cache-token class in billing** | ✗ `db/usage.ts:219` flat in+out | Billing can't represent a cached read. Missing — and it's the plumbing my #1 lever needs. |

Two of the five things a renewal-cost read demands (value-realization memory in the output; cache-aware billing) are absent. **3/5.**

---

## Findings

```json
[
  {
    "id": "T-C1",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "cost",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "cost",
    "title": "No prompt-cache: the stable rubric+schema prefix is re-billed at full input price on every distinct-commit scan",
    "expected": "The large, byte-identical prefix (system + full rubric + JSON-shape instructions ≈ the bulk of input tokens) is cached once and re-read at a steep discount on subsequent scans, so a fleet on a re-scan cadence pays for it ~once, not once-per-commit.",
    "got": "cache_control / cachePoint appear in zero src/ files; Bedrock ConverseCommand sends system:[{text}] with no cachePoint (bedrock.ts:68-92). Every scan of every distinct commit re-sends and re-pays full input price for the same prefix. The whole-scan result cache (scan-cache.ts) only helps the SAME commit, not the shared prefix across commits.",
    "evidence": ["bedrock.ts:68-92", "prompt.ts:46", "prompt.ts:48-57", "prompt.ts:123-151", "db/usage.ts:219"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "model_variant": "sonnet (unchanged) + Anthropic prompt-cache breakpoint after the stable prefix",
    "quality_delta": "0 — caching changes price only, not a single output token; no Character can detect it",
    "cost_delta": "Stable prefix is ~the input bulk; input dominates this call (input-heavy prompt, one bounded JSON out). Anthropic cache reads ≈ 0.1× the input rate after a one-time ~1.25× write. On sonnet ($3/MTok in), a repeatedly-scanned fleet saves ~50-75% of the INPUT bill on the cached portion → roughly 30-45% off total call cost for a weekly-cadence fleet. Zero quality risk.",
    "l2_priority": "Add a cachePoint after the rubric/schema prefix; on a real Bedrock/Anthropic scan, confirm cache_read tokens appear and re-scanning N distinct commits drops measured input $ by the predicted band — AND that db/usage.ts learns the cache-read token class so /usage stops overstating the bill."
  },
  {
    "id": "T-C2",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "cost",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "Single model pays premium for guardbanded scoring; a two-model split (cheap for score/summaries, strong only for roadmap+discrepancy audit) cuts the bill with no headline movement",
    "expected": "Because the engine clamps the LLM ±25 and blends 60/40 (engine.ts:99-102 → max ±15pt headline influence), the SCORE is near model-insensitive. A cost-optimal engine runs the cheap tier for the bounded work (scores+summaries) and reserves a strong model for the two unbounded value parts (roadmap, discrepancies).",
    "got": "One provider/model handles the whole assess() call (index.ts:119-144); there is no way to route the bounded sub-task to a cheaper model. The org/enterprise default is sonnet ($3/$15) for ALL of it, including the part the guardband makes near-irrelevant.",
    "evidence": ["engine.ts:99-102", "maturity/model.ts:16", "maturity/model.ts:23", "index.ts:119-144", "prompt.ts:124-127"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "model_variant": "split: haiku/gemini-flash for score+summaries, sonnet for roadmap+discrepancies",
    "quality_delta": "score: ~0 (guardband absorbs it); summaries: minor degrade, below skeptic threshold; roadmap+discrepancies: unchanged (kept on sonnet). Net senior-quality: holds.",
    "cost_delta": "Moving the bounded scoring/summarizing portion off sonnet ($3/$15) onto haiku ($1/$5) or gemini-flash ($0.5/$3) cuts that portion's bill 65-85%. But it DOUBLES calls (two round-trips) and re-sends grounding twice unless the cheap call gets the trimmed input — so net saving is real only if the cheap call is also input-trimmed. Realistic total: 15-30% off, AND it stacks with T-C1's cache on the strong call. Risk: a second call adds latency + a second failure surface vs the current single hardened path (scan.ts retry/budget/abort).",
    "l2_priority": "Run haiku vs sonnet on a real repo for ONLY scores+summaries through the actual guardband+blend — does the headline move >1 pt? If not, the split is free money on scoring. Separately confirm the roadmap/discrepancies still need sonnet (they do, per the cheap-tier hypothesis)."
  },
  {
    "id": "T-C3",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "cost",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "low", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "The 22KB excerpt window is the only large variable input a cache can't help — shrinking/ranking it is the cheapest lever that needs no new infra",
    "expected": "Excerpts are the per-repo variable input; a cache cannot dedupe them across commits, so to cut variable input cost you either shrink OUTER or send the model FEWER, HIGHER-SIGNAL files (the ones the discrepancy audit actually reasons over) rather than the first ~10 that fit.",
    "got": "OUTER=22000, PER_FILE=2200; files are taken in iteration order and concatenation stops at the first byte-budget hit (prompt.ts:87-95) — no relevance ranking, so the budget can be spent on the first 10 files regardless of whether they're the ones in dispute. Trimming OUTER to ~12-14KB is a one-line cut.",
    "evidence": ["prompt.ts:87-88", "prompt.ts:90-95", "engine.ts:466"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "model_variant": "sonnet (unchanged), OUTER 22000 → ~13000 + relevance ordering",
    "quality_delta": "score: ~0 (guardbanded). discrepancy audit: AT RISK — fewer excerpts means fewer detector-miss catches; this is the ONE part where shrinking the window can degrade the senior-quality skeptics care about. So shrink only if paired with relevance ranking, not raw truncation.",
    "cost_delta": "Cutting OUTER from 22KB→13KB removes ~40% of the variable input chunk → ballpark 15-25% off input tokens for a repo that fills the window (smaller repos already under budget see $0). Stacks with T-C1. Near-zero infra cost.",
    "l2_priority": "On a large real repo, compare discrepancy-catch rate at OUTER=22000 vs 13000 with and without relevance ordering — does the audit miss real detector errors when the window shrinks? If ranked-13KB matches full-22KB, ship the cut."
  },
  {
    "id": "T-C4",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "trust",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "A guardband-noise score wobble on an unchanged repo could read as 'progress' — the model's output carries no within-noise tag",
    "expected": "When the same commit is re-scanned, the result cache prevents an LLM call entirely (good). But across two NEARBY commits, a ±15pt-eligible LLM nuance can move the headline a point or two with no real change — and the model's output gives me no signal that the move is within-noise vs real, so I can't tell the cron breathing from value.",
    "got": "The model returns scores; the within-noise framing lives downstream in diffReports/Trajectory (engine.ts:466), NOT in the model's own output. So at the assess() boundary there's nothing tagging a guardband-magnitude wobble as noise. For my renewal read, a +2 that's really model variance is the exact vanity metric I'm paid to see through.",
    "evidence": ["engine.ts:99-102", "engine.ts:466", "maturity/model.ts:23"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "cost_delta": "n/a — this is a value/trust gap, not a token cost. But it's WHY the cost cuts T-C1/2/3 are safe: if a +2 wobble isn't real value anyway, a cheaper model that produces the same anchored score loses nothing I was counting.",
    "l2_priority": "Re-scan two near-identical commits twice each; does the headline wobble within the guardband, and is that wobble ever surfaced as 'within noise' before I'd count it? If not, the score move needs an explicit noise tag before it feeds a renewal memo."
  },
  {
    "id": "T-S1",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "tania-scaleup-costcut",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "cost",
    "title": "STRENGTH: honest billing — failed-attempt tokens are dropped, and per-model $ is computable in-app, so my renewal $/value number is defensible",
    "expected": "A cost-cutter needs the in-app $ to be an honest floor, not inflated by retries or priced at a made-up rate.",
    "got": "Usage commits tokens only on a USABLE attempt (failed attempts' tokens dropped — engine note scan.ts:206-219); cost is per-model from a dated price table with operator-env override (config.ts:39-55, db/usage.ts:240-243); unknown models price as null ('no estimate') rather than a guess (config.ts:65-74). I can build a $/actioned-move number without leaving the app.",
    "evidence": ["db/usage.ts:240-243", "config.ts:65-74", "config.ts:39-55"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "cost_delta": "n/a — protect this. It's the one thing that lets me defend the line to the CFO. The ONLY gap: it has no cache-read token class (T-C1), so it'll overstate the bill the day a cache lands."
  }
]
```

---

## Lens-C answer: **cheaper-holds (for the score), mid-floor (for roadmap + discrepancies)**

Split the verdict by part, because the guardband splits the value:

- **The score** → **cheaper-holds, decisively.** With ±25 clamp × 0.6 blend (`engine.ts:99-102`, `maturity/model.ts:16,23`), the LLM moves the headline at most ±15pt, and downstream that mostly washes against the 40% deterministic anchor. gpt-4o-mini / gemini-flash / haiku all clear my bar on the *number* — I would not pay sonnet for scoring. **A premium model changes the score by noise, not value.**
- **The summaries** → cheaper-holds, with a shrug. Minor prose degrade on haiku, below my renewal-relevance threshold.
- **The roadmap + discrepancy audit** → **mid-floor.** These are the unbounded, reasoning parts (`prompt.ts:124-141`). The cheap-tier hypothesis (engine note Lens C) is that the roadmap drifts generic and discrepancy-catching drops — that's the one place a skeptic (Sam/Mariam) would reject, so sonnet is the right floor *here*. **opus/thinking helps only the discrepancy audit on a complex repo** — wasted on everything else, and there's no knob to scope it (`config.ts` has temperature/maxTokens only).

**Rough `cost_delta` of the optimal config** (sonnet baseline = 1.0×):
1. Prompt-cache the stable prefix (T-C1): **−30 to −45%** total, zero quality risk, biggest single lever.
2. Two-model split — cheap for score/summaries, sonnet for roadmap/discrepancies (T-C2): **−15 to −30%** on top, near-zero quality risk *if* the cheap call gets trimmed input.
3. Shrink+rank the excerpt window 22→13KB (T-C3): **−15 to −25%** of input, but only safe paired with relevance ranking (else the audit degrades).

Stacked, a weekly-cadence fleet lands roughly **40-60% below the current sonnet-everything bill with no Character rejecting the output.** Premium (opus/thinking) would *raise* the bill and only move the discrepancy audit — not worth it for my renewal read.

---

## Character feedback (Tania, first person)

**Would I trust this number?** Yes, grudgingly — and *specifically because* it's guardbanded. The score is anchored to deterministic signals and the model only nuances ±15 of the headline (`engine.ts:99-102`). That's the opposite of a vanity metric: a cron-driven re-scan of the same commit doesn't even call the model (`scan-cache.ts`), and the model can't run away from the evidence. I'd stake a renewal memo on the headline.

**Would I paste the badge?** The score, yes. The $ next to it, yes — `/usage` gives me a per-model `estimatedCostUsd` I can defend (`db/usage.ts:240-243`), and failed-attempt tokens are dropped so it's an honest floor, not retry-inflated. That's rare and I'm noting it as the renewal-saver it is.

**Is the roadmap one I'd run?** On sonnet, yes — it's the part actually worth the model spend. On haiku I'd expect it to go generic, so I keep the strong model *there* and cut everywhere else.

**Is it worth the wait/cost?** The *value* is. The *cost* is padded: I'm paying sonnet input price for the same rubric+schema prefix on every distinct commit (`bedrock.ts:68-92`, no `cachePoint`), and paying premium for guardbanded scoring the model barely touches. That's the exact "seats nobody proved were idle" smell — money spent where it can't move the number. I'd cut it 40-60% before I'd cut the subscription.

**The ONE engine change I want:** a **prompt-cache breakpoint after the stable prefix** (T-C1). It's the largest avoidable token cost, it's zero-quality-risk (not one output token changes), and it stacks with everything. Second: teach `db/usage.ts` the cache-read token class so my $ number stays honest after the cache lands.

**Would I tell a peer?** "Renew it — but make them turn on prompt-caching and stop paying Opus prices for a score the engine clamps anyway. The value's real; the bill's lazy."

---

## Scorecard

- **Grounding:** **3 / 5** (strong signal anchoring + commits + excerpts; missing value-realization memory in the *output* and a cache-aware billing token class).
- **Per-use time-saved:** my renewal read collapses from a ~3-4hr manual reconstruction to **~5-10 min** *because* the $ and the score are both in-app and honest — net **~3 hours saved per renewal cycle**, and it replaces gut-feel with a defensible number. The cost angle doesn't add time; it protects the *margin* on a tool I'd otherwise have to justify line-by-line.
- **Engine verdict:** **fix-then-ship.** The output is senior-grade and the score is trustworthy. Ship the verdict; but the LLM bill is leaking on the input axis (T-C1/T-C2/T-C3) and the leak is invisible by design — fix the prompt-cache first, then ship the cost-optimal config.

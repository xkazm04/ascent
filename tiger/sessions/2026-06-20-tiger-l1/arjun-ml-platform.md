# Tiger L1 — Arjun (ML Platform Lead) × scan-assess

**One-line verdict:** The model machinery is genuinely well-built (forced structured output, honest billing, guardband), but the model is asked to judge my notebook fleet with **zero ML-awareness** — the new stack-fit caveat is bolted onto `report.warnings` *outside* the model and never reaches the prompt — so the roadmap and discrepancy audit, the only parts a premium model would improve, are improving the wrong rubric. **Fix-first**, and the fix is a prompt-input change, not a model upgrade.

---

## Angle & reachable output

I am the prime **Lens-C** judge: model choice + structured-output discipline. My angle: given scoring is guardbanded (`engine.ts:99-102`, ±25 / 60-40), is the default tiering (sonnet dev / gemini-3-flash MVP / sonnet-4-6 enterprise) over-provisioned for SCORING but right-sized for the ROADMAP + DISCREPANCY audit? Is forced structured output done well? Is there a thinking-budget knob?

**Tier-honest reachable output:** Arjun is on **Team**, scans public-ish org repos → the live path is **gemini-3-flash** (`index.ts:138-143`, MVP/public default). In *this* sandbox there are no provider keys, so a real run degrades to the **MockProvider floor** (`scan.ts:289-292`) — the deterministic signal floor wearing the provider's name, with an honest `llmFailed` caveat (`scan.ts:322-325`). So what I can certify statically is: the **shape** of the model output, the **inputs that reach it**, and the **model-tier sensitivity** of each output part. The *content* quality is L2 (live-call) work.

The model produces (schema `src/lib/llm/schema.ts:27-79`): 9 calibrated dimension scores + summary/strengths/gaps; a headline; org strengths/risks; a 3-5 item invitational roadmap; a discrepancies auditor pass. My judgement is scoped to **those fields only**, not the dashboard around them.

---

## Surface-model notes (fresh file:line for my angle)

**Structured output discipline — strong, this is real engineering:**
- One schema source of truth `ASSESSMENT_JSON_SCHEMA` (`schema.ts:27-79`), derived from `DIMENSIONS` so the request schema can't drift from the rubric (`schema.ts:16,37`).
- **Bedrock** forces it via a single required tool + `toolChoice` (`bedrock.ts:80-91`) — genuine function-calling, not prompt-and-pray. **Gemini** forces it via native `responseJsonSchema` (`gemini.ts:54`). Same schema both paths.
- Defensive coercion `validateAssessment` never throws (`provider.ts:101-184`): caps field length (`MAX_FIELD_LEN=2000`, `:59-60`), bounds array count + dedupes dimensions by id (`:112-115`), drops out-of-range/downgrade `levelUnlock` (`:82-88`), drops roadmap entries with an unparseable dimension rather than mis-tagging them to D1 (`:147-151`). This is mature anti-bloat / anti-injection discipline.
- Tool-input-as-string repair with a fall-through to the text path (`bedrock.ts:111-122`) — a real edge case handled correctly.
- Coverage gate: a parseable-but-empty reply (<50% dims) is treated as a *failure*, not rendered as truth (`provider.ts:205-209`, `scan.ts:213-217`). Honest.

**Model selection:** `LLM_PROVIDER` flag → `getProvider` (`index.ts:119-144`); default `auto` = gemini-if-key-else-mock (`:140-143`). Failover plan primary→retry→`LLM_FALLBACK_PROVIDER`→mock (`scan.ts:244-293`), each step env-gated by `providerAvailable` so a doomed attempt is skipped (`index.ts:84-117`). The provider that actually scored becomes the report engine (`scan.ts:263,297`). Clean.

**Thinking-budget knob — ABSENT (confirmed).** `config.ts` exposes only `LLM_TEMPERATURE` and `BEDROCK_MAX_TOKENS` (`config.ts:8-13`, used at `bedrock.ts:74-75`, `gemini.ts:50`). A repo-wide grep for `thinking|reasoning_effort|thinkingBudget|budget_tokens` finds **no** call-site usage — only docs/tiger notes. So the one sub-task that genuinely benefits from reasoning (the discrepancy audit) has no dial to turn it up, and no way to turn it *off* on the 8 sub-tasks that don't need it.

**The load-bearing find for my angle — stack-fit never reaches the model.** A `detectStackFit` module now exists (`stack-fit.ts:51-93`) and *correctly* recognizes `.ipynb` (`:57-58`) and emits an ML caveat (`:22`). BUT it is called at `scan.ts:338` — **after** `assembleReport` at `:304` — and its only effect is `warnings.push(stackFit.caveat)` (`:339`) onto `report.warnings`, a UI string. It is **not** in `LlmScoreInput` (`provider.ts:24-36`) and not in `buildAssessmentPrompt` (`prompt.ts:67`). The `archetype` that *does* reach the model (`scan.ts:174,181`) is classified by stars + CODEOWNERS + workflow-count only (`index.ts:727-735`) — **language/stack never enters.** So the model scores, summarizes, roadmaps, and audits my notebook repo against the unchanged 9-dim web rubric (D2 Testing 15-17%, D3 CI/CD 11-14% in every lens, `model.ts:204-206`), and a caveat is stapled on outside. **Exists in code ≠ reaches the model output.**

---

## Findings

```json
[
  {
    "id": "T-AR1",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "Stack-fit is computed but never reaches the model — the roadmap/discrepancy audit still judges notebooks on the web rubric",
    "expected": "If the repo is ML/notebook, the LLM that writes the roadmap and discrepancy audit should KNOW it, so it frames missing unit tests / CI / conventional commits as not-applicable-for-research rather than as the highest-leverage gap to close.",
    "got": "detectStackFit recognizes .ipynb and produces an ML caveat (stack-fit.ts:22,57-58), but it is called AFTER assembleReport (scan.ts:338 vs :304) and only pushed onto report.warnings (scan.ts:339). It is absent from LlmScoreInput (provider.ts:24-36) and buildAssessmentPrompt (prompt.ts:67). The archetype that reaches the model is stars+CODEOWNERS+workflows only (index.ts:727-735) — stack never enters. So the model still writes 'add automated testing / adopt conventional commits' as a top move on a training repo; the caveat is a UI band-aid the model output never saw.",
    "evidence": ["src/lib/scan.ts:304", "src/lib/scan.ts:338", "src/lib/scan.ts:339", "src/lib/scoring/prompt.ts:67", "src/lib/llm/provider.ts:24", "src/lib/analyze/index.ts:727", "src/lib/analyze/stack-fit.ts:22"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Run the live path (gemini-flash or claude-cli) on a real .ipynb-dominant repo: does the roadmap's top entry recommend web-dev hygiene (tests/CI/conventional commits) as the highest-leverage move, and does the discrepancy audit miss that notebook cells ARE the work? Then re-run with stackFit.caveat threaded into the prompt system message and diff the roadmap."
  },
  {
    "id": "T-AR2",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "cost",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "low" },
    "dimension": "cost",
    "title": "Scoring tier is over-provisioned by design; the roadmap/discrepancy audit sets the model floor, but neither is stack-aware so the premium is wasted on the wrong rubric",
    "expected": "Pay mid-tier (sonnet/gpt-4o) only where the unbounded value lives (roadmap + discrepancy reasoning); let the guardbanded score ride a cheaper tier since the engine clamps the LLM ±25 and blends 60/40 regardless.",
    "got": "The guardband (engine.ts:99-102, LLM_GUARDBAND=25, SCORE_BLEND=0.6 at model.ts:16,23) makes the SCORE nearly model-insensitive — a cheap model holds it. The roadmap+discrepancies are the model-sensitive parts and DO justify mid-tier. But because stack-fit never reaches the prompt (T-AR1), upgrading to opus buys a sharper roadmap against a rubric that still penalizes notebooks — paying premium to be precisely wrong for Arjun's fleet.",
    "evidence": ["src/lib/scoring/engine.ts:99", "src/lib/maturity/model.ts:16", "src/lib/maturity/model.ts:23", "src/lib/scoring/prompt.ts:124"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "model_variant": "gemini-3-flash (MVP default) vs sonnet vs opus",
    "quality_delta": "score: ~0 across tiers (guardband absorbs it). roadmap: cheap→mid is a real lift (generic→specific); mid→premium marginal. discrepancies: cheap drops catches, premium+thinking best — but all tiers blind to ML stack until T-AR1 is fixed.",
    "cost_delta": "gemini-3-flash $0.5/$3 vs sonnet $3/$15 (6x in / 5x out) vs opus $5/$25. Input-heavy prompt (~22KB excerpts + rubric + schema), so input price dominates; the per-scan delta is real on a 40-repo monthly fleet (~480 scans/yr).",
    "l2_priority": "Benchmark matrix rows 2 (gemini-flash), 4 (sonnet), 6/7 (opus ± thinking) on a fixed ML repo: does the roadmap quality gap between flash and sonnet move Arjun's verdict, or does the missing ML-awareness dominate both?"
  },
  {
    "id": "T-AR3",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "cost",
    "title": "No thinking-budget knob — the one reasoning sub-task (discrepancy audit) can't be sharpened, and the 8 non-reasoning sub-tasks can't be made cheaper",
    "expected": "A scoped thinking/reasoning-effort dial so the discrepancy audit (genuine reasoning over file evidence — exactly where a detector that misread notebooks as untested would get caught) can be turned up, while scoring/summarizing run cheap.",
    "got": "config.ts exposes only LLM_TEMPERATURE and BEDROCK_MAX_TOKENS (config.ts:8-13). No thinking/reasoning_effort/budget_tokens param at any call site (repo-wide grep: zero hits in src/). Bedrock ConverseCommand inferenceConfig carries only temperature+maxTokens (bedrock.ts:73-75); Gemini config likewise (gemini.ts:48-56).",
    "evidence": ["src/lib/llm/config.ts:8", "src/lib/llm/bedrock.ts:73", "src/lib/llm/gemini.ts:48"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "model_variant": "sonnet+low-thinking vs sonnet (matrix row 5)",
    "quality_delta": "Predicted: thinking sharpens discrepancies (catching detector misses — the audit that would notice notebooks ARE the work) for ~same token cost; wasted on the other 8 sub-tasks. Untestable until the knob exists.",
    "cost_delta": "Thinking tokens bill as output ($15/MTok sonnet, $25 opus). Scoped to the audit (a small sub-task) the delta is small; applied to the whole monolithic call it would be wasteful — which is the argument for scoping it.",
    "l2_priority": "Once a knob exists, benchmark sonnet vs sonnet+low-think on a repo with a known detector miss (e.g. tests present but signal=0): does thinking raise the discrepancy catch-rate enough to justify the output-token cost?"
  },
  {
    "id": "T-AR4",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "arjun-ml-platform",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — forced structured output, honest billing, and the guardband are genuinely senior-grade; protect them",
    "expected": "Schema-constrained decoding (not prompt-and-pray), never-throw validation, usage committed only on a usable attempt, and a score the LLM can't blow up.",
    "got": "Single-source schema both providers force (schema.ts:27-79; bedrock.ts:80-91 tool-use; gemini.ts:54 responseJsonSchema). validateAssessment caps/bounds/dedupes/range-checks without throwing (provider.ts:59-88,112-160). Usage committed only after the usability check (scan.ts:211-218) — a failed attempt's tokens are dropped, so Arjun is never billed for an attempt that degraded to mock. Guardband ±25/60-40 means LLM wobble can't masquerade as his team's progress month-over-month (engine.ts:99-102).",
    "evidence": ["src/lib/llm/schema.ts:27", "src/lib/llm/provider.ts:101", "src/lib/scan.ts:211", "src/lib/scoring/engine.ts:99"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  }
]
```

---

## Lens-C answer

**cheaper-holds for the score · mid-floor for the roadmap · premium doesn't change MY verdict (because the rubric is the bottleneck, not the model).**

- **Score:** model-insensitive. The guardband (`engine.ts:99-102`) clamps the LLM ±25 and blends 60/40, so gemini-3-flash, sonnet, and opus land within a point or two on the same repo. **Cheaper holds.** Paying for opus here is pure waste — `cost_delta` opus-vs-flash ≈ **10x input / 8x output** for a number the engine would have produced anyway.
- **Roadmap:** model-sensitive — cheap→mid is a real lift (flash writes plausibly generic "explore your test coverage" filler; sonnet writes something a senior would act on). This is the one part that justifies the current sonnet/gemini default. But for *Arjun specifically* this lift is spent on a web rubric: a sharper roadmap that still leads with "adopt conventional commits" on a training repo is sharper garbage. `cost_delta` flash→sonnet ≈ **6x in / 5x out**.
- **Discrepancies:** the only genuine reasoning sub-task; premium + thinking would help most (catching detector misses — e.g. that notebook cells are the work, not emptiness). This is where opus/thinking earns its `cost_delta`. But there's no thinking knob (T-AR3), and even premium can't catch what it was never told to look for (no ML signal in the prompt).

**Net:** the model frontier is real for two of five output parts, but for Arjun the binding constraint is **stack-awareness in the prompt input, not model tier.** Threading `stackFit.caveat` into the system prompt is a ~$0 change that would do more for his roadmap quality than a flash→opus upgrade (≈10x cost).

---

## Character feedback (Arjun's voice)

Okay — credit where it's due. The plumbing is the best I've seen on a tool like this. Structured output is *forced*, not begged for; the validator won't let a hallucinated "L5→L7" or a megabyte summary through; and — this one matters to me at renewal — you only bill me for the attempt that actually scored, not the two that timed out and fell back to the floor (`scan.ts:211-218`). The guardband means I can't quote my LLM breathing as a 3-point bump. That's the honest engineering I respect.

**Would I trust this number?** For the *score*, grudgingly yes — it's mostly deterministic and the LLM can't move it much. But trust isn't the number, it's the *story* around it. And the story is written by a model that doesn't know it's looking at a notebook repo.

**Would I paste the badge?** No. Not because the badge is wrong, but because the roadmap that ships with it tells my research org to "add automated testing and adopt conventional commits" — on training code — and my VP will read that as the tool's top recommendation. I found your `detectStackFit` and I almost cheered — it *recognizes* `.ipynb`, it *names* the blind spot. And then I followed it and it dies in `report.warnings`. The model that writes my roadmap never saw it (`prompt.ts:67`). You built the right organ and didn't wire it to the brain. That's worse than not having it, because it looks like you handled it.

**Is the roadmap one I'd run?** Not as-is. A web-shop rubric wearing an ML costume. The fix isn't a bigger model — I pick models for a living, and opus here would just be precisely wrong faster.

**Worth the wait/cost?** The cost question is almost moot: you're over-paying on the score (guardbanded, flash would do) and the premium tiers can't fix the one thing I care about. Spend the money you'd save on opus on *one line of code* that puts the stack caveat in the prompt.

**The ONE engine change I want:** thread `stackFit` into `LlmScoreInput` + the system prompt so the model frames not-applicable web guardrails as *floor, not verdict* — and ideally classify an ML archetype so the model is *told* "judge D2/D6 as a floor here." Free. Highest-leverage thing on this list.

**Would I tell a peer?** Today: "great engine, wrong rubric for us, watch the roadmap." After that one wire-up: "okay — it didn't penalize me for the wrong things." That's my highest compliment and you're one input-field away from it.

---

## Scores

- **Grounding: 3/5.** Repo-meta, all 9 deterministic signals + evidence, process signals (token-gated), commit sample, and ~10 file excerpts all reach the prompt (`prompt.ts:103-121`) — strong for a single scan. **Docked 2** for what a senior ML lead demands and doesn't get: (1) the **stack-fit signal is computed and withheld from the model** (`scan.ts:338` vs the prompt) — the single most relevant context for *my* repo never reaches the output; (2) **no memory** — the prompt carries no "what changed since last scan," so my monthly recurring-value question is answered by the deterministic trend engine, not the model.
- **Per-use time-saved: net-negative as shipped → ≈ +3.5 hrs/cycle once stack-fit reaches the model.** My motivation math: ~4 hrs/month by hand. A trustworthy ML-fitting read saves ~3.5-4 hrs. But a confidently-stack-mismatched roadmap I have to mentally re-translate ("ignore the testing finding, that's noise for us") adds a debunking step — it **inverts** the saving. The caveat in `warnings` softens this but doesn't fix the roadmap content, which is the part I'd hand to my VP.
- **Engine verdict: fix-then-ship.** The model machinery is ship-grade; the *input wiring* is not. Thread `stackFit` (and an ML archetype) into the prompt before this is senior-grade for an ML fleet. It is a prompt-input fix, not a model-tier fix — which, from the Lens-C chair, is the whole point.

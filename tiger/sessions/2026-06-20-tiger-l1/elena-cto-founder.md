# Tiger L1 — Elena (CTO / Founder) × scan-assess

**One-line verdict:** *Fix-first.* The output is worth the wait — but the wait is sold with a frozen 72% bar and a stable-prefix prompt that re-bills full price every scan, so I'd halve both before I scan my fleet on a cadence.

---

## Angle & reachable output

My angle is **latency + cost + is-the-output-worth-the-wait** (Lens B value, Lens C model-fit). I'm the buyer *and* the hands-on user: I sign the AI-tooling invoice and I'll re-scan 30–80 repos on a cadence, so the per-scan token bill and the per-scan wall-clock both land on me at fleet scale, not once.

What I actually judged is the **model-produced** part of the report: the per-dimension nuance (summaries/strengths/gaps), the headline, org strengths/risks, the **3-5 item invitational roadmap**, and the **discrepancies** auditor pass. Tier-honest note: in this local-dev env the only live engine is `claude-cli` (subscription-auth, 30-130s/call, `tiger/models.md:40`); the public/MVP default is `gemini-3-flash` and enterprise is `us.anthropic.claude-sonnet-4-6` (`bedrock.ts:26`). On a real private scan I'd be on Bedrock/Sonnet — that's the latency/cost I price below. If the model fails, what I'd actually see is the **mock floor** rendered with an honest `llmFailed` caveat (`scan.ts:279,322-326`), i.e. deterministic scores + a fallback roadmap, no nuance.

## Surface-model notes (latency/cost affordances → fresh `file:line`)

- **Per-call timeout 60s**, AbortController-cancelled, shared across providers — `bedrock.ts:28,57-64`. A hung Converse is killed at 60s, not left to bleed the budget.
- **Total LLM budget 90s** across primary + retry + failover, a *distinct* deadline signal from the client signal so budget-expiry degrades to mock while a real disconnect unwinds — `scan.ts:36,237-242`. Sits under the route's **`maxDuration = 120`** (`api/scan/stream/route.ts:17`) so mock-degrade always runs before the platform hard-kill. This is genuinely well-engineered: my worst case is a bounded ~90s of model wait then a deterministic floor, never a 500.
- **Retry (fixed 500ms backoff) → failover provider → mock** — `scan.ts:32,243-293`. Three attempts can *multiply* (the code comment itself flags ~181s naive), which is exactly why the 90s total cap exists. Good.
- **Streaming progress is real but checkpoint-faked.** `onProgress` is wired to SSE `send("progress", p)` (`stream/route.ts:152`) with a 15s keepalive ping (`:111`). But the stages carry **hardcoded `pct`**: 10→28→45 (`github/source.ts:349,352,411`) → 62 → **72 ("Scoring with sonnet…")** → 80 (only on retry) → 95 → 100 (`scan.ts:164,189-196,260,303,342`). There is **no ETA, no elapsed, no seconds-remaining** anywhere (`grep eta|estimat|remaining|elapsed` → nothing in the scan path). So through the single longest leg — the 30-130s model call — the bar **sits frozen at 72% with one static label**. That's the seam between "honest streaming" and latency theater.
- **No prompt-caching, anywhere.** `cachePoint` / `cache_control` = **0 hits repo-wide**. The stable, large prefix (system + full rubric + JSON schema + instructions, `prompt.ts:46,101-151`) plus up to 22KB excerpts is re-sent **full input price on every scan of every distinct commit** (`bedrock.ts:68-95`, no cachePoint). Input dominates this prompt (`models.md:21`).
- **Whole-scan cache saves me the repeat.** A re-scan of an *unchanged* commit skips the LLM entirely (`stream/route.ts:132-145`) and a degrade-to-mock or low-coverage run is refunded + not cached (`:170-179`). So the cost/wait I'm pricing is **per changed commit**, which is the honest unit — but on a fleet that's still hundreds of cold calls a week.
- **Guardband ±25, blend 0.6** (`maturity/model.ts:16,23`) — the score barely moves with the model. So my cost is buying **roadmap + discrepancies quality**, not score accuracy.

## Grounding audit (Lens B) — **4/5**

For *one* scan the grounding is strong: repo-meta, all 9 deterministic signals + evidence, token-gated PR/governance, 15 commits, file excerpts (`prompt.ts:103-121`). I dock one point on **the axis my job cares about most: repeated, fleet, over-time reads.** The prompt carries **no memory** — no "what changed since last scan", no prior assessment, no team-stated goal. Every cadence re-scan re-judges my repo cold and re-pays full input price to do it (the no-cache finding is the cost face of the same no-memory gap). As a CTO tracking whether my org is *moving*, a roadmap that can't see last quarter's roadmap is a weaker product than the token bill implies. The 22KB excerpt window (~10 files for a large repo) is the depth cap the skeptics will hammer; for *my* value question it's secondary to memory.

## Findings

```json
[
  {
    "id": "T-EL-1",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "elena-cto-founder",
    "cert_level": "L1",
    "type": "cost",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "cost",
    "title": "No provider prompt-caching — the stable rubric+schema prefix is re-billed full price on every fleet scan",
    "expected": "The large invariant prefix (system + rubric + JSON schema + instructions, ~the bulk of input tokens) is cached via Bedrock cachePoint / Anthropic cache_control, so a cadence re-scan of a fleet pays ~10% input on the prefix.",
    "got": "cachePoint/cache_control appear nowhere (0 hits repo-wide). buildAssessmentPrompt's stable prefix is re-sent at full input price on every distinct commit; input price dominates this prompt.",
    "evidence": ["src/lib/llm/bedrock.ts:68-95", "src/lib/scoring/prompt.ts:46,101-151", "tiger/models.md:21"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "model_variant": "sonnet (unchanged) + cachePoint",
    "quality_delta": "0 (identical output; pure cost change)",
    "cost_delta": "≈ -50% to -75% of input tokens on the cached prefix for any fleet re-scanned on a cadence; on an input-heavy prompt that's roughly a third-to-half off the per-scan bill",
    "l2_priority": "Add a Bedrock cachePoint after the rubric/schema prefix and measure cached vs uncached input tokens on two back-to-back scans of two different commits of the same repo."
  },
  {
    "id": "T-EL-2",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "elena-cto-founder",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "effort",
    "title": "Progress bar freezes at 72% through the entire 30-130s model call — streaming is stage-labeled but the longest leg has no motion or ETA",
    "expected": "During the LLM call (the single longest leg) the user sees motion or a time estimate, so a hands-on founder doesn't conclude it hung and bail.",
    "got": "pct is hardcoded per stage (62→72→[80 only on retry]→95). The 'Scoring with sonnet…' frame sits at pct:72 for the whole model call; no eta/elapsed/remaining exists in the scan path. The only liveness signal is a 15s SSE keepalive ping the user never sees.",
    "evidence": ["src/lib/scan.ts:189-196", "src/app/api/scan/stream/route.ts:111,152", "src/lib/github/source.ts:349,352,411"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Watch a real Bedrock scan of a medium repo: does the bar visibly stall at 72% for >30s? Time-box how long before a impatient user assumes it hung."
  },
  {
    "id": "T-EL-3",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "elena-cto-founder",
    "cert_level": "L1",
    "type": "cost",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "cost",
    "title": "Scoring is guardbanded ±25 / blended 0.6 — paying a mid-tier model to move a near-fixed number; the spend only buys roadmap + discrepancies",
    "expected": "If the score is what I'm paying for, a cheaper model would degrade it. It isn't: the LLM is clamped ±25 around the deterministic score and blended 60/40, so the score is nearly model-insensitive — the model's only unbounded value is the roadmap and the discrepancy audit.",
    "got": "LLM_GUARDBAND=25, SCORE_BLEND=0.6 (model.ts). So a cheaper model holds the score; the question is purely whether it holds roadmap/discrepancy quality. The cost decision should be made on those two sub-tasks, not the headline.",
    "evidence": ["src/lib/maturity/model.ts:16,23", "src/lib/scoring/engine.ts:96-102"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "model_variant": "gemini-3-flash / haiku vs sonnet",
    "quality_delta": "score ≈ 0; roadmap predicted -1 tier (drifts generic); discrepancies predicted -1 to -2 (genuine reasoning sub-task)",
    "cost_delta": "gemini-3-flash input $0.5 vs sonnet $3 = ~6× cheaper on input; haiku $1 = 3× cheaper",
    "l2_priority": "Run gemini-3-flash and haiku on a real repo against sonnet — does the roadmap go generic and does discrepancy-catching drop on a repo with a known detector miss?"
  },
  {
    "id": "T-EL-4",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "elena-cto-founder",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "No memory across scans — every cadence re-scan re-judges cold (and re-pays full input), so the roadmap can't track whether my org is actually moving",
    "expected": "A fleet read I run on a cadence should know its own prior roadmap / last score / stated team goal, so it can say 'you closed D3, here's the next gap' — the over-time movement is the whole point for a CTO.",
    "got": "The prompt carries no prior assessment, no diff-since-last-scan, no goal. diffReports exists in the engine (engine.ts:466) but is post-hoc display, never fed back into the prompt. Each scan is stateless — which is also why the prefix can't be cached.",
    "evidence": ["src/lib/scoring/prompt.ts:63-122", "src/lib/scoring/engine.ts:466"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Re-scan the same repo twice unchanged: does the score wobble inside the guardband, and is the lack of 'what changed' surfaced anywhere the user sees?"
  },
  {
    "id": "T-EL-5",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "elena-cto-founder",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: honest billing + bounded wait — failed-attempt tokens dropped, degrade-to-mock refunded, 90s cap under the 120s platform kill",
    "expected": "A bounded wait that never 500s, and a bill I can trust (no charge for an attempt that degraded to the floor).",
    "got": "capturedUsage commits only on a usable attempt (scan.ts:206-219); degrade-to-mock and low-coverage runs are refunded and not cached (stream/route.ts:170-179); 90s total budget sits under the 120s maxDuration so mock always renders. This is the part I'd stake my name on.",
    "evidence": ["src/lib/scan.ts:206-219,237-242", "src/app/api/scan/stream/route.ts:170-179"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "n-a (protect this — don't regress the usable-only usage commit or the refund rules)"
  }
]
```

## Lens-C answer — **mid-floor (with a strong caching caveat)**

**The score holds on a cheaper model; the roadmap and discrepancies do not — and that's the only part I'm actually paying for.** Because scoring is guardbanded ±25 / blended 0.6 (`model.ts:16,23`), `gemini-3-flash` or `haiku` keep the headline within the band and write acceptable summaries. But the **roadmap drifts generic** on the cheap tier (it stops reading *my* repo and starts reading any repo — which is exactly the horoscope I reject on sight) and the **discrepancy audit weakens** (it's the one genuine reasoning-over-evidence sub-task). Sonnet is the right floor for a roadmap I'd run in front of my board. A **premium** model (opus / sonnet+thinking) would help **only the discrepancy audit on a complex repo** — wasted on the score and the summaries — so I'd reach for it surgically, not as a default.

The bigger Lens-C lever isn't the model, it's **caching**: keep sonnet, add a `cachePoint` after the stable prefix, and cut roughly **a third to half off the per-scan input bill** at zero quality cost (`cost_delta` in T-EL-1). On a fleet re-scanned weekly that dominates any cheap-model saving — and it doesn't make me trade away the roadmap quality that's the whole reason I'm here. Rough `cost_delta`: caching ≈ **−50% input**, no quality delta; dropping to flash ≈ **−6× input** but **−1 roadmap tier**, which fails my senior bar.

## Character feedback (in my voice)

**Would I trust this number?** Yes — and partly *because* it's guardbanded. The score is anchored to deterministic signals, the model only nuances it, and the bill is honest (failed attempts don't charge me). I can answer "says who?" from the cited evidence. That clears my bar.

**Would I paste the badge?** For a public repo, yes. For my private fleet, only once I've confirmed the Bedrock no-training in-boundary path — which is a different Character's gate, but I note the engine *does* route to `us.anthropic.claude-sonnet-4-6` in-region (`bedrock.ts:26`), so the plumbing's there.

**Is the roadmap one I'd run?** On sonnet, provisionally yes — the invitational framing (`prompt.ts:129-136`) is more useful to me than imperatives, and it's tied to cited gaps. On a cheaper model I expect it to go generic and I'd reject it. That's my single biggest uncertainty and the top L2 call.

**Is it worth the wait/cost?** The honest manual alternative is the multi-week Jellyfish maturity loop I will *never run*, or an afternoon of biased clicking. So **~60-90s of bounded wait per changed commit to replace an afternoon of my own skim is an easy yes** — *if* the bar isn't frozen. Right now it sits at 72% through the whole model call with no ETA, and as the impatient founder you described, **I will assume it hung and bail.** Fix that and the wait is a non-issue.

**The ONE engine change I want:** add **prompt-caching on the stable prefix** (T-EL-1). It halves the only recurring cost I care about — my fleet token bill — with *zero* change to the output I'm buying. The frozen-bar fix (T-EL-2) is the close second and cheaper to ship; do both.

**Would I tell a peer?** Yes, with one sentence: "the scan itself is honest and well-bounded — just know it'll look frozen for a minute mid-scan, and tell your finance person to ask them about prompt-caching before you point it at a hundred repos."

---

**Grounding score:** **4/5** (strong for one scan; docked for no cross-scan memory — the axis a fleet-owning CTO weights most).
**Per-use time-saved (number):** **~3-4 hours** per repo vs my own focused-afternoon skim (and effectively **weeks** vs the maturity-loop audit I'd otherwise skip), for a **~60-90s** bounded wait per changed commit.
**Engine verdict:** **fix-then-ship** — ship the bounded, honest core as-is; fix the frozen 72% bar and add prefix prompt-caching before this goes near a CTO's fleet on a cadence.

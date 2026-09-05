# Tiger L1 — Mariam (Fintech Audit) × scan-assess

**Verdict: fix-first.** The number is reproducible *only* while the SHA-keyed cache is warm; past that, the same commit can re-score with bounded-but-invisible LLM wobble that nothing flags as noise — and there is no audit trail of what the model was asked or answered. The tamper-evidence layer (per-row HMAC + CSV content hash) is genuinely examiner-grade and a real surprise to the upside; the determinism story underneath it is not yet defensible.

---

## Angle & reachable output

I judge **determinism & defensibility** of the model-produced output, as the person who signs the quarterly evidence pack. The parts of the `assess()` output that reach *my* artifact: the 9 blended **scores** (the headline number on the badge), the **discrepancy audit** (the model's "the detector is wrong here" pass), and the **history/CSV export** I'd attach. Tier-honest: as a Team customer scanning with a token I get the real sonnet/gemini path (`default_model` enterprise = `us.anthropic.claude-sonnet-4-6`), not the mock floor — so the number I'm certifying is a *live* model number, which is exactly why its reproducibility matters.

My three questions, answered against code:
1. **Same repo twice = same score?** Only inside the cache window. Outside it, no — and nothing tells me it moved on noise vs signal.
2. **Can I trace the number to evidence?** Partially — the discrepancy audit and signal evidence persist; the prompt and raw response do not.
3. **Is the export defensible?** The artifact integrity is good (hash + HMAC). The *retention window behind it* is enforced in one read path and silently not in the one I'd export from.

## Surface-model notes (fresh file:line for my angle)

- **Guardband + blend (the determinism envelope):** LLM clamped to ±25 of the deterministic signal, blended 60/40, then `Math.round` — `engine.ts:99-102`; constants `LLM_GUARDBAND = 25`, `SCORE_BLEND = 0.6` (`maturity/model.ts:16,23`). So within a 50-point band per dimension, the model moves the number freely and *non-deterministically*.
- **Temperature is non-zero on every provider:** `envNumber("LLM_TEMPERATURE", 0.2)` — `bedrock.ts:74`, `gemini.ts:50`, `openai.ts:48`. 0.2 is low, not 0. Two cold scans of the same commit will *not* be bit-identical.
- **Re-scan wobble is bounded by the cache — but the cache is time-boxed.** Same `owner/repo@{sha}::{llm|mock}` key returns the identical prior report (`cache.ts:51-59`, `scan-cache.ts:114`) **only while fresh** — `isPersistedScanFresh` defaults to a 7-day window (`scan-cache.ts:34-40,127-130`), and low-coverage scans (<0.5) are *not* cached (`scan-cache.ts:179`). So a quarterly re-pull (>7 days later) of an unchanged commit re-hits the model and can land a different number.
- **No noise gate on the move.** `diffScans` (`report/compare.ts`) reports *any* non-zero delta as movement — sorts by `Math.abs(delta)`, no R², no confidence interval, no flat-floor. A +1 wobble renders the same as a +25 real gain. `confidence` (coverage) is carried on the point (`scans-read.ts:159,171`) but never used to gate or annotate a delta.
- **No prompt/response capture — confirmed absent.** Persisted: blended scores, summaries, evidence, gaps, strengths, **discrepancies** (`scans-persist.ts:208`), token usage, latency. NOT persisted anywhere: the prompt text or the raw model JSON. Only *failures* log (`scan.ts:281`, one `console.error`). A usable-but-wrong assessment renders under the provider's name with zero trace.
- **Defensibility wins I did NOT expect (credit where due):** per-row **HMAC-SHA256** over the audit row folded into `meta._sig` (`audit-integrity.ts:58-71`), and a **SHA-256 content hash** on the CSV export via `x-ascent-content-sha256` (`audit-integrity.ts:94-96`, `history/route.ts:115`). The discrepancy audit pass survives round-trip (`scans-persist.ts:208` → `scans-read.ts:714`). These are real, examiner-shaped controls.
- **Retention asymmetry (my deciding control).** `retentionCutoff` exists as a non-destructive read floor (`plans.ts:126-129`) and IS applied to org-rollup trends (`org-rollup.ts:224`), and a destructive purge job enforces it too (`db/retention.ts`). But `getRepositoryHistory` — the function behind `/api/history` and my **CSV export** — has no `scannedAt` floor: the query is `where: { repoId: repo.id }`, take `limit` (`scans-read.ts:163`). The one path I'd actually export my evidence pack from does not read the retention window it sells me.

## Findings

```json
[
  {
    "id": "T-MAR-1",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Unbounded re-scan wobble outside the cache window, with no noise gate to distinguish it from a real move",
    "expected": "Re-pulling an unchanged commit next quarter yields the same number, or any move is explicitly marked 'within noise' (R²/flat-floor/CI) so I never certify weather as a trend.",
    "got": "Cache pins the number only for a 7-day freshness window (scan-cache.ts:34-40,127-130) and skips low-coverage scans (scan-cache.ts:179). Past that, temperature=0.2 (bedrock.ts:74) + ±25 guardband (engine.ts:99-102) re-roll the score. diffScans reports ANY delta with no significance gate (report/compare.ts, sorts by Math.abs(delta)). confidence is carried (scans-read.ts:159) but never gates a delta.",
    "evidence": ["src/lib/scan-cache.ts:34-40", "src/lib/scan-cache.ts:127-130", "src/lib/scan-cache.ts:179", "src/lib/llm/bedrock.ts:74", "src/lib/scoring/engine.ts:99-102", "src/lib/maturity/model.ts:16-23", "src/lib/report/compare.ts:1"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Re-scan one unchanged commit twice, >7 days apart (or with cache disabled), on the live sonnet path — measure the per-dimension and overall delta distribution. Is the wobble inside ±a few points, and would a naive trend reader mistake it for a move?"
  },
  {
    "id": "T-MAR-2",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "observability",
    "title": "No audit trail of what the model was asked or answered — the number is not reconstructable",
    "expected": "For each scored scan I can produce, on an examiner's request, the exact prompt the model saw and the raw response it returned — the provenance behind the number. Tamper-evident, retained for the observation window.",
    "got": "Only blended scores, summaries, evidence, discrepancies, token usage and latency persist (scans-persist.ts:206-210). The prompt text and raw model JSON are never logged or stored; only failures console.error (scan.ts:281). A usable-but-wrong assessment renders under the provider's name with zero trace. I cannot reconstruct or defend an individual number's provenance.",
    "evidence": ["src/lib/db/scans-persist.ts:206-210", "src/lib/scan.ts:281", "src/lib/scoring/prompt.ts:63-153"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Confirm on a live call that nothing downstream of provider.assess() writes the prompt/response (no hidden trace sink). Then scope: per-scan, persist prompt hash + raw response (signed, retention-bounded) so provenance is reconstructable without re-calling the model."
  },
  {
    "id": "T-MAR-3",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "broken-flow",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Retention enforced on org trends + purge, but NOT on the per-repo history/CSV export I'd actually file",
    "expected": "The retention window the pricing page sells (Team 365d) governs every read I export — a date floor on the history/CSV, not just the org dashboard. Enforced and attestable, per 2026 TSC.",
    "got": "retentionCutoff is a real read floor (plans.ts:126-129), applied to org-rollup trends (org-rollup.ts:224) and backed by a destructive purge (db/retention.ts). But getRepositoryHistory — the source for /api/history and the CSV export — has no scannedAt clamp: where:{repoId} take:limit (scans-read.ts:163). The one export path I file from doesn't read the retention window. Inconsistent enforcement reads as a phantom control on the surface that matters to me.",
    "evidence": ["src/lib/db/scans-read.ts:163", "src/app/api/history/route.ts:100-117", "src/lib/plans.ts:126-129", "src/lib/db/org-rollup.ts:224"],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "n-a (deterministic, not a model question) — but a live scan should confirm the CSV export returns scans older than the tier window for a Free/Team org."
  },
  {
    "id": "T-MAR-4",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "The discrepancy audit is the most defensible part of the output, but it never reaches the export I file",
    "expected": "When I show an examiner why D9 scored what it did, the model's auditor pass ('detector said 0 tests, files clearly show tests') should travel with the number into the evidence artifact.",
    "got": "Discrepancies are produced, validated, persisted and re-read (prompt.ts:138-141 → scans-persist.ts:208 → scans-read.ts:714) — genuinely the model's best reasoning. But historyToCsv emits only scannedAt/overall/level/engine + per-dimension scores; the discrepancy claims and evidence are dropped from the filed CSV (history/route.ts:38-51). My exported artifact carries the number without the model's own caveats about it.",
    "evidence": ["src/lib/scoring/prompt.ts:138-141", "src/lib/db/scans-persist.ts:208", "src/lib/db/scans-read.ts:714", "src/app/api/history/route.ts:38-51"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "On a live D9-heavy repo, check whether the discrepancy pass actually catches a seeded detector miss — if it does, it's worth surfacing in the export; if it goes generic, it isn't."
  },
  {
    "id": "T-MAR-S1",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — examiner-grade tamper-evidence on the filed artifact (HMAC rows + CSV content hash)",
    "expected": "Don't regress this.",
    "got": "Per-row HMAC-SHA256 folded into AuditLog.meta._sig with canonical key-sorting and timing-safe verify (audit-integrity.ts:46-87), plus a SHA-256 content hash on the CSV export header (audit-integrity.ts:94-96, history/route.ts:115). Inert-without-secret degrade is honest. This is the part I CAN put in front of an examiner — protect it.",
    "evidence": ["src/lib/db/audit-integrity.ts:58-96", "src/app/api/history/route.ts:115"],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "T-MAR-C1",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "mariam-fintech-audit",
    "cert_level": "L1",
    "type": "cost",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Cheaper model holds the guardbanded score but degrades the discrepancy audit — the one part I'd actually defend on",
    "expected": "If a cheaper tier is used, the part I lean on (the auditor pass that catches detector misses) must not go generic.",
    "got": "Scoring is guardbanded ±25 and blended 60/40 (engine.ts:99-102), so the headline is near-model-insensitive — a cheap model holds it. But the discrepancy audit is genuine reasoning over file excerpts (prompt.ts:138-141), and that is where cheap tiers (haiku/flash/4o-mini) predictably regress to vague claims. For my job the score being cheap-stable is irrelevant; the auditor pass sets the floor.",
    "evidence": ["src/lib/scoring/engine.ts:99-102", "src/lib/scoring/prompt.ts:138-141", "src/lib/llm/config.ts:39-55"],
    "code_check": "by-design",
    "verdict": "uncertain",
    "model_variant": "haiku (claude-haiku-4 $1/$5) vs sonnet default ($3/$15)",
    "quality_delta": "score: ~neutral (guardband absorbs it); discrepancy audit: predicted -1 tier (more generic, fewer real detector-miss catches); roadmap: -1 tier (drifts generic)",
    "cost_delta": "~-67% input / -67% output per scan (haiku vs sonnet); negligible vs the defensibility cost if the auditor pass goes generic",
    "l2_priority": "Run haiku vs sonnet on the same repo with a seeded detector miss — does haiku still catch it in discrepancies, or does the auditor pass go generic? That delta, not the score, decides the tier."
  }
]
```

## Lens-C answer

**mid-floor.** The score is guardbanded (`engine.ts:99-102`) so a cheaper model holds it within the band — but the score is *not* the part I stake my name on. The **discrepancy audit** (`prompt.ts:138-141`) is the one genuine reasoning sub-task in this output and the only piece that makes the number *defensible* ("the detector missed these tests, here's the file"). That is exactly where haiku / gemini-flash / gpt-4o-mini predictably regress to generic claims that wouldn't survive an examiner pulling the thread. So: **score cheaper-holds, discrepancies need-mid (sonnet floor)**. Premium (opus/thinking) would help *only* the discrepancy audit on genuinely complex repos and is wasted on the rest — a thinking-budget knob scoped to the audit alone (none exists; `config.ts` exposes only temperature/maxTokens) would be the right premium spend. Rough `cost_delta` for dropping to haiku: ~-67% per scan, which I would refuse — the savings are trivial against the cost of an undefendable audit pass.

## Character feedback (in my voice)

**Would I trust this number?** Inside the cache window, yes — same SHA, same row, byte-for-byte. The moment I re-pull next quarter past the 7-day freshness window, no: temperature's 0.2, not 0, and the ±25 band lets the model breathe. If the score breathes on an unchanged repo and nothing flags the move as noise, that's not evidence, that's weather. Show me the R² or the flat-floor on the delta, or stop calling a wobble a trend.

**Would I paste the badge?** For a current snapshot, with the SHA pinned and the cache warm — fine, that I could put in front of an examiner. As a *trend* across quarters, not until the move is distinguishable from noise.

**Is the roadmap one I'd run?** It's not my artifact — my artifact is the D9 read and the trajectory. The roadmap's invitational framing is pleasant but it's not what I file.

**Is it worth the wait/cost?** Yes, if the auditor pass holds — that's the 14 hours. But see below.

**The ONE engine change I want:** Persist, per scan, the prompt hash + the raw model response, signed and retention-bounded — and gate the trend delta on a noise floor so a guardband wobble can't read as a move. Right now I cannot reconstruct *why* a number is what it is (the prompt and response evaporate — `scans-persist.ts:206-210`, only failures log at `scan.ts:281`), and I cannot tell a real D9 movement from LLM weather. Those two gaps are the difference between an audit artifact and a pretty pre-read. Fix them and this is examiner-grade; the tamper-evidence layer (HMAC + CSV hash) is already there waiting for it.

**Would I tell a peer?** I'd tell them the tamper-evidence design is the real thing — surprisingly so. And I'd tell them to read the retention enforcement themselves before they certify anything, because the window the pricing page sells is enforced on the org dashboard and the purge job but *not* on the per-repo CSV they'll actually export (`scans-read.ts:163`). Show me the code path that clips the query — there isn't one on that route.

---

**Grounding score: 3.5/5.** The prompt itself is genuinely well-grounded for a single scan (all 9 signals + evidence, process signals, commits, file excerpts). I dock it for *my* job specifically: (1) no provenance trail — the grounding reaches the model but never reaches *me* to re-defend (prompt/response not persisted); (2) the retention window that should bound my trend read doesn't reach the export query; (3) no prior-scan memory, so each quarter is judged cold with no "what changed and is it real" signal. The grounding is strong going *into* the model and lossy coming *out* to the auditor.

**Per-use time-saved: ~2 hours, not the ~14 it could be.** Because the retention window isn't enforced on the export path and the trend move isn't noise-gated, I'd still hand-assemble the *defensible* version — so today this is a pretty pre-read worth ~2h, not the ~14h (16h→2h) the recurring read promises. Fix T-MAR-1/2/3 and it flips to the full ~14h.

**Engine verdict: fix-first.** Reproducibility and provenance are the two controls my certification rests on, and both are gaps — but they're additive fixes on top of a strong wrapping/integrity foundation, not a redesign. Not "not-yet"; genuinely "fix-then-ship."

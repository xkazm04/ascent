# Tiger L1 — Sam (Staff Engineer) × scan-assess

**Verdict: fix-first.** The score is re-traceable and I'd mostly trust it — the provenance track and ±25 guardband do real work. But the breadth is a lie of omission: a large repo is judged on ~10 *alphabetically-ordered* excerpts after the fetcher already paid to prioritize the right files, and the discrepancy auditor is one-directional — it can only catch a detector miss the model happens to notice, never a model miss. The roadmap is structurally repo-specific (signal-anchored), but its sharpness rides entirely on the model tier, and that's where a cheap model would hand me slop.

## Angle & reachable output

My angle: **grounding & hallucination** — is every dimension score re-traceable to concrete repo evidence, or is the model free-styling? I judged the *model-produced* output that reaches my view: the 9 per-dimension scores (as nuance over a deterministic floor), the summaries/strengths/gaps, the headline, the invitational roadmap, and the discrepancy audit.

Tier-honest: as a power-user pointing this at a repo I know cold, I'd hit a real provider (sonnet via claude-cli in dev, gemini-3-flash on the public MVP). Not the mock floor. So I'm judging real model output — but the grounding *pipeline* feeding that model is the same regardless of tier, and that's where the first crack is.

What's reachable to my eyes, confirmed in code:
- **Per-dimension provenance track** signal→LLM→blended renders inline (`src/components/report/DimensionCard.tsx:103`, the `ProvenanceTrack` SVG at `:117-153`). This is exactly the attribution I demand — I can see how far the model pulled the score off the deterministic anchor.
- **Evidence strings** per dimension render (`DimensionCard.tsx:75-79`), sourced from the detector signals (`engine.ts:112`, `evidenceStrings` at `:40-42`).
- **Discrepancies** render in the report body (`src/components/report/ReportView.tsx:245-253`).

So the affordances I'd insist on exist. The question is whether what flows into them is grounded or guessed.

## Surface-model notes (fresh file:line for the grounding angle)

**The score is ~60% a floor I can re-trace, ~40% band-clamped model nuance.** `LLM_GUARDBAND = 25` (`src/lib/maturity/model.ts:23`), `SCORE_BLEND = 0.6` (`:16`). The blend (`engine.ts:99-102`): clamp the LLM to `signalScore ± 25`, then `round(effectiveBlend * guarded + (1 - effectiveBlend) * signalScore)`, where `effectiveBlend = 0.6 * coverage` (`:71`). At full coverage the model owns at most 0.6 × 25 = **±15 points** of swing on any dimension. That's the right call — it means a model can't hallucinate D2 (testing) to green on a repo whose detector found zero real tests. Good. This is why I'd actually trust the *number*: it's anchored, and the anchor is evidence I can click into.

**But breadth is broken at the seam.** The fetcher is genuinely smart: `pickFilesToFetch` (`src/lib/github/source.ts:521-628`) prioritizes by evidence value — agent guidance anywhere in the tree (`:531-538`), then exact high-signal manifests/configs (`:541-587`), CI workflows (`:590-593`), cursor/MCP (`:596-599`), docs/ADRs (`:602-605`), a test sample (`:608-615`), then a source sample for texture (`:618-626`) — capped at `MAX_FILES = 32` (`:36`), each ≤ `MAX_FILE_BYTES = 14_000` (`:37`). Then, at `:454`, the files are **re-sorted alphabetically** ("deterministic order for stable prompts/caching"). The prompt then walks them *in that alphabetical order* and `break`s the moment the running block hits `OUTER = 22000` (`src/lib/scoring/prompt.ts:88,93`). So the priority the fetcher paid GitHub quota to establish is **discarded before the model sees it.** On a repo where `.cursor/`, `.eslintrc`, `.github/`, `docs/` sort early, the 22KB window can be exhausted on config and docs before a single sampled *test* or *source* file is reached — even though those were deliberately fetched. The model is told "SAMPLED FILES" and reasons over a window that's alphabetical-luck, not signal-rank. For a large repo, ~10 excerpts of ~2200 chars (`PER_FILE = 2200`, `:87`) — and not necessarily the 10 that matter most. I'd call that out in review.

**The discrepancy auditor is one-directional.** The system prompt (`prompt.ts:46`) and task (`:138-141`) tell the model to flag detector signals the *file evidence contradicts* — "tests clearly exist but the signal reported none." That's a detector-*miss* catcher, and it's purely model-bound: there is **no deterministic cross-check** that audits the auditor. If the model fails to notice a missed test dir (entirely plausible when that dir didn't make it into the alphabetical 22KB window — see above), nothing surfaces it. And the inverse failure — the *model* hallucinating a discrepancy that isn't real ("a test.js is present" when it misread an excerpt) — is bounded only by validation shape (`provider.ts:164-173`, capped at 8 at `:182`), not by truth. So the one output that's pure reasoning over evidence is also the one with zero deterministic backstop. That's a trust asymmetry I'd want named.

**No memory.** The prompt carries no prior-scan state, no "what changed," no team-stated goals (`buildAssessmentPrompt`, `prompt.ts:63-153` — nothing of the sort). Every scan re-judges cold. For my repeated-scan job (am I leveling up?) the grounding is amnesiac.

Three verdicts kept distinct: the provenance track **exists in code** ✓; it **reaches my output** ✓ (renders per dimension); it **clears my bar** ✓ for the score, ✗ for breadth and for the auditor's coverage.

## Findings

```json
[
  {
    "id": "SAM-G1",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "sam-staff-engineer",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "missing",
    "title": "Priority-fetched files are re-sorted alphabetically, so the 22KB prompt window judges a large repo on alphabetical-luck excerpts, not the signal-ranked ones the fetcher paid to select",
    "expected": "The ~10 excerpts that fit the 22KB window should be the highest-evidence files the fetcher already prioritized (agent guidance, manifests, CI, a real test sample, source texture).",
    "got": "pickFilesToFetch ranks by evidence value (source.ts:531-626) then files.sort((a,b)=>a.path.localeCompare(b.path)) at source.ts:454 discards that rank; prompt.ts:90-93 walks alphabetically and breaks at OUTER=22000, so config/docs that sort early can exhaust the window before any sampled test or source file is reached.",
    "evidence": [
      "src/lib/github/source.ts:454",
      "src/lib/github/source.ts:521",
      "src/lib/github/source.ts:608",
      "src/lib/scoring/prompt.ts:87",
      "src/lib/scoring/prompt.ts:93"
    ],
    "code_check": "present-broken",
    "verdict": "confirmed",
    "l2_priority": "scan a large repo (>32 signal files, deep test dir under t.../z...) twice and diff the SAMPLED FILES block against pickFilesToFetch's intended rank — do the prioritized test/source excerpts actually reach the model, or get cut by alphabetical overflow?"
  },
  {
    "id": "SAM-G2",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "sam-staff-engineer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Discrepancy auditor is one-directional and has no deterministic backstop — it catches only the detector misses the model happens to notice, and a hallucinated discrepancy is bounded by shape, not truth",
    "expected": "The thing I demand — 'show me where the model and the detector disagreed and why' — should be reliable in both directions and not itself be a place the model can free-style.",
    "got": "System+task only ask the model to flag detector misses it spots (prompt.ts:46, prompt.ts:138-141); validation bounds shape/count (provider.ts:164-173, sliced to 8 at :182) but nothing verifies the claim against the actual file content. A miss the model overlooks (esp. a file cut by the 22KB window, SAM-G1) never surfaces; a misread excerpt can mint a false discrepancy.",
    "evidence": [
      "src/lib/scoring/prompt.ts:46",
      "src/lib/scoring/prompt.ts:138",
      "src/lib/llm/provider.ts:164",
      "src/lib/llm/provider.ts:182"
    ],
    "code_check": "by-design",
    "verdict": "confirmed",
    "model_variant": "haiku/gemini-flash vs sonnet",
    "quality_delta": "On a cheap tier the auditor will both miss more real discrepancies and emit more spurious ones — it's the pure-reasoning sub-task with no guardband to save it.",
    "l2_priority": "plant a known detector miss (a real test dir the detector under-counts) and a decoy, run sonnet vs haiku — does each tier catch the real miss without inventing a false one?"
  },
  {
    "id": "SAM-G3",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "sam-staff-engineer",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "senior-quality",
    "title": "Roadmap is structurally repo-specific (signal-anchored, invitational) but its concreteness is entirely model-tier-bound — nothing in code forces a file:line target, so a weak model degrades to 'explore your testing'",
    "expected": "The single highest-leverage next move stated concretely against this repo's evidence ('gate the advisory 70% coverage check in CI'), not 'add more tests.'",
    "got": "Prompt does the right things — invitational framing, per-entry dimension/impact/effort/levelUnlock, grounded-in-evidence instruction (prompt.ts:124-136), and a deterministic buildFallbackRoadmap when the model returns none (engine.ts:171-173). But no schema field compels a concrete target/path; the specificity is a model-quality bet, not a contract.",
    "evidence": [
      "src/lib/scoring/prompt.ts:124",
      "src/lib/scoring/prompt.ts:129",
      "src/lib/scoring/engine.ts:171",
      "src/lib/llm/provider.ts:139"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "run the roadmap on a repo I know cold at sonnet and at flash — does flash drop to generic 'improve documentation', and would I put either in a sprint?"
  },
  {
    "id": "SAM-G4",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "sam-staff-engineer",
    "cert_level": "L1",
    "type": "trust",
    "severity": "strength",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "The ±25 guardband + 60/40 coverage-scaled blend + per-dimension provenance track is exactly the attribution that converts a skeptic — the score is anchored and re-traceable",
    "expected": "Every dimension score cites concrete re-traceable evidence; the model can nuance but never hallucinate an extreme the evidence doesn't support.",
    "got": "LLM clamped to signalScore ±25 (engine.ts:99-102, LLM_GUARDBAND=25), blended at 0.6×coverage so a model owns ≤±15pts at full coverage, ≤±15×coverage when half-seen (engine.ts:71); evidence strings + signal→LLM→blended track render per dimension (DimensionCard.tsx:75-79, :103). A model cannot paint a theater-coverage repo green.",
    "evidence": [
      "src/lib/maturity/model.ts:16",
      "src/lib/maturity/model.ts:23",
      "src/lib/scoring/engine.ts:99",
      "src/components/report/DimensionCard.tsx:103"
    ],
    "code_check": "present-but-missed",
    "verdict": "confirmed"
  },
  {
    "id": "SAM-G5",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "sam-staff-engineer",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "Prompt is amnesiac — no prior-scan state, no 'what changed', no team-stated goals reach the model, so every scan re-judges cold and can't ground a level-up narrative",
    "expected": "For my repeated-scan job, grounding should include what moved since last scan so the roadmap/discrepancies reason about trajectory, not just a snapshot.",
    "got": "buildAssessmentPrompt (prompt.ts:63-153) carries repo-meta + signals + process + 15 commits + file excerpts and nothing else; diff exists downstream (engine.ts:466 diffReports) but never feeds the prompt.",
    "evidence": [
      "src/lib/scoring/prompt.ts:63",
      "src/lib/scan.ts:176",
      "src/lib/scoring/engine.ts:466"
    ],
    "code_check": "confirmed-absent",
    "verdict": "confirmed"
  }
]
```

## Lens-C answer

**mid-floor** (sonnet is the right-sized floor; premium helps only the auditor).

Split by output part, because the guardband makes only two parts model-sensitive:

- **Score: cheaper-holds.** The number is ≤±15pts of model swing over a deterministic anchor I can re-trace (`engine.ts:99-102`). A cheap model (flash $0.5/$3, haiku $1/$5, 4o-mini $0.15/$0.6) will land inside the guardband and I'd trust the number either way. The score does **not** justify sonnet.
- **Roadmap: mid-floor.** This is where a cheap model loses me. Nothing in code forces a concrete `file:line` target (SAM-G3), so concreteness is pure model quality. My bar is "I'd put it in the next sprint" — flash/haiku predicted to drift to "improve documentation / increase coverage," which I'd reject in five minutes. Sonnet ($3/$15) is the floor that earns the roadmap.
- **Discrepancies: mid-floor, premium-helps on complex repos.** It's the only pure-reasoning-over-evidence sub-task with no guardband (SAM-G2). Cheap tier both under-catches and over-invents. Opus/sonnet+thinking ($5/$25) predicted to help *only here*, on a tangled repo — wasted everywhere else.

Rough `cost_delta`: dropping sonnet→flash saves ~6×/5× on tokens but fails me on the two outputs that are the actual reason to call a model at all (roadmap + audit). Going sonnet→opus is ~1.7× in, ~1.7× out and buys me nothing on score/summaries — I'd scope a thinking budget to `discrepancies` only (no such knob exists today; `config.ts` exposes temperature/maxTokens only) rather than pay opus across the whole call.

## Character feedback (in my voice)

**Would I trust this number?** Yes, mostly. The ±25 guardband and the signal→LLM→blended track are the thing — I can click into the evidence and re-derive most of the score myself. That's the attribution that flips a skeptic. Okay, that's actually right.

**Would I paste the badge?** For the score, yes. It's anchored, not inflated — a model can't paint my theater-coverage repo green. I'd stake my name on the level.

**Is the roadmap one I'd run?** *If* I'm on sonnet, probably — the framing's repo-specific and invitational, not orders. But nothing in the contract forces a concrete target, so on a cheap tier it'd degrade to slop I'd write better in five minutes. That's a bet on the model, not a guarantee from the engine.

**Is the discrepancy audit something I'd trust?** This is where I cross my arms. It only catches misses the model *notices*, there's no deterministic check on the auditor, and — worse — the file that would prove a miss might've been cut from the prompt by an alphabetical sort. So the auditor is blind exactly where the breadth gap bites. I'd read it, I wouldn't rely on it.

**Worth the wait/cost?** Yes. This compresses my better-part-of-a-day manual audit into ~2-3 minutes and the score holds up to a re-trace. Time-saved is real.

**The ONE engine change I want:** stop throwing away the fetcher's priority. Feed the 22KB prompt window in signal-rank order (or budget the window per category) instead of re-sorting alphabetically before the cut. Right now I paid GitHub quota to fetch the right files and then judged the repo on whichever ones happened to sort first. Fix that and the breadth complaint — and half the auditor's blind spot — goes away.

**Would I tell a peer?** Yes, with the caveat: "trust the score, read the roadmap, double-check the discrepancies yourself."

---

**Grounding score: 3/5.** Sources are strong (repo-meta, 9 signals + evidence, process signals, 15 commits, file excerpts) and the provenance is genuinely re-traceable — that earns 3. Docked 2: (1) breadth is alphabetical-luck after a smart fetch is discarded (SAM-G1), so the excerpts I'm judged on aren't the ranked ones; (2) the auditor has no deterministic backstop and no memory (SAM-G2, G5), so the one pure-reasoning output is also the least grounded.

**Per-use time-saved: ~5 hours** (a better-part-of-a-day manual maturity audit → ~2-3 minutes to a credible, re-traceable verdict). Holds — *for the score*. I'd still hand-verify the discrepancies, so call it 5 hours saved, not the full day.

**Engine verdict: fix-then-ship.** The scoring + provenance is shippable as-is and I'd stake my name on the number. Fix the priority-discard before the prompt window (SAM-G1) and give the auditor a deterministic backstop (SAM-G2) before I'd rely on the breadth or the discrepancy pass.

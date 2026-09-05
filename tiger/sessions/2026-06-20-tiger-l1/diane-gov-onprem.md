# Tiger L1 — Diane (Gov On-Prem) × scan-assess

**One-line verdict:** Fix-first — the provider seam is genuinely air-gap-deployable now (OpenAI-compatible base-URL override + GHES host knobs + no SaaS auto-fallback), but the keyless offline path is the *mock floor*, not a real model, and the one durable row-level artifact she'd file (the audit CSV) drops the engine column — so a mock-degraded quarter is invisible in the filed evidence.

## Angle & reachable output

My angle is **"which model is even ALLOWED to run inside my boundary, and does anything leak code to a host I didn't authorize?"** — Lens C (model fitness under a residency/on-prem constraint) and Lens A (the provider abstraction as a deploy seam).

What I actually judged: not a live model call (none allowed), but the **reachable engine envelope** — which providers `getProvider()` can select inside an air-gap, what the keyless floor really produces, and whether the model-produced output (roadmap + discrepancy audit) is even the thing I'd file. Tier-honest note: inside a true air-gap with no self-hosted model wired up, the engine I'd actually hit is **`mock`** (the deterministic floor), not Gemini/Bedrock/Claude — so for the *default* offline deployment, the "LLM output" I'm certifying is the rubric-derived floor, and the LLM's unbounded value (roadmap, discrepancies) is absent until I stand up an OpenAI-compatible endpoint.

## Surface-model notes (fresh file:line for my angle)

- **Self-hosted model seam is real.** `OpenAiProvider` resolves its base URL as `opts.baseUrl || OPENAI_BASE_URL || https://api.openai.com/v1` (`src/lib/llm/openai.ts:30`) and uses portable `response_format: json_object` (`openai.ts:49`) rather than strict `json_schema` — the right call for vLLM/Ollama/LM Studio, which don't all support strict schema. The header comment names exactly my deployment shape (`openai.ts:1-8`). `ProviderName` includes `"openai"` (`src/lib/types.ts:8`), so it's not type-locked out. **A local OpenAI-compatible model CAN be slotted in by config alone.**
- **No SaaS auto-fallback / no unauthorized leak.** `auto` resolves to `geminiOrMock()` — Gemini only if a key is present, else mock; it **"Never silently selects Bedrock"** (`src/lib/llm/index.ts:6-8, 70-73, 140-143`). The only failover is the **opt-in** `LLM_FALLBACK_PROVIDER`, which is commented out in `.env.example:19` and gated by `providerByName()` (`index.ts:152-171`). If I set `LLM_PROVIDER=openai → my-vllm`, nothing reaches OpenAI/Google/AWS unless I explicitly name a fallback. **Clean on the leak question.**
- **GHES reachability now EXISTS** (this refutes the prior UAT blocker). `src/lib/github/host.ts:21-33` resolves `GITHUB_API_URL` / `GITHUB_GRAPHQL_URL` / `GITHUB_RAW_URL` with GitHub.com defaults; `source.ts:32-33` and `graphql.ts:8-10` consume them. It reuses the **same env names GitHub's own Actions runners set** (`host.ts:4-5`). My firewalled GHES is reachable via base URL + token — my single hardest reachability gate passes.
- **Bedrock residency profiles are explicit.** `DEFAULT_BEDROCK_MODEL = "us.anthropic.claude-sonnet-4-6"` with `eu.` / `global.` / in-Region overrides documented (`src/lib/llm/bedrock.ts:7-10, 26`). Honest about data-stays-in-US vs EU residency. But Bedrock is a network call to AWS — correctly NOT an air-gap path.
- **Mock-degrade is honest in the VIEW, and at the ORG level — but not in the ROW-level filed artifact.** When an expected LLM fails, the engine flips to `MockProvider`, `report.warnings` gains "AI analysis was unavailable…" (`src/lib/scan.ts:279, 322-326`), and the UI shows a "Demo · deterministic rubric" chip (`ReportHeader.tsx:40-51`). The org briefing carries an `engineMix` + an explicit degrade warning — "⚠ some scores used the deterministic mock engine, not the live model" (`src/lib/org/briefing.ts:37-41, 319-321`). **But** the audit CSV columns are `at, action, actorId, repo, level, overall, headSha, meta` — **no engine/provider** (`src/app/api/audit/route.ts:31, 45-59`). The signed, row-level evidence package I'd hand a 3PAO can't tell a model-scored quarter from a floor-scored one.

## Grounding audit (Lens B)

For MY job the prompt must cite what makes a score *defensible to an auditor*: per-dimension deterministic anchor + named evidence (✓ `prompt.ts:69-76, 111-112`), process/governance signals incl. branch protection (✓ token-gated, `prompt.ts:35-41, 114-115`), commit sample (✓), file excerpts (✓ but 22KB-capped). What's **missing for an attestation**: (a) **no prior-scan memory** — each scan re-judges cold, so quarter-over-quarter "what moved and why" never reaches the model; (b) **no engine/provenance token** in the durable row artifact; (c) breadth — a 40-repo fleet judged on ~10 excerpts/repo (`prompt.ts:87-94`). The grounding that *reaches the model* is strong; the grounding that reaches the *filed artifact* loses provenance.

**Grounding score: 4/5** — strong context into the prompt; the missing fifth is engine-provenance + prior-scan delta in the durable, exportable artifact (not the prompt).

## Findings

```json
[
  {
    "id": "T-DIANE-1",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "Audit CSV drops engine provenance — a mock-degraded quarter is invisible in the one row-level artifact I'd file",
    "expected": "The exported, signed evidence package shows WHICH engine produced each score, so a deterministic-floor (mock-degrade) quarter is distinguishable from a model-scored one without re-running anything.",
    "got": "audit CSV columns are at/action/actorId/repo/level/overall/headSha/meta with no engine column (route.ts:31). The live report carries the llmFailed warning + a 'Demo · deterministic rubric' chip, and the org briefing carries engineMix + a degrade warning — but the row-level CSV, the thing reproducible-and-signed for a 3PAO, omits it.",
    "evidence": ["src/app/api/audit/route.ts:31", "src/app/api/audit/route.ts:45-59", "src/lib/scan.ts:279", "src/lib/scan.ts:322-326", "src/lib/org/briefing.ts:37-41"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Force a mock-degrade (LLM_PROVIDER=openai with an unreachable base URL), export the audit CSV, and confirm the floor-scored row is indistinguishable from a model-scored row in the filed file."
  },
  {
    "id": "T-DIANE-2",
    "lens": "model-optimization",
    "call_site": "scan-assess",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "senior-quality",
    "title": "The only keyless air-gap engine is the mock FLOOR, not a model — so the offline default ships zero roadmap/discrepancy value",
    "expected": "An offline, keyless engine that produces a defensible model-grade output (the roadmap + discrepancy audit are the LLM's whole unbounded value), OR the app states plainly that the keyless path is a deterministic floor with no AI nuance.",
    "got": "auto/no-key resolves to MockProvider (index.ts:70-73, 140-143). It IS honestly labeled in the view ('Demo · deterministic rubric'), which clears the 'no silent degrade' bar in the UI — but it means the only thing that runs with the cable unplugged AND no self-hosted endpoint is the floor. The model output I'm certifying (roadmap, discrepancies) requires me to stand up an OpenAI-compatible model myself.",
    "evidence": ["src/lib/llm/index.ts:70-73", "src/lib/llm/index.ts:140-143", "src/components/report/ReportHeader.tsx:40-51"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "model_variant": "self-hosted OpenAI-compatible (e.g. Llama-3.x-70B / Qwen-2.5 via vLLM)",
    "quality_delta": "vs sonnet default: score holds (guardbanded ±25, blended 60/40 — engine.ts:96-102), summaries acceptable; roadmap likely drifts generic and discrepancy-catching drops on complex repos — needs live confirmation",
    "cost_delta": "$0 marginal token cost (on-prem GPU is capex, not per-MTok) vs sonnet $3/$15 per MTok — the whole point for a procurement-locked line",
    "l2_priority": "Run a real self-hosted OpenAI-compatible model (vLLM) against a repo and panel-score the roadmap + discrepancies vs sonnet — does an allowed in-house model clear the senior bar, or does the audit go generic?"
  },
  {
    "id": "T-DIANE-3",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "observability",
    "title": "GHES host knobs work but are undocumented in .env.example — the deployer plans the air-gap without seeing the one reachability switch",
    "expected": "The reachability switch I most need (GITHUB_API_URL/GRAPHQL_URL/RAW_URL) is in the deployment doc I read first, so I learn it before the boundary, not after.",
    "got": "host.ts:21-33 implements all three with GitHub.com defaults and a Diane-named comment, but .env.example's GitHub section (lines 52-70) only documents GITHUB_TOKEN + the GitHub App — the enterprise host base URLs are absent. PRODUCTION_READINESS.md already lists this as a P1/P2 doc gap.",
    "evidence": ["src/lib/github/host.ts:4-12", "src/lib/github/host.ts:21-33", ".env.example:52-70"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "n/a — doc fix; verify by deploying with GITHUB_API_URL set to a GHES stub and confirming the scan reads it."
  },
  {
    "id": "T-DIANE-4",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "minor",
    "impact": { "frequency": "med", "reachability": "med", "trust_erosion": "med" },
    "dimension": "trust",
    "title": "Score movement carries no prior-scan memory — quarter-over-quarter delta isn't in the prompt, so a move could be guardband wobble I'd have to explain away",
    "expected": "A score change is backed by an evidence delta I could show a 3PAO; the model sees what changed since last quarter and the report distinguishes a real move from LLM noise.",
    "got": "The prompt carries no prior assessment / no 'what changed' (prompt.ts:101-151) — each scan re-judges cold. The engine DOES guardband ±25 and blend 60/40 (engine.ts:96-102) and a whole-scan diff exists (diffReports, engine.ts:466), but the LLM's own contribution within the band is re-derived each run with no memory, so a small move's provenance is the deterministic delta, not the model — which is actually fine, but isn't surfaced as 'this move is signal, not model wobble'.",
    "evidence": ["src/lib/scoring/prompt.ts:101-151", "src/lib/scoring/engine.ts:96-102", "src/lib/scoring/engine.ts:466"],
    "code_check": "confirmed-absent",
    "verdict": "uncertain",
    "l2_priority": "Re-scan an unchanged commit twice with a real model; does the blended score move at all (it shouldn't, given the guardband + whole-scan cache), and is any residual wobble attributable + surfaced?"
  },
  {
    "id": "T-DIANE-S1",
    "lens": "engine-quality",
    "call_site": "scan-assess",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: no unauthorized SaaS leak — auto never picks a network provider, failover is opt-in, residency profiles explicit",
    "expected": "Nothing calls out to a host I didn't authorize.",
    "got": "auto = gemini-if-keyed-else-mock and 'never silently selects Bedrock' (index.ts:6-8, 140-143); LLM_FALLBACK_PROVIDER is opt-in and commented out (.env.example:19); Bedrock geo-profiles (us./eu./in-Region) are explicit (bedrock.ts:7-10). This survives the cable being unplugged check on the leak axis.",
    "evidence": ["src/lib/llm/index.ts:6-8", "src/lib/llm/index.ts:140-143", "src/lib/llm/bedrock.ts:7-10", "src/lib/llm/openai.ts:30"],
    "code_check": "by-design",
    "verdict": "confirmed"
  },
  {
    "id": "T-DIANE-S2",
    "lens": "business-value",
    "call_site": "scan-assess",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH: the audit CSV is genuinely attestation-grade — timestamped, evidence-cited, per-row HMAC + file SHA-256, exportable without phoning a cloud",
    "expected": "A reproducible, tamper-evident, exportable evidence package — not a screenshot.",
    "got": "Per-row HMAC _sig folded into meta + an x-ascent-content-sha256 header over the file bytes (audit-integrity.ts:58-96, route.ts:74); RFC-4180 + formula-injection-safe cells (route.ts:25-29). This is the artifact, not a view. Its single missing column (engine) is finding T-DIANE-1.",
    "evidence": ["src/lib/db/audit-integrity.ts:58-96", "src/app/api/audit/route.ts:25-29", "src/app/api/audit/route.ts:74"],
    "code_check": "confirmed",
    "verdict": "confirmed"
  }
]
```

## Lens-C answer

**cheaper-holds for the score; mid-floor for the roadmap/audit — but for MY constraint the axis isn't price, it's *which model is allowed*.**

- **Score:** model-insensitive by design. The engine clamps the LLM ±25 around the deterministic signal and blends 60/40 (`engine.ts:96-102`), so a cheap or even a self-hosted open model holds the *number* within the guardband. A premium model (opus/sonnet+think) does **not** change the score I'd file.
- **Roadmap + discrepancy audit (the unbounded value):** this is where a smaller in-house model is at risk of going generic / missing detector contradictions. Predicted: a self-hosted 70B-class OpenAI-compatible model clears "acceptable summaries + score," but the **discrepancy audit on a complex repo** is the sub-task most likely to degrade vs sonnet — needs the L2 live panel.
- **Cost delta for me:** irrelevant on the per-MTok axis (procurement line is locked; on-prem GPU is capex). The decisive Lens-C fact is that the **only models I'm ALLOWED to run** are `mock` (floor, free, no AI value) or a self-hosted OpenAI-compatible endpoint via `OPENAI_BASE_URL` (`openai.ts:30`). Premium SaaS models (sonnet via Bedrock, Gemini) are off the table inside the air-gap. So the real Lens-C question — "does the guardbanded task let a smaller in-house model clear the bar?" — is the **only** one that matters for me, and it's exactly the L2 I'm prioritizing.

## Character feedback (Diane, first person)

Would I trust this number? The number, yes — it's guardbanded to deterministic evidence I could trace, and the blend leans harder on the signals when coverage is low. That survives. What I *don't* yet trust is the **provenance of the number in the file I hand the contracting officer.** Your live page is honest — it tells me when the model didn't run, and the org briefing even prints "some scores used the deterministic mock engine." Good. But the audit CSV — the signed, hashable, row-level thing that IS my evidence package — has no engine column. A quarter where the cable was unplugged and you fell to the floor looks identical, byte for byte, to a quarter where the model actually reasoned. That's the silent mock degrade, just moved one layer down into the artifact. An examiner would catch it, and then *I'd* have to explain it.

Would I paste the badge? Not the point for me. Would I run the roadmap? Inside the air-gap, the roadmap only exists if I stand up my own model — out of the box, offline, I get the floor, which has no roadmap nuance. That's a capability I have to build, not one I receive.

The thing that genuinely moved me: I came in expecting "on-prem brochure." Instead I found `GITHUB_API_URL` pointing at my GHES with the *same names my Actions runners already use*, an OpenAI base-URL override that speaks to a local vLLM, and an `auto` mode that provably refuses to call AWS or Google unless I name it. That survives the cable being unplugged. The reachability gate I assumed would kill this — passes.

Worth the wait/cost? Cost is a procurement line, not a lever. The question is whether the artifact earns the line. Today: *almost.* Add the engine column to the signed CSV and document the GHES knobs, and the recurring artifact becomes defensible.

**The ONE engine change I want:** put `engineProvider`/`engineModel` (and the `llmFailed` flag) into the audit CSV and the row-level evidence schema, so a floor-scored quarter is self-evident in the *filed* artifact, not just the live view. (T-DIANE-1.)

Would I tell a peer? Yes — a regulated peer evaluating on-prem. With the caveat: "verify the export carries engine provenance before you file it, and budget to stand up your own OpenAI-compatible model, because the keyless path is a floor."

## Scores

- **Grounding: 4/5** (strong context into the prompt; missing engine-provenance + prior-scan delta in the durable artifact).
- **Per-use time-saved: ~6 hours/quarter** — at the low end of her 6–9h band, and *conditional on the deployability gate*, which now PASSES (GHES + self-hosted model reachable). Docked from the top of the band because she must stand up her own model for the AI nuance and must manually annotate engine provenance until T-DIANE-1 lands.
- **Engine verdict: fix-then-ship.** The deploy seam is air-gap-honest and leak-clean (a real upgrade over the prior UAT). Two fixes gate her renew-grade trust: (1) engine provenance in the signed row-level artifact, (2) document the GHES host knobs. The keyless-floor-vs-real-model reality (T-DIANE-2) is a deployment truth to state plainly, then validate with a live self-hosted L2.

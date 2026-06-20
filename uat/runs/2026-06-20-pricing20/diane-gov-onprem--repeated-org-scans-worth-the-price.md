# L1 — Diane (gov / on-prem eng lead) × repeated-org-scans-worth-the-price

**Verdict: L1-conditional** — the recurring artifact machinery exists and her Enterprise tier unlocks unlimited scans + custom retention, but the journey is blocked *upstream of value* by a deployability reality the app never discloses: no scan engine runs fully air-gapped without silently degrading, and her on-prem GitHub Enterprise Server is unreachable (every GitHub host is hardcoded to the public cloud). The repetition can't pay off until the tool can run where she runs. L2-eligible because the value surfaces (executive briefing, audit CSV, trajectory) are real and worth confirming live.

## Reachable surface set (tier-honest — Enterprise, multi-year)
Diane is Enterprise: `includedCredits: null` / `unlimited: true` / `seats: null` / `retentionDays: null` (`src/lib/plans.ts:55-64`). Under `ASCENT_AUTH_BYPASS=1` on a populated org she reaches the full `/org/*` set as synthetic owner. Her tier genuinely unlocks everything the other tiers gate (unlimited scans, unlimited members, custom retention) — so unlike a Free/Pro character, *nothing here is an upsell she's denied*. The honest blocker is not entitlement, it's **execution environment**:
- **Reachable & entitled:** `/org/[slug]` overview + Trajectory, `/org/[slug]/executive` + `/share/briefing/[token]`, `/trends`, `/audit` (CSV export), `/usage`, `/pricing`.
- **Entitled but un-runnable in her reality:** every recurring scan — because no engine + no GHES reach (below). The bypass renders the routes; it cannot manufacture an air-gapped scan engine or an enterprise GitHub host.

## Surface-model notes (recurring-value affordances → file:line)

**Deployability / engine (her owned facet):**
- `src/lib/llm/index.ts:73-77` + `src/lib/llm/claude-cli.ts:77-78` — the UAT-default `claude-cli` engine **deletes `ANTHROPIC_API_KEY`** and shells out to the `claude` binary, which requires an interactive login session — i.e. it phones home to Anthropic. `providerAvailable("claude-cli")` only guards against Vercel, not against an air-gap. **Not air-gapped.**
- `src/lib/llm/index.ts:62-72` — `bedrock` needs AWS region/credentials (network to AWS). Not air-gapped absent GovCloud/PrivateLink, which the app neither documents nor detects.
- `src/lib/llm/mock.ts:42-96` — `mock` is the **only** keyless, offline-capable engine. But it is the deterministic floor ("real — just without LLM-written nuance," `mock.ts:2-3`), and produces a fixed-template summary/roadmap. An offline scan is possible — but it's the floor, not a model read.
- `src/lib/llm/index.ts:96-103` + `env.md:12` — **silent-degrade risk inverted but still present:** the code comment (index.ts:96-100) shows the team deliberately made a *selected* real provider fail fast rather than pre-degrade to mock. Good. BUT `LLM_FALLBACK_PROVIDER=mock` (`env.md:12`) means a `claude-cli` hiccup at the boundary (not-logged-in / no network) **degrades to mock at runtime** — the scan succeeds with floor scores. There is a `llmFailed`/fallback SSE event in the success path, but nothing in the *recurring artifact* (briefing/audit CSV) records "this quarter's scores came from the deterministic floor, not the model." For an attestation, that provenance gap is the finding.

**Code reachability (firewall / GHES):**
- `src/lib/github/source.ts:31-32` — `const API = "https://api.github.com"; const RAW = "https://raw.githubusercontent.com";`. `src/lib/github/graphql.ts:8` — `GRAPHQL = "https://api.github.com/graphql"`. `src/lib/github/app.ts:10` — `API = "https://api.github.com"`. **All GitHub hosts are hardcoded to the public cloud; no base-URL / GitHub-Enterprise-Server override exists.** Her firewalled GHES repos cannot be scanned, with or without a token. `GITHUB_TOKEN` (`source.ts:434`, contents API) raises limits and unlocks private *cloud* repos — it does not redirect to an enterprise host.

**Recurring value / grounding:**
- `src/lib/maturity/forecast.ts:82-149` — trajectory needs ≥2 distinct calendar days (`:87`, `:100`) and surfaces R² as fit confidence (`:123`), with `FLAT_PER_WEEK=0.5` (`:64`) suppressing noise into "flat." Quarterly cadence over a multi-year contract gives her plenty of distinct days — the forecast *will* render and her `retentionDays: null` means it can look back as far as data exists. This is the one place repetition clearly pays off structurally.
- `src/app/api/audit/route.ts:1-72` — **the closest thing to an attestation export**: an org-scoped, RFC-4180, formula-injection-safe **CSV of scan events** (action, level, overall, headSha, timestamp) — genuinely compliance-shaped evidence with provenance (headSha). But it's an *event log*, not a maturity attestation with cited per-dimension evidence, and it 503s without a DB (`:75-79`).

## Findings

```json
[
  {
    "id": "diane-airgap-no-offline-model-engine",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "completion",
    "title": "No scan engine runs air-gapped with model quality — claude-cli and bedrock phone home; only the deterministic mock is offline",
    "expected": "An on-prem deployment can produce a model-grade maturity scan with no outbound internet (a documented offline/self-host engine).",
    "got": "claude-cli deletes ANTHROPIC_API_KEY and shells to a `claude` binary that needs an interactive login (network); bedrock needs AWS; only `mock` is keyless/offline and it is the deterministic floor. No engine gives an air-gapped, model-quality scan, and the app never states which engine is air-gap-safe.",
    "evidence": ["src/lib/llm/claude-cli.ts:77-78", "src/lib/llm/index.ts:73-77", "src/lib/llm/index.ts:62-72", "src/lib/llm/mock.ts:2-3", "uat/env.md:12-14"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "Run a scan with no network + claude-cli selected: confirm it fails (not silently mocks), and confirm whether ANY config yields a model-grade offline scan.",
    "suggested_acceptance": "Provider docs/UI state per-engine network dependence; an offline engine option exists and labels its output as deterministic vs model-derived."
  },
  {
    "id": "diane-no-ghes-base-url",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "missing-feature",
    "severity": "blocker",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "med" },
    "dimension": "completion",
    "title": "GitHub host is hardcoded to api.github.com — on-prem GitHub Enterprise Server behind the firewall is unreachable",
    "expected": "A configurable GitHub API base URL so a firewalled GitHub Enterprise Server (her actual code host) can be scanned with an enterprise token.",
    "got": "API/RAW/GRAPHQL are hardcoded public-cloud constants across source.ts, graphql.ts, and app.ts. No GHES/base-URL override. A token only authenticates against github.com; it cannot redirect to an enterprise host. Her repos are simply unscannable.",
    "evidence": ["src/lib/github/source.ts:31-32", "src/lib/github/graphql.ts:8", "src/lib/github/app.ts:10", "src/lib/github/source.ts:434"],
    "code_check": "confirmed-absent",
    "verdict": "confirmed",
    "l2_priority": "n/a at L2 (no GHES in the test env) — flag for product: the recurring scan can't reach an enterprise GitHub host at all.",
    "suggested_acceptance": "GITHUB_API_URL / base-URL env override threads through source.ts, graphql.ts, app.ts; raw-content host derives from it."
  },
  {
    "id": "diane-mock-fallback-no-artifact-provenance",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "trust",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "high" },
    "dimension": "trust",
    "title": "When the real engine fails at the boundary, the scan degrades to the deterministic floor — but the recurring artifact doesn't record that the model didn't run",
    "expected": "An attestation states which engine produced each score, so a floor-degraded quarter is distinguishable from a model-scored one in the filed evidence.",
    "got": "LLM_FALLBACK_PROVIDER=mock degrades a claude-cli hiccup to mock at runtime. The live scan surfaces a fallback SSE event, but the durable artifacts she'd file — executive briefing and the audit CSV — carry score/level/headSha, not the engine/provider that produced them. A floor-scored quarter is indistinguishable from a model-scored one in the evidence package.",
    "evidence": ["uat/env.md:12", "src/lib/llm/index.ts:96-103", "src/app/api/audit/route.ts:30"],
    "code_check": "present-but-missed",
    "verdict": "uncertain",
    "l2_priority": "Inspect a briefing + audit CSV after a forced mock-fallback scan: is the provider/engine recorded anywhere in the durable artifact, or only in the transient SSE stream?",
    "suggested_acceptance": "Audit rows + briefing record the provider/model that produced each score (provenance), so a degraded cycle is auditable."
  },
  {
    "id": "diane-artifact-is-event-log-not-attestation",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "quality-gap",
    "severity": "major",
    "impact": { "frequency": "high", "reachability": "med", "trust_erosion": "med" },
    "dimension": "missing",
    "title": "The exportable 'evidence' is a scan-event CSV, not a maturity attestation with cited per-dimension evidence",
    "expected": "A reproducible, timestamped attestation that binds each dimension score to the repo evidence behind it (OSCAL/continuous-monitoring direction) — signable for a contracting officer.",
    "got": "The audit CSV (action/level/overall/headSha/timestamp) is genuinely compliance-shaped and injection-safe, but it's an event log, not a per-dimension evidence package; the executive briefing is board-narrative, not control-mapped. Neither maps scores to the cited signals the report shows on-screen. She'd still hand-assemble the actual attestation.",
    "evidence": ["src/app/api/audit/route.ts:1-30", "src/app/api/audit/route.ts:75-79", "src/lib/org/briefing.ts"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "Open /audit CSV + /share/briefing on the seeded org: does either bind a dimension score to its cited evidence, or is the evidence trail on-screen only?",
    "suggested_acceptance": "An exportable per-scan attestation lists each dimension, its score, and the cited evidence signals; reproducible from the same headSha."
  },
  {
    "id": "diane-enterprise-price-undecidable-from-app",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "confusion",
    "severity": "minor",
    "impact": { "frequency": "low", "reachability": "high", "trust_erosion": "low" },
    "dimension": "clarity",
    "title": "Enterprise price is 'Custom — contact us'; recurring artifact value can't be mapped to the contract line from inside the app",
    "expected": "Even without a public $, enough of the recurring deliverable is legible to map artifact → locked contract value at renewal.",
    "got": "Enterprise is 'Custom — contact us' with no $ in-app (by design; price lives in Polar). For Diane this is a low-severity note, not a blocker — her price is a locked multi-year procurement line, not an in-app decision. But it means the renew decision is made entirely on artifact quality, off-app.",
    "evidence": ["src/lib/plans.ts:55-64", "uat/runs/2026-06-20-pricing20/_L1-BRIEF.md:20-21"],
    "code_check": "by-design",
    "verdict": "confirmed",
    "l2_priority": "none — pricing is procurement-side for this character.",
    "suggested_acceptance": "n/a — by design for Enterprise."
  },
  {
    "id": "diane-strength-trajectory-and-retention",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "high", "reachability": "high", "trust_erosion": "low" },
    "dimension": "senior-quality",
    "title": "STRENGTH — Enterprise custom retention + R²-gated trajectory makes the quarter-over-quarter read structurally sound IF it can run",
    "expected": "A recurring read that supports a real quarter-over-quarter baseline with confidence surfaced.",
    "got": "retentionDays: null (unlimited) means her trajectory can look back across the whole contract; forecast.ts surfaces R² as fit confidence and a 0.5/wk flat-floor suppresses noise, so a flat quarter honestly reads 'no change' rather than fabricating movement. This is the part of repetition that would pay off — gated only by deployability.",
    "evidence": ["src/lib/plans.ts:60-62", "src/lib/maturity/forecast.ts:64", "src/lib/maturity/forecast.ts:123", "src/lib/maturity/forecast.ts:130-131"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "Re-scan an unchanged repo twice under claude-cli: does the score wobble within the guardband, and does the flat-floor/R² correctly call it 'flat' so a non-move isn't sold as a move?"
  },
  {
    "id": "diane-strength-audit-csv-injection-safe",
    "journey": "repeated-org-scans-worth-the-price",
    "character": "diane-gov-onprem",
    "cert_level": "L1",
    "type": "trust",
    "severity": "polish",
    "impact": { "frequency": "med", "reachability": "high", "trust_erosion": "low" },
    "dimension": "trust",
    "title": "STRENGTH — audit CSV export is org-scoped, keyset-paginated, and CSV-injection-hardened (real compliance hygiene)",
    "expected": "Compliance-evidence export that an auditor wouldn't reject on handling grounds.",
    "got": "RFC-4180 quoting, =/+/-/@ formula-injection neutralization, strict org-scoping (no cross-tenant leak), and a row cap. This is the kind of detail a compliance lead notices and trusts — it reads as built by someone who's handled evidence before.",
    "evidence": ["src/app/api/audit/route.ts:24-31", "src/app/api/audit/route.ts:5-8"],
    "code_check": "present-but-missed",
    "verdict": "confirmed",
    "l2_priority": "none — confirmed in code."
  }
]
```

## Character feedback (first person — Diane)

Would I renew? On the artifact, the bones are better than I expected — a custom retention window means the trajectory actually spans my contract, the flat-floor and the R² mean a quiet quarter reads "no change" instead of inventing a number, and that audit CSV is the first compliance export I've seen from a tool like this that an auditor wouldn't bounce on formatting. Someone who's handled evidence built it. That part earns a look.

But none of it matters until I can answer the only question my job is built on: **what does it reach, and from where.** I unplug the cable and look. The headline engine — `claude-cli` — deletes the API key and shells out to a binary that needs a login. That's a phone-home. Dead on arrival inside my boundary. Bedrock wants AWS. The only thing that runs offline is the `mock`, and by its own comment that's the deterministic floor, not a model read. So my choices are: a real scan that can't run where I run, or an offline scan that's a template. And worse — if the real engine hiccups at the boundary, it *quietly* drops to that floor, and nothing in the briefing or the CSV I'd file says "these scores came from the floor this quarter." I'd be signing an attestation and not know the model never ran. That's not an insight problem, that's an audit problem.

Then the repos. Every GitHub address in here is `api.github.com`. My code lives on a GitHub Enterprise Server behind the firewall. There's no base-URL knob anywhere — a token doesn't help, there's nowhere to point it. So even with the perfect engine, it can't see my fleet.

Is each cycle telling me something new? Structurally, yes — the trajectory is real. Do I trust a move is real? The flat-floor and R² give me a defense, which is more than most. Does the cost pencil out? My price is a locked line; that's not my lever. Can I even see the price? No — "contact us" — but I don't care, that's procurement's table. What's missing for MY recurring job: an engine I can run air-gapped, a path to my GHES, and an artifact that binds each score to its evidence and records which engine produced it. Would I tell a peer? In gov? I'd tell them it's promising and to ask the vendor exactly two questions before procurement: "does it run in the boundary" and "does it read GHES." Today both answers are no.

## Scores & verdict
- **Grounding score: 4 / 7** recurring-context sources reach a *defensible* artifact for her. Reach (forecast trajectory with custom retention ✓; movers/period deltas ✓; audit-CSV provenance via headSha ✓; on-screen evidence track ✓). Don't reach the durable artifact (engine/provider provenance in the filed artifact ✗; per-dimension cited evidence in an export ✗; her actual GHES code as a scan source ✗). The machinery is good; it's fed from hosts she can't reach and exports that drop the provenance she'd need.
- **Per-cycle time-saved: ~7 hours** (mid-point of a 6–9h saving vs. her ~8–12h hand-assembled quarterly attestation) — **but conditional, and currently $0 realized**, because the deployability gate (air-gap engine + GHES reach) blocks her from running it at all. The upside is real; it's stranded behind execution environment.
- **Renew / downgrade / churn / upgrade: BLOCKED-renew (lean churn-risk at renewal).** She wouldn't churn impulsively — it's a multi-year contract and the artifact bones are good — but at the renewal review she can't run the recurring scan in her boundary or against her GHES, so the recurring value is unrealized. Verdict for the file: *renew only if the vendor ships an air-gapped engine and a GHES base-URL; otherwise the line is paying for a tool that can't execute where we deploy.*

## l2_priority carry-forward
1. With no network + `claude-cli` selected, confirm a scan **fails honestly** (not a silent mock) — and whether ANY config yields a model-grade offline scan.
2. Force a mock-fallback scan, then open `/share/briefing` + `/audit` CSV: is the **producing engine/provider recorded in the durable artifact**, or only in the transient SSE event?
3. Re-scan an **unchanged** repo twice under claude-cli: does the score wobble within the ±25 guardband, and does the flat-floor/R² correctly label it "flat" so a non-move isn't presented as a move?
4. Open `/audit` CSV + `/share/briefing`: does either **bind a dimension score to its cited evidence** (attestation-grade), or is the evidence trail on-screen only?

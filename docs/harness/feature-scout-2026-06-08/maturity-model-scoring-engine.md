# Feature Scout — Maturity Model & Scoring Engine

> Total: 6
> Critical: 0 | High: 3 | Medium: 2 | Low: 1

## 1. Feed PR & governance signals into the LLM prompt, not just the score blend
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/scoring/prompt.ts:24 (buildAssessmentPrompt), src/lib/scan.ts:144 (scoreInput)
- **Gap**: The scan already fetches rich PR review/velocity/AI-governance data (`fetchPrStats` → `PrStats`) and branch-protection rules (`Governance`), and folds them into the deterministic D3/D6/D7/D8 scores via `applyPrSignals`/`applyGovernanceSignals` (pulls.ts:151, 215). But `scoreInput` (scan.ts:144-150) only passes `repo, signals, files, commitSample, archetype` — the LLM prompt (prompt.ts:62-109) never sees a single PR or governance fact. So the LLM auditor reasons about review discipline, merge gating, PR size, and whether AI-touched PRs are reviewed *blind*, even though the engine already has `pr.reviewedRate`, `pr.aiGovernedRate`, `gov.requiresStatusChecks`, etc.
- **User value**: Every paying customer gets sharper, evidence-backed dimension summaries and discrepancy-flagging on the exact axes (CI gating, AI governance, review coverage) the product sells. Today the LLM's qualitative nuance is missing the strongest behavioral evidence in the pipeline.
- **Implementation sketch**: Add optional `prStats`/`governance` fields to `LlmScoreInput` (provider.ts) and thread them from scan.ts into `buildAssessmentPrompt`; render a compact "PROCESS SIGNALS" block (reviewed-rate, median-hours-to-merge, small-PR-rate, branch-protection rules) alongside the existing DETERMINISTIC SIGNALS block. No new fetches — the data is already in hand at scan.ts:133.
- **Effort**: S

## 2. Confidence-weighted blend (let coverage dampen the LLM nudge)
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/scoring/engine.ts:67-73, src/lib/maturity/model.ts:16
- **Gap**: `snap.coverage` (0..1, "how much of the repo we could inspect") is computed and carried all the way to `report.confidence` (engine.ts:137), and `scan.ts:226` even warns when coverage < 0.5 — but it never touches the math. The blend is a fixed `SCORE_BLEND = 0.6` and a fixed `LLM_GUARDBAND = 25` regardless of whether the LLM saw 8k or 70k bytes of a partially-truncated repo (prompt.ts caps file context at OUTER=22000). A low-coverage scan blends signals + LLM with identical confidence to a full one, then merely appends a "treat as indicative" footnote.
- **User value**: Large/rate-limited/truncated repos (a common SaaS case) get scores that honestly reflect uncertainty instead of false precision — fewer "the score is wrong, you didn't even see half my repo" complaints.
- **Implementation sketch**: In `assembleReport`, scale the guardband and/or blend by `snap.coverage` (e.g. `effectiveBlend = SCORE_BLEND * coverage` so a half-seen repo leans harder on deterministic signals, which *are* coverage-robust). Coverage is already a parameter on the snapshot; this is a one-line modulation plus a calibration test.
- **Effort**: S

## 3. Close the auditor loop — turn `discrepancies` into detector-improvement signal
- **Severity**: High
- **Category**: automation
- **File**: src/lib/scoring/prompt.ts:96, src/components/report/ReportView.tsx:323, src/app/api/recommendations/route.ts
- **Gap**: The prompt explicitly tasks the LLM as an "AUDITOR" to flag dimensions where the deterministic `signalScore` is wrong given file evidence (prompt.ts:96-99), and these `discrepancies` are validated, persisted, and rendered in a "Flagged for review" card (ReportView.tsx:323) that literally says they're "a useful signal for improving the detectors." But nothing acts on them: there is no aggregation endpoint, no `/api/discrepancies` surface, no counter of which detector (D2 missed tests, D9 missed CodeQL — the exact CALIBRATION.md "config-as-code only" blind spots) gets flagged most across scans. The richest free QA signal the product generates evaporates after one render.
- **User value**: The Ascent team (and the calibration loop in CALIBRATION.md) gets a ranked list of "detectors the LLM most often overrules," turning live traffic into a continuous, evidence-driven rubric-tuning feed instead of a 12-repo manual bench.
- **Implementation sketch**: Persist discrepancies already flow through `db/scans.ts`; add a `GET /api/discrepancies?window=` aggregator (group by `dimension`, count, sample claims) mirroring the existing recommendations route, and surface a small internal "detector misses" view. The data is already captured — this is read-side aggregation only.
- **Effort**: M

## 4. Per-org custom rubric (configurable weights / blend / guardband)
- **Severity**: Medium
- **Category**: feature
- **File**: src/lib/maturity/model.ts:16,23,203 (SCORE_BLEND, LLM_GUARDBAND, ARCHETYPE_WEIGHTS)
- **Gap**: Weights, blend, and guardband are module-level constants with a startup invariant (`weightsAreValid`, model.ts:293). The archetype lens (solo/team/org) is the only re-weighting, and it's hard-coded. There is no per-org override anywhere — `db/org.ts` stores no rubric config, and `getOrgBenchmark` reuses `weightsFor("org")`. A platform team that genuinely doesn't ship containers (D9 container scan irrelevant) or weights testing far above docs cannot tell Ascent that; every org is scored by one global opinion.
- **User value**: Enterprise/org customers can align the maturity score with their own engineering charter (e.g. up-weight Supply Chain & Security for a fintech), making the score adoptable as an internal KPI rather than an external opinion they argue with.
- **Implementation sketch**: `overallScoreFor`/`axisScore`/`assembleReport` already take weights as data (`weightsFor(archetype)` returns a record). Add an optional `rubricOverride` (partial weight map + blend) loaded from an org config row, renormalized by the existing defensive renormalization, and validated by the existing `weightsAreValid` shape. Gate it behind org settings; default path is unchanged.
- **Effort**: M

## 5. One-click "apply this recommendation" — wire roadmap items to the artifact builder
- **Severity**: Medium
- **Category**: automation
- **File**: src/lib/scoring/recommendations.ts:20 (CATALOG), src/lib/practice-artifact.ts:100 (buildArtifact), src/app/api/recommendations/[id]/route.ts
- **Gap**: There are two parallel catalogs keyed by the same dimension ids that never meet. `recommendations.ts` CATALOG maps each `Dx` to an invitational roadmap item; `practice-artifact.ts` `buildArtifact` maps each practice (`agent-guidance`→D1, `test-discipline`→D2, …, practices.ts) to a concrete, leak-free draft-PR file ready for `github/write.ts`. But a recommendation carries no `practiceId`, and the recommendations PATCH route (status/assignee/date only) offers no "generate starter / open draft PR" action. A user reads "Agent guidance is thin" and must manually go find the artifact builder.
- **User value**: Collapses the read→act gap: from a roadmap item the user (or their agent) gets a tailored starter PR in one click — the product's stated "systematic apply" vision (practice-artifact.ts:2) actually reachable from where users discover the gap.
- **Implementation sketch**: The dimension→practice mapping already exists implicitly (each PracticeDef has `dimId`). Add a `practiceId` to each CATALOG entry (or derive via `PRACTICES.find(p => p.dimId === rec.dimension)`), then add a `POST /api/recommendations/[id]/artifact` that calls `buildArtifact` with the scan's repo context and returns the `ArtifactSpec` (or opens a draft PR via the existing write path).
- **Effort**: M

## 6. Per-dimension peer percentiles (extend the existing corpus benchmark)
- **Severity**: Low
- **Category**: user_benefit
- **File**: src/lib/db/org.ts:1064 (getOrgBenchmark)
- **Gap**: `getOrgBenchmark` (org.ts:1055-1090) already computes corpus percentiles, but only for `overall`, and corpus averages for adoption/rigor — there is no per-dimension percentile (e.g. "your D2 Testing is in the 40th percentile of the corpus"). MATURITY_MODEL.md §5 lists "peer benchmarking percentiles" as a Phase-2 goal; the corpus, the query, and the percentile math all already exist for the overall number. A user sees their D-scores in isolation with no sense of where each sits versus peers.
- **User value**: Turns each dimension bar in the report from an absolute grade into a relative one ("everyone struggles with D9; your D2 is genuinely behind"), which is far more motivating and a natural up-sell hook for the org dashboard.
- **Implementation sketch**: The corpus loop in `getOrgBenchmark` already iterates scans with per-dimension scores (used elsewhere in org.ts). Extend it to accumulate a per-`Dx` distribution and emit `dimensionPercentiles: Record<DimensionId, number>` alongside `overallPercentile`, reusing the same `below/corpus.length` formula already at org.ts:1090.
- **Effort**: S

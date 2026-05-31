# Scan pipeline

The scan is Ascent's core engine. It takes a GitHub repo URL, reads the repository over
the REST/GraphQL API (**no git clone**), extracts deterministic maturity signals across
**9 dimensions (D1–D9)**, asks an LLM to calibrate and explain, blends the two with
guardbanding, and returns a `ScanReport` — overall score (0–100), maturity level (L1–L5),
adoption/rigor axes, posture quadrant, evidence, strengths/risks, and a prioritized
roadmap. The whole thing runs in a stateless serverless function and is fully demoable
with **zero secrets** via the deterministic mock provider.

Orchestration lives in `src/lib/scan.ts:scanRepository`. The two HTTP entry points
(`/api/scan`, `/api/scan/stream`) are thin wrappers around it; everything else here is
pure, testable TypeScript.

## Entry points

### UI

| Surface | Behavior | Implementation |
| --- | --- | --- |
| Landing scan box | `ScanForm` normalizes any input shape (`owner/repo`, full URL, SSH) via `normalizeRepo()` and routes to `/report?repo=<normalized>`. | `src/app/page.tsx`, `src/components/ScanForm.tsx` |
| Scan gallery | Curated/live examples on the landing page; live entries come from `getPublicScanGallery()`. | `src/components/landing/ScanGallery.tsx` |

The report page then drives the actual scan over the streaming endpoint — see
[report.md](report.md).

### API

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/scan` | `POST` (and `GET ?url=`) | Blocking scan. Returns a full `ScanReport` JSON. Handler: `runScan` in `src/app/api/scan/route.ts`. |
| `/api/scan/stream` | `POST` | Streaming scan over **Server-Sent Events** (progress + result). Handler: `src/app/api/scan/stream/route.ts`. |

**Request body** (shared shape):

```jsonc
{
  "url": "owner/repo | https://github.com/owner/repo",
  "token":          "optional GitHub token (private repos / PR signals)",
  "installationId": "optional GitHub App installation id",
  "mock":  true,    // force the deterministic provider
  "fresh": true     // /api/scan only: skip the cached report, re-run
}
```

`/api/scan` responses carry cache-provenance headers: `x-ascent-cache: hit | miss | hit-db`
and `x-ascent-dedup: hit | miss`.

**SSE protocol** (`/api/scan/stream`): named events on the stream —

- `progress` — `{ stage, message, pct, provider?, region?, fallback? }` where `stage` ∈
  `fetch | tree | files | analyze | score | compose | done`.
- `result` — the final `ScanReport`.
- `error` — `{ error, code? }`.
- A `: ping` comment is emitted every ~15s so idle proxies don't drop the connection.
  The stream respects client disconnect via an `AbortSignal`, cancelling in-flight fetches.

## Pipeline stages

`scanRepository` sequences four stages and emits progress between them.

### 1 — Ingest (`src/lib/github/source.ts`)

`GitHubPublicSource.fetchSnapshot()` parses the URL (`parseRepoUrl`) and builds a
`RepoSnapshot`:

- `meta: RepoMeta` — owner, name, stars, forks, language, default branch, **head SHA**.
- `tree: RepoFile[]` — the full recursive git tree (`git/trees?recursive=1`, one call).
- `files: FetchedFile[]` — a **budgeted sample** (≤ 32 files, ≤ 14 KB each, ≤ 180 KB
  total) chosen by `pickFilesToFetch`: agent-guidance files, manifests, configs, CI
  workflows, tests, and a sample of source. Public repos read from `raw.githubusercontent.com`;
  private repos use the Contents API.
- `commits: CommitInfo[]` — up to 30 recent commits (message, author, login, date).
- `truncated`, `coverage` — flags that drive confidence + warnings.

Ingest accepts an optional `ref` (branch/tag/SHA) so the pipeline can score a **PR head**
instead of the default branch — this is what the [gate](gate.md) and the App webhook use.

### 2 — Analyze (`src/lib/analyze/index.ts`)

`analyzeSignals()` runs the **9 deterministic detectors** (one per dimension), each
returning a `DimensionSignals { id, signalScore (0–100), signals[], notes? }`. Detectors
are wrapped individually in try/catch — a pathological file fails *one* dimension to a
zero score plus a warning, never the whole scan.

| Dim | Name | What it detects (deterministically) |
| --- | --- | --- |
| D1 | AI Tooling & Conventions | Quality + presence of machine-readable agent guidance (CLAUDE.md, AGENTS.md, .cursorrules…): commands, architecture, constraints, MCP/hooks, examples |
| D2 | Automated Testing | Test file count, test:source ratio, frameworks, e2e, coverage config, advanced rigor (mutation, contract, perf, a11y) |
| D3 | CI/CD & Delivery | Pipelines + stages, release automation, IaC, policy-as-code, GitOps, progressive delivery, migrations |
| D4 | Agentic Workflows | AI code-review agents, LLM-in-CI, auto-fix/auto-PR bots, dependency automation |
| D5 | Documentation & Knowledge | README depth, `/docs`, ADRs, CONTRIBUTING, CHANGELOG, API docs, examples |
| D6 | Code Quality & Guardrails | Linters, formatters, strict types, pre-commit hooks, CODEOWNERS, commitlint |
| D7 | Commit & Velocity Signals | AI-attributed commits, conventional commits, cadence, recency |
| D8 | AI Process & Harness | Evals/golden tests, prompt/agent library, runbooks, AI contribution process |
| D9 | Supply Chain & Security | SAST, SCA, secret/container scanning, SBOM, signing, SECURITY.md, threat models |

The same pass also computes `classifyArchetype()` (**solo / team / org** — selects the
weighting lens later), `detectAiUsage()` (AI-commit fraction, tracked separately from the
score), and `computeContributors()`.

Two **token-gated** enrichments run alongside the detectors and fold into dimensions:

- `src/lib/analyze/pulls.ts:fetchPrStats` — recent PR stats over GraphQL (merge/review
  rates, time-to-merge, AI-involved/AI-governed rates, tool taxonomy). Folds into D6/D7/D8.
- `src/lib/github/governance.ts:fetchBranchGovernance` — branch protection + rulesets.
  Folds into D6/D3/D8. `fetchCommitActivity` adds 52-week commit history.

### 3 — Score with the LLM (`src/lib/scoring/prompt.ts` + a provider)

`buildAssessmentPrompt()` renders a compact prompt: the rubric (levels + dimensions), the
deterministic signal block, the sampled file contents, and a commit sample. The selected
`LLMProvider.assess()` returns an `LlmAssessment` — per-dimension score + summary +
strengths/gaps, an overall headline, cross-cutting strengths/risks, an invitational
`roadmap`, and `discrepancies` (signals the LLM thinks the detectors got wrong).

If the LLM fails or returns an unusable result (`isAssessmentUsable()` requires ≥ 50% of
dimensions), `scanRepository` automatically falls back to `MockProvider` and adds a
warning. Provider selection and the abstraction are documented in
[llm-providers.md](llm-providers.md).

### 4 — Blend, roll up & compose (`src/lib/scoring/engine.ts`)

`assembleReport()` produces the final `ScanReport`:

- **Per-dimension blend** — the LLM score is guardbanded to within `LLM_GUARDBAND` (±25)
  of the signal score, then blended: `final = SCORE_BLEND·guarded + (1−SCORE_BLEND)·signal`
  with `SCORE_BLEND = 0.6` (60% LLM / 40% deterministic). This keeps the LLM honest while
  still letting it add nuance.
- **Overall** — a renormalized, archetype-weighted mean of the dimensions
  (`levelForScore()` maps it to L1–L5).
- **Two axes** — `adoptionScore` (D1, D4, D7) and `rigorScore` (D2, D3, D5, D6, D8, D9),
  combined into a **posture quadrant** at the 50-point threshold: *AI-Native*,
  *Ungoverned*, *Solid but Manual*, *Getting Started* (`postureFor`).
- **Warnings** — appended for: no token (PR signals skipped), LLM fallback, truncated
  tree, low coverage (< 50%), or a detector error.

## Maturity model (`src/lib/maturity/model.ts`)

The model file is configuration, not logic — a single source of truth for levels,
dimensions, weights, and the scoring constants.

**Levels** (`LEVELS`): L1 Manual `[0–24]` · L2 Assisted `[25–44]` · L3 Augmented
`[45–64]` · L4 Integrated `[65–84]` · L5 Autonomous `[85–100]`.

**Archetype weighting** (`ARCHETYPE_WEIGHTS`) — each archetype (`solo`/`team`/`org`)
defines a full set of D1–D9 weights summing to 1 (validated by `weightsAreValid()` outside
prod). The *org* lens (default) leans on D1/D2/D3/D8; *solo* leans on D1/D2/D6. Forecasting
helpers (`src/lib/maturity/forecast.ts`) project a maturity trend line and ETA to the next
level — used by the org [Trajectory](org-intelligence/README.md).

## Caching (`src/lib/cache.ts`, `src/lib/scan-cache.ts`)

Two tiers, keyed by `owner/repo@sha::{llm|mock}` (`makeCacheKey`):

1. **In-memory LRU** (`src/lib/cache.ts`) — 100 entries, 15-min TTL, plus a separate
   `HeadHint` LRU (ETag + SHA, 6-hr TTL) for cheap conditional head requests.
2. **Persistent** (`src/lib/scan-cache.ts:lookupCachedScan`) — shared by both scan routes.
   It resolves the current head with a conditional request (`304 Not Modified` → free,
   unchanged), then looks up the in-memory tier, then the DB
   (`getScanReportByCommit`), then falls through to a fresh scan. `fresh=true` skips the
   cached *report* but still resolves the key/ETag.

This makes re-scans of an unchanged commit instant and dodges GitHub rate limits.

## Key files

| File | Role |
| --- | --- |
| `src/lib/scan.ts` | `scanRepository()` — top-level orchestrator: auth resolution, stage sequencing, progress emission, LLM call + fallback, warnings. |
| `src/app/api/scan/route.ts` | `POST`/`GET` blocking endpoint; cache lookup, persistence, provenance headers. |
| `src/app/api/scan/stream/route.ts` | SSE streaming endpoint with heartbeat + abort handling. |
| `src/lib/github/source.ts` | `GitHubPublicSource.fetchSnapshot()` — metadata, tree, file sampling, commits, conditional head. |
| `src/lib/analyze/index.ts` | `analyzeSignals()` — the 9 detectors, `classifyArchetype`, `detectAiUsage`, `computeContributors`. |
| `src/lib/analyze/pulls.ts` | PR stats over GraphQL; folds into D6/D7/D8. |
| `src/lib/github/governance.ts` | Branch protection / rulesets / commit activity. |
| `src/lib/scoring/engine.ts` | `assembleReport()` — guardband, blend, rollup, axes, posture. |
| `src/lib/scoring/prompt.ts` | `buildAssessmentPrompt()` — renders the LLM prompt. |
| `src/lib/scoring/recommendations.ts` | Deterministic fallback roadmap (per-dimension templates ranked by upside). |
| `src/lib/maturity/model.ts` | `LEVELS`, `DIMENSIONS`, `ARCHETYPE_WEIGHTS`, `levelForScore`, `postureFor`, constants. |
| `src/lib/maturity/forecast.ts` | Trend projection + ETA to next level. |
| `src/lib/cache.ts` / `src/lib/scan-cache.ts` | In-memory LRU + tiered cache orchestration. |
| `src/lib/types.ts` | All domain types (`RepoSnapshot`, `DimensionSignals`, `LlmAssessment`, `ScanReport`, …). |

## Known gaps

- **Coverage is a heuristic.** `estimateCoverage` caps confidence on truncated/large
  repos; it isn't ground truth, and reports below 50% coverage carry an "indicative only"
  warning.
- **PR + governance signals require a token.** Anonymous scans skip them and warn.
- **LLM fallback is automatic but lossy.** A failed LLM swaps to the deterministic mock;
  the report still renders but with `engine.provider: "mock"` and a warning.
- **No raw source is persisted** in the MVP — only the derived report (see
  [data-model.md](data-model.md)).

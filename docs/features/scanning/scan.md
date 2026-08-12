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
| Branch &amp; sub-path | A collapsed "Branch &amp; sub-path" disclosure under the scan box adds an optional git ref and monorepo sub-path, appended as `&ref=` / `&path=`. Pasting a `github.com/o/r/tree/<branch>` link prefills the branch. See [Scan scope](#scan-scope-branch--sub-path). | `src/components/scan/ScanScopeFields.tsx` |
| Scan gallery | Curated/live examples on the landing page; live entries come from `getPublicScanGallery()`. | `src/components/landing/ScanGallery.tsx` |

The report page then drives the actual scan over the streaming endpoint — see
[report.md](../reporting/report.md).

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
  "fresh": true,    // /api/scan only: skip the cached report, re-run
  "ref":     "develop",       // optional: score this branch/tag/commit, not the default branch
  "subPath": "packages/api"   // optional: aim the ingestion budget at this monorepo sub-tree
}
```

`ref` / `subPath` are also accepted on `GET /api/scan` as `?ref=` / `?path=` (which only reach a
real scan in `?mock=1` demo mode — `GET` is otherwise restricted to `peek=1`). Invalid values are
rejected **before** the quota block: `400 { code: "INVALID_REF" | "INVALID_SUBPATH" }`, and an
unresolvable ref is `404 { code: "REF_NOT_FOUND" }` — never a silent fall-back to the default branch.

`/api/scan` responses carry cache-provenance headers: `x-ascent-cache: hit | miss | hit-db`
and `x-ascent-dedup: hit | miss`.

Both routes reject an unparseable repo URL with `400 { code: "INVALID_URL" }` *before* any
quota is consumed, so a typo can never burn one of the free tier's monthly scan slots. (On
`/api/scan` this is checked after the cache-only `peek=1` probe, which keeps its cheap `204`.)

**Pre-scan gates — the same order on both routes** (`src/lib/scan-gates.ts`):

```
rate limit  →  sign-in wall  →  monthly quota
   429            401              429 { code: "monthly_quota" }
```

A caller who trips more than one gate gets the **first** one, so a throttled anonymous caller sees
`429` with `Retry-After` on **both** routes — not `401` on one and `429` on the other, which is what
they returned before the orders were unified. Rate limit wins the tie because it is the truthful
answer (the shared scan budget is exhausted regardless of who is asking) and signing in would not
lift it. The limiter also always precedes the quota counter, so a throttled request never burns a
free monthly slot, and it records a `rate_limit` quota event on both routes.

The two routes differ only in *where* that sequence sits: `/api/scan` runs it **after** its free
cache-hit / `peek=1` / salvage returns, so hydrating a saved report stays unthrottled and free even
while the burst budget is exhausted; `/api/scan/stream` runs it at the top of the handler, since
reaching the stream already means a real scan. One deliberate exception: on `/api/scan` a
**private/installation** scan's sign-in wall still runs before the limiter (moving it later would let
an unauthenticated caller drive a GitHub ref resolve against a private repo), so an anonymous caller
passing `installationId` while throttled gets `401` there and `429` on the stream.

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
- `files: FetchedFile[]` — a **budgeted sample** (≤ 50 files + a reserved quota of ≤ 24 CI
  workflows, ≤ 14 KB each — 60 KB for CODEOWNERS — ≤ 280 KB total) chosen by
  `pickFilesToFetch`: agent-guidance files, manifests, configs, CI workflows, tests, and a
  sample of source. Public repos read from `raw.githubusercontent.com`; private repos use the
  Contents API. The budget is a **fixed constant, deliberately**: it is what makes two repos'
  scores comparable, so it is not request-configurable (see [Known gaps](#known-gaps)).
- `commits: CommitInfo[]` — up to 30 recent commits (message, author, login, date).
- `truncated`, `coverage` — flags that drive confidence + warnings.

Ingest accepts an optional `ref` (branch/tag/SHA) so the pipeline can score a **PR head**
instead of the default branch — this is what the [gate](./gate.md) and the App webhook use,
and what the public scan form's branch selector drives (below).

## Scan scope (branch &amp; sub-path)

An interactive scan can target something other than "the whole repo at its default-branch head":

| Input | Effect |
| --- | --- |
| `ref` | Ingest a branch, tag or commit instead of the default branch. |
| `subPath` | Spend the per-file content budget on one sub-tree of a monorepo. |

**Sub-path is a budget re-aim, not a filter.** The tree, commit history and every repo-level
enrichment (PR stats, governance, security posture/exposure) stay repo-wide, and repo-wide files —
root README/manifests, `CODEOWNERS`, `SECURITY.md`, and **every CI workflow** — are still read, so
the deterministic batteries that depend on them (notably D9's workflow battery) don't go blind. Only
the docs/test/source *sample* slots are scoped, plus the sub-tree's own manifests, which take prompt
priority over the root's. Prefix matching is exact-segment: `packages/api` never sweeps in
`packages/api-client`.

Three invariants hold, and are unit-tested (`src/lib/scan-scope.test.ts`,
`src/lib/scan-scope-cache.test.ts`, `src/lib/scan-scope-server.test.ts`):

1. **Identity.** The ref is resolved **server-side** to its own 40-char commit SHA
   (`resolveRefSha`), and that SHA keys the cache — never the default branch's head. A sub-path adds
   an explicit `!path:<dir>` key segment, because it reads a different file set at the *same* commit.
   So a ref/sub-path entry can neither collide with nor be served to a whole-repo reader.
2. **Subject.** A scoped report is **never persisted**. The corpus (leaderboard, `/report`'s
   "latest", org rollups, the regression-alert baseline) reads a repo's most recent persisted row, so
   saving a branch or single-package score would silently redefine what the repo scores. The scoped
   report is stamped with a warning saying it isn't comparable and wasn't saved, the completion email
   is suppressed (its permalink wouldn't resolve), and the peek / error-salvage paths return `204`
   rather than a whole-repo report.
3. **Trust.** Because it never enters the corpus, a client-supplied ref can't get a flattering
   cherry-picked commit scored, saved and later served as the repo's public reading — the same attack
   `/api/scan/stream` refuses a client-supplied `headSha` for.

A ref that resolves to the **default branch's head** is not scoped: same commit, same tree, same
score, so `?ref=main` keeps full cache reuse and normal persistence.

Definitions live in `src/lib/scan-scope.ts` (pure, shared with the form) and
`src/lib/scan-scope-server.ts` (validation + resolution, shared by both routes).

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
  `PR_QUERY` fetches each PR's title/body/labels/reviews **plus (W2) the merge-commit
  message, the PR's last ≤15 commit messages, and `__typename` on review authors** — the
  inputs for trailer attribution and AI pre-review below.
  AI involvement is detected through **three channels** (one shared predicate,
  `readAiInvolvement`, precedence `authored > marked > trailer`):
  `authored` — an AI agent bot opened the PR; `marked` — AI fingerprints in
  title/body/labels; `trailer` (W2) — a **merged** PR whose merge-commit or PR-commit
  messages carry an AI attribution trailer (`Co-Authored-By:` / `Assisted-By:` naming a
  tool — the squash-merge case the self-declared markers structurally miss). The trailer
  vocabulary is shared with the commit-level detector via `ai-tools.ts:AI_TRAILER_SOURCE`.
  Two merged-PR-denominated rates land in `PrStats` behind the same ≥5-sample floor as
  their siblings (null below it, never a fabricated 0): `aiTrailerRate` (share of merged
  PRs carrying a trailer, precedence-independent) and `aiPreReviewedRate` (share of merged
  PRs an AI/bot reviewer — `ai-tools.ts:AI_REVIEW_BOTS`: CodeRabbit, Copilot code review,
  Greptile, … — reviewed **before the first human review**). Per-channel counts
  (`aiAuthoredPrs`/`aiMarkedPrs`/`aiTrailerPrs`) sum to the AI-involved population.
  The same call also returns `aiChanges` — the **AI-change population** (`extractAiChanges`):
  one evidence row per AI-attributed PR carrying the author, how it was identified
  (`authored` by an agent, `marked` by a human, or `trailer` from commit messages), the
  tools named, and **who approved it and when**. Same shared predicate as the rates, so the
  row count always reconciles with `aiInvolvedRate`. Persisted (never scored) as `AiChange`;
  costs no extra GitHub calls — the PR nodes were already fetched and previously discarded.
  `approved: false` with a null approver is the finding an auditor is looking for, and
  `reviewCount` distinguishes it from "never reviewed at all".
- `src/lib/github/governance.ts:fetchBranchGovernance` — branch protection + rulesets.
  Folds into D6/D3/D8. `fetchCommitActivity` adds 52-week commit history.

Both `applyPrSignals` and `applyGovernanceSignals` (`pulls.ts`) skip a dimension outright
when `signals.failed` is set — a crashed detector's placeholder `signalScore: 0` is never
blended with real PR/governance evidence or decorated with evidence text that would make a
non-measurement look like a real, evidenced score.

D2's "sampled tests assert nothing" −15 penalty (a high case count with zero substantive
assertions in the content-sampled slice) only fires when the sampled test files cover at
least `MIN_SAMPLE_FRACTION` (0.3) of the repo's *total* detected test files (by path, not
just the ≤32-file content-ingest budget). Below that fraction the penalty downgrades to a
neutral, non-scoring note — a small, unlucky slice of a large suite can't indict the whole
suite as untested.

### 3 — Score with the LLM (`src/lib/scoring/prompt.ts` + a provider)

`buildAssessmentPrompt()` renders a compact prompt: the rubric (levels + dimensions), the
deterministic signal block, the sampled file contents, and a commit sample. The selected
`LLMProvider.assess()` returns an `LlmAssessment` — per-dimension score + summary +
strengths/gaps, an overall headline, cross-cutting strengths/risks, an invitational
`roadmap`, and `discrepancies` (signals the LLM thinks the detectors got wrong).

If the LLM fails or returns an unusable result (`isAssessmentUsable()` requires ≥ 50% of
dimensions), `scanRepository` automatically falls back to `MockProvider` and adds a
warning. Provider selection and the abstraction are documented in
[llm-providers.md](./llm-providers.md).

### Outcome counters (`src/lib/scan-outcome.ts`)

The `Scan` table holds **successes only** — there is no status column, and a run that throws
persists nothing. `scanRepository` therefore wraps the pipeline in four best-effort `QuotaEvent`
tallies so a failure is not invisible:

| Kind | Meaning |
| --- | --- |
| `scan_started` | Every attempt — the raw denominator. |
| `scan_rejected` | User-side and correctly handled: bad URL, private/missing repo, empty repo, client disconnect. |
| `scan_failed` | The pipeline itself: GitHub rate-limit, upstream 4xx/5xx, unhandled throw. |
| `scan_degraded` | Fell back to the mock floor — a report rendered *without* the model. |

The error rate is `scan_failed / (scan_started − scan_rejected)`: folding rejections into the
numerator would make the metric track funnel traffic rather than reliability. Read it back via
`scanPipelineErrorRate()` in [`src/lib/db/kpi-metrics.ts`](../../../src/lib/db/kpi-metrics.ts).
These are running all-time totals, not a time series, so the rate is a lifetime figure.

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

### App Readiness Passport & autonomy tier (`src/lib/analyze/passport*.ts`)

`scan-compose.ts` also attaches `report.passport = buildPassport(report, snapshot)` — a pure,
deterministic, display/persist-only projection (never fed back to the prompt or the score). Passport
**0.3.0** added two structured artifact booleans and a derived autonomy verdict:

- **`artifacts.sandbox`** — a committed, reproducible environment definition: `.devcontainer/` /
  `devcontainer.json`, `Dockerfile`, `docker-compose`/`compose` files, `flake.nix`/`shell.nix`/
  `default.nix`, or `.tool-versions` (tree-index presence).
- **`artifacts.hooks`** — guardrail hooks: `.husky/`, `lefthook.*`, `.pre-commit-config.*`, or a
  `"hooks"` block in `.claude/settings.json` — the settings file counts **only when its content was
  fetched** (presence alone proves nothing about hooks).
- **`autonomy`** (`src/lib/analyze/passport-autonomy.ts`) — the per-repo autonomy tier: "what can
  you safely hand an agent in this repo?" A cumulative T0→T3 ladder:
  - **T0 observe-only** — the default.
  - **T1 tests/docs/refactors** — agent instructions committed + a one-command `test` script +
    `tests.level ≥ partial`.
  - **T2 features with review** — T1 + `ci.level ≥ gated` + `tests.level ≥ substantial` +
    (`hooks` OR `sandbox`).
  - **T3 scheduled autonomous** — T2 + `aiInWorkflow` + `evals ≠ none` + versioned migrations.

  Each unmet predicate emits a human-readable `missing` string in `autonomy.unlocks` (cumulative per
  tier — the checklist that unblocks it), and `autonomy.inputs` records the raw predicates so the
  grant is auditable. **Token honesty**: a tokenless scan (`governance` null) caps the grant at T1
  and names the limitation in `missing`. **Migration honesty**: `PASSPORT_VERSION` is `0.3.0`;
  `upgradePassport` (applied read-time via `parsePassportJson`) derives tiers for stored pre-0.3.0
  rows *without* a rescan, but leaves `sandbox`/`hooks` absent (unknown, never a fabricated false) —
  the T2 checklist then names the re-scan instead of a missing artifact.

### Context Health (`src/lib/analyze/context-health.ts`) — W4

`scan-compose.ts` also attaches `report.contextHealth = deriveContextHealth(…)` — the
quality-over-presence read of the repo's agent-context layer (CLAUDE.md / AGENTS.md /
`.cursorrules` / Copilot instructions). Like `passport`/`techStack` it is **display/persist-only**:
it never feeds the score or the LLM prompt (pinned by the "stays display-only" test in
`context-health.test.ts`); folding it into D1 later is a deliberate `SCORING_RUBRIC_VERSION` event.

- **Ingest cost** — at most **3 extra REST calls per scan**: `pickGuidanceFiles` selects ≤3
  guidance files from the already-fetched tree (root-first, CLAUDE.md > AGENTS.md > rules files) and
  `fetchGuidanceFreshness` (`src/lib/github/source.ts`) asks
  `GET /repos/{o}/{r}/commits?path=<file>&per_page=1&sha=<ref>` for each — the file's last-modified
  date + last-commit SHA. Works **keylessly** within rate limits; the promise overlaps the LLM stage
  (awaited at compose time, like commit activity). File **size in bytes** comes free from the tree.
- **Degrade, never fail** — any per-file lookup failure (rate limit, timeout, empty history) yields
  a `path`-only entry that derives as *freshness unknown* (`freshness.score: null`); the composite
  renormalizes over quality+drift. A scan is never failed or a date fabricated for this signal.
- **Staleness is approximate by design** — `commitsSinceEdit` is read off the scan's weekly
  `commitActivity` buckets since the guidance's last edit (partial week pro-rated), flagged
  `approximate: true` always and `windowCapped` (a lower bound) when the edit predates the ~12-week
  window. Tokenless scans have no activity blob → age is reported, potency stays unknown.
- **Quality** reuses `guidanceQuality()` (the D1 content grader, exported from
  `src/lib/analyze/index.ts`) normalized to 0..100 — the two surfaces can't disagree about what
  good guidance means.
- **Drift** — `@file`-style path references in the guidance are extracted and checked against the
  tree index (zero extra fetches); a **dead ref** (guidance pointing at a deleted file) is the
  measurable drift signal.
- **Shape** — `ContextHealth { version, present, files[{path, lastModifiedAt?, lastCommitSha?,
  bytes?, sectionsScore}], freshness{score|null, ageDays, commitsSinceEdit, approximate,
  windowCapped?}, quality{score, signals}, drift{score, refsTotal, deadRefs}, score }`. Persisted as
  `Scan.contextHealthJson`, latest cached on `Repository.contextHealthJson`
  ([data-model.md](../data/data-model.md)); surfaced as the Repositories tab's Half-life panel
  ([org-intelligence.md](../org-dashboard/org-intelligence.md)).

## Maturity model (`src/lib/maturity/model.ts`)

The model file is configuration, not logic — a single source of truth for levels,
dimensions, weights, and the scoring constants.

**Levels** (`LEVELS`): L1 Manual `[0–24]` · L2 Assisted `[25–44]` · L3 Augmented
`[45–64]` · L4 Integrated `[65–84]` · L5 Autonomous `[85–100]`.

**Archetype weighting** (`ARCHETYPE_WEIGHTS`) — each archetype (`solo`/`team`/`org`)
defines a full set of D1–D9 weights summing to 1 (validated by `weightsAreValid()` outside
prod). The *org* lens (default) leans on D1/D2/D3/D8; *solo* leans on D1/D2/D6. Forecasting
helpers (`src/lib/maturity/forecast.ts`) project a maturity trend line and ETA to the next
level — used by the org [Trajectory](../org-dashboard/org-intelligence.md).

## Caching (`src/lib/cache.ts`, `src/lib/scan-cache.ts`)

Two tiers, keyed by `owner/repo@sha[!scope]::{llm|mock}#fp` (`makeCacheKey`), where `#fp` fingerprints
the {provider, model, rubric} scoring identity and the optional `!scope` segment carries a sub-path
(see [Scan scope](#scan-scope-branch--sub-path)):

1. **In-memory LRU** (`src/lib/cache.ts`) — 100 entries, 15-min TTL, plus a separate
   `HeadHint` LRU (ETag + SHA, 6-hr TTL) for cheap conditional head requests.
2. **Persistent** (`src/lib/scan-cache.ts:lookupCachedScan`) — shared by both scan routes.
   It resolves the current head with a conditional request (`304 Not Modified` → free,
   unchanged), then looks up the in-memory tier, then the DB
   (`getScanReportByCommit`), then falls through to a fresh scan. `fresh=true` skips the
   cached *report* but still resolves the key/ETag.

Both tiers apply the same **max cache age** (`SCAN_MAX_CACHE_AGE_DAYS`, default 7 — set 0 to
disable): a report older than the gate is a miss and re-scans even when the head hasn't moved.
The memory TTL bounds how long an *entry* lives; the age gate bounds how old the *report*
inside it may be, so a DB hit that warms memory can't keep serving a report past the gate.

This makes re-scans of an unchanged commit instant and dodges GitHub rate limits.

**Coalescing.** Concurrent scans of the same uncached commit share ONE run
(`coalesceScan`): the first caller computes, later callers join and await the same result
(their quota slot is refunded — metering is on commit, not attempt). A joined SSE caller
receives the *same* live progress frames as the computing owner — it gets a "joining a scan
already in progress" frame, then a replay of the latest frame, then every subsequent one — so
a shared scan never looks stalled to the second viewer. Abort is refcounted: the shared run is
cancelled only when the last interested caller disconnects.

## Key files

| File | Role |
| --- | --- |
| `src/lib/scan.ts` | `scanRepository()` — top-level orchestrator: auth resolution, stage sequencing, progress emission, LLM call + fallback, warnings. |
| `src/app/api/scan/route.ts` | `POST`/`GET` blocking endpoint; cache lookup, persistence, provenance headers. |
| `src/app/api/scan/stream/route.ts` | SSE streaming endpoint with heartbeat + abort handling. |
| `src/lib/github/source.ts` | `GitHubPublicSource.fetchSnapshot()` — metadata, tree, file sampling, commits, conditional head. |
| `src/lib/analyze/index.ts` | `analyzeSignals()` — the 9 detectors, `classifyArchetype`, `detectAiUsage`, `computeContributors`. |
| `src/lib/analyze/pulls.ts` | PR stats over GraphQL; folds into D6/D7/D8. |
| `src/lib/analyze/passport.ts` | `buildPassport()` — the pure App Readiness Passport projection (barrel for grades/score/autonomy/overlay/migrate siblings), incl. the 0.3.0 sandbox/hooks detectors. |
| `src/lib/analyze/passport-autonomy.ts` | `deriveAutonomyTier()` — the T0–T3 per-repo autonomy ladder + unlock checklists (token-capped; read-time derivation for stored rows). |
| `src/lib/analyze/context-health.ts` | `deriveContextHealth()` — guidance freshness/quality/drift (W4); `pickGuidanceFiles`, `commitsSince`, decay math, `parseContextHealthJson`. Display-only. |
| `src/lib/github/governance.ts` | Branch protection / rulesets / commit activity. |
| `src/lib/scoring/engine.ts` | `assembleReport()` — guardband, blend, rollup, axes, posture. |
| `src/lib/scoring/prompt.ts` | `buildAssessmentPrompt()` — renders the LLM prompt. |
| `src/lib/scoring/recommendations.ts` | Deterministic fallback roadmap (per-dimension templates ranked by upside). |
| `src/lib/maturity/model.ts` | `LEVELS`, `DIMENSIONS`, `ARCHETYPE_WEIGHTS`, `levelForScore`, `postureFor`, constants. |
| `src/lib/maturity/forecast.ts` | Trend projection + ETA to next level. |
| `src/lib/cache.ts` / `src/lib/scan-cache.ts` | In-memory LRU + tiered cache orchestration (incl. `lookupScopedScan`). |
| `src/lib/scan-scope.ts` | Pure scope predicates: ref/sub-path validation, `isScopedScan`, the cache-key segment, the report caveat. Shared with the scan form. |
| `src/lib/scan-scope-server.ts` | `resolveScanScope()` — validates + server-side-resolves a request's ref/sub-path for both scan routes. |
| `src/lib/types.ts` | All domain types (`RepoSnapshot`, `DimensionSignals`, `LlmAssessment`, `ScanReport`, …). |

## Known gaps

- **Coverage is a heuristic.** `estimateCoverage` caps confidence on truncated/large
  repos; it isn't ground truth, and reports below 50% coverage carry an "indicative only"
  warning.
- **PR + governance signals require a token.** Anonymous scans skip them and warn.
- **LLM fallback is automatic but lossy.** A failed LLM swaps to the deterministic mock;
  the report still renders but with `engine.provider: "mock"` and a warning. It is no longer
  *silent* — each fallback bumps a `scan_degraded` tally (see [Outcome
  counters](#outcome-counters-srclibscan-outcomets)) — but the rate is all-time, so there is
  still no way to ask "did degradations spike this week" without a real event table.
- **No raw source is persisted** in the MVP — only the derived report (see
  [data-model.md](../data/data-model.md)).
- **The ingestion budget is not configurable per request, on purpose.** A bigger budget changes
  which files the *deterministic* detectors see (they read whole file bodies with length
  thresholds), so it changes the score — two repos scanned under different budgets would not be
  comparable, and the persisted corpus has no column to mark which budget produced a row. Raising
  the budget for large repos is therefore a *global, versioned* decision (bump
  `SCORING_RUBRIC_VERSION`, which self-invalidates both cache tiers), not a request knob. A
  per-scan budget would need a schema column recording it plus comparability handling in every
  rollup that averages across repos.
- **Sub-path scans are not saved.** They're a diagnostic lens on one package, not a second score
  for the repo, so there is no per-package history or trend (that would need a first-class
  "component" object, not a scan flag).
- **Lockfiles are read for exposure, not for pinning.** `src/lib/security/exposure.ts` already
  fetches and parses `package-lock.json` out-of-band and grades open known vulns via OSV (a
  stronger signal than pinned-vs-floating). Other ecosystems (`pnpm-lock.yaml`, `Cargo.lock`,
  `go.sum`, `poetry.lock`) return `known:false` = UNKNOWN, treated as neutral — never "clean".
  Lockfiles are deliberately **not** added to `pickFilesToFetch`: they are large, low-signal-
  per-byte, and would displace README/manifests/source from the prompt window.

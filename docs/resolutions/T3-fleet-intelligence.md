# T3 — Fleet & portfolio intelligence → the due-diligence report

_Resolution doc, 2026-07-28. Resolves the five directions in `docs/GOLDEN-TRIO.md` §T3 into an
implementable design. Every claim below was checked against the code; where `GOLDEN-TRIO.md`,
`VALUE-CASE.md` or `tiger/backlog.md` are wrong, the correction is called out explicitly._

**Method.** Read the shipped query layer (`src/lib/db/org-*.ts`), the assemblers (`src/lib/org/*.ts`),
the scoring engine, the scan cache, the PDF/CSV export routes, the gate, and the integrations spend
path. Market check against Sema's Code Scan Report pillars and 2026 PE tech-DD scopes (sources at the
end).

---

## 0. The two hard preconditions

### 0a. The GitHub-native scoring bias — **partly settled, and the doc on both sides is wrong**

`GOLDEN-TRIO.md:166` and `VALUE-CASE.md:40` both say the golang-floor fix is "claimed fixed but
**never re-scan-validated**". That is half right, and the half it gets wrong matters.

**What was actually changed** (all shipped, all live in `master`):

- `src/lib/analyze/index.ts` — D3 recognizes off-GitHub CI (Gerrit `Reviewed-on:`/`Change-Id`,
  bors/homu `r=`, `bors.toml`, `.buildkite/`, LUCI/Prow), and decouples D3/D6 sub-signals from
  `workflowText`-only by scanning Makefile/justfile/Taskfile/CI scripts.
- `src/lib/security/checks.ts` — GitHub-native D9 sub-checks become `n/a` instead of `0` when there is
  no GitHub CI; `govulncheck`/`cargo-audit`/`cargo-deny` detectors added; the `^permissions:` regex
  widened to `^\s*permissions:` so job-level least-privilege blocks are seen.
- `src/lib/analyze/pulls.ts` — review credit from merge-queue/Gerrit trailers.
- `src/lib/scoring/engine.ts:67-74, 151-161` — the **D9 visibility escape hatch**: a high-confidence,
  D9-targeted LLM discrepancy makes D9 *unmeasurable* (dropped + renormalized) rather than a measured 0.
- `src/lib/scoring/engine.ts:173` — the guardband **doubles to ±50** for any dimension the LLM flagged
  as a detector discrepancy, so the model's correct diagnosis can move the number.

**What validation exists — and it is more than "none".** `src/lib/analyze/signals.test.ts:286-336` is a
composite regression suite named for this exact issue. It builds a golang/go-shaped fixture (Gerrit
trailers, Makefile-driven tests, **no** `.github/workflows`) and its GitHub-Actions twin differing *only*
by CI hosting, then asserts:

- `D3.signalScore >= 35` for the off-GitHub repo (was a false ~1), and
- `|overall(offGitHub) − overall(gha)| <= 8` (was 20 vs 74).

**Why that still isn't enough to claim the bias is gone.** Three reasons, in order of severity:

1. **It is a synthetic fixture, not a repo.** The same author wrote the detector and the fixture that
   proves it fires. It certifies "the trailer patterns I coded for are recognized", not "world-class
   off-GitHub orgs now score fairly". The 6-file `GO_FILES` fixture has none of golang/go's actual
   shape.
2. **It only exercises the deterministic layer.** `analyzeSignals` + `overallScoreFor` are called
   directly; the LLM blend, the guardband, and the D9 escape hatch (the parts most likely to move a
   real score) are untested here. The escape hatch in particular is triggered by a **regex over LLM
   free text** (`engine.ts:68`) — that cannot be validated by a signal-layer unit test.
3. **The tolerance is loose relative to the levels.** `<= 8` points spans most of a level band
   (bands are 20 points wide, `model.ts:48-88`) and is wider than the whole 45–55 posture corridor.
   Passing this test is compatible with CI hosting still costing a repo one level.

**What validation would actually settle it.** A re-scan of the original 10-org corpus
(`reference-data/dump-*.json` holds the pre-fix per-repo reports as the baseline) with a **pinned**
provider + model + `SCORING_RUBRIC_VERSION`, `LLM_TEMPERATURE=0`, and `fresh=1`; then compare
per-repo D3/D6/D9 and org `avgOverall` against the baseline. Two acceptance conditions:
(a) golang's `avgOverall` moves off 20 into the same band as its GHA-native peers, and (b) the
**GHA-native orgs barely move** (the P0 changes claim byte-identical behavior on the GitHub path —
if vercel/huggingface shift materially, the "calibration doesn't drift" claim is false and the whole
corpus needs recalibrating). Note the dumps are `{org, rollup, modules, reports}` — scan *outputs*,
not repo snapshots — so this requires a live re-fetch, roughly 110 scans.

**Verdict: Direction 2 is unsafe today.** But the blocker is no longer "the fix might not work"; it is
"the fix has never been measured against the real corpus, and the corpus itself is contaminated"
(§0c below). Say the corrected version out loud in the strategy doc.

### 0b. Re-scan wobble — **`tiger/backlog.md` P2-7 is stale; a noise floor exists**

P2-7 says `diffScans` reports any delta "with no R²/flat-floor/CI gate". **That is no longer true.**
`src/lib/maturity/noise.ts` ships a canonical `SCORE_NOISE_BAND = 2` with `isWithinNoise` /
`classifyDelta`, and is applied in:

- `src/lib/alerts.ts:68, 366` and `src/app/api/cron/digest/route.ts:168, 173` (digest gainers/regressers),
- `src/components/ui/format.ts:11, 38, 46` (a `≈` glyph + muted tone for sub-band deltas).

**How big the wobble actually is, precisely:**

| Path | Movement on an unchanged repo |
|---|---|
| Re-scan inside the caches (15 min memory / **7 days** DB, `scan-cache.ts:27-40`), same provider+model+rubric | **Exactly 0** — the identical persisted report is served (`scan-cache.ts:161-165`). Most "re-scans" never re-score. |
| Genuine re-score, healthy full-coverage scan | **0 overall, ±1 per dimension** — the one empirical measurement, `noise.ts:5-8` (two independent claude-cli re-scans, UAT pricing-20, 2026-06-20). **n=1.** |
| Genuine re-score, arithmetic worst case | Per dimension `0.6 × 2 × 25 = ±30`; **±60** for a dimension the LLM flagged as a discrepancy (band doubles, `engine.ts:173`). Nothing bounds this — no seed, no median-of-N, no write-time floor. |

**Four structural cliffs make small perturbations look like real moves.** These matter more than the
continuous noise:

1. **The D9 escape hatch is a regex coin-flip.** `engine.ts:67-74` — whether the model happens to write
   "default-setup" or "org-level" in its D9 discrepancy decides whether D9 is *scored* or *dropped and
   renormalized*. At D9's 9% org weight, that is a multi-point step change in the headline on an
   identical commit.
2. **Guardband doubling** (`engine.ts:173`) is likewise gated on whether the model chose to emit a
   `discrepancies` entry that run.
3. **Coverage feeds the blend.** `effectiveBlend = SCORE_BLEND × coverage` (`engine.ts:120-121`) — a
   rate-limited or truncated ingest on run 2 shifts weight to the deterministic signal and moves the
   number with zero repo change.
4. **No hysteresis anywhere.** Posture flips at exactly 50 (`model.ts:374-379`, admitted in
   `maturity-model.md` §2b: "a ±1-point re-scan can flip the quadrant"); level bands flip at 25/45/65/85.
   A level demotion fires a **critical** alert at any magnitude (`alerts.ts:83-98`) — *unfiltered by the
   noise band*.

**And the noise band is not applied where T3 needs it.** `getOrgMovers` (`org-insights.ts:179-180`)
partitions gainers/regressers on **strict sign**, so a `+1` is a genuine "gainer" in the raw data that
the Executive Briefing and `/portfolio` both read. `getOrgBenchmark` applies no band at all.

**Verdict.** The wobble is small on the common path and honestly displayed, but it is *not guaranteed*,
its empirical basis is a single repo pair, and the label-flip cliffs are unguarded. A diligence report
(Direction 1) and a percentile (Direction 2) both need this closed. The fixes are cheap and are listed
as **W1–W4** in §6.

### 0c. A new finding: the benchmark corpus is contaminated

Not in any doc. `getOrgBenchmark` (`src/lib/db/org-insights.ts:638-660`) selects the latest scan of
every repo outside the org with **no filter on `engineProvider`**. So:

- **Mock/deterministic-only scans count as peers.** The seeder defaults to `mock=true`
  (`enterprise.md` §6), and a keyless deploy silently serves the mock floor. A corpus that is partly
  signal-only is being percentile-ranked against LLM-blended orgs. `getOrgEngineMix` exists and the
  Briefing already renders an `engineMixCaveat` (`briefing.ts:32`) — the benchmark ignores it.
- **Different rubric versions count as peers.** `SCORING_RUBRIC_VERSION` busts the *cache*
  (`cache.ts:65-91`) but nothing prunes or re-bases persisted pre-bump scans out of the corpus.
- **The corpus is a recency sample, not a population.** `BENCHMARK_CORPUS_CAP = 5000` ordered by
  `updatedAt desc` (`:623, :651-654`) — a deliberate, well-documented memory bound, but it means the
  "corpus" is whatever was scanned most recently, which correlates with who is onboarding.

This is a harder blocker for Direction 2 than the golang bias, because it is silent.

---

## Direction 1 — Technical due diligence as a packaged engagement

### Verified against code

The strategy doc's claim that Sema's pillars "map almost 1:1 onto surfaces ascent already ships" is
**mostly true but overstated by two pillars**. Sema's Code Scan Report covers **code security, open-source
IP risk, code quality, process quality, team quality**.

| Sema pillar | ascent today | Verdict |
|---|---|---|
| **Process quality** | `buildGovernanceOverview` (`src/lib/org/governance.ts:101`) — gate pass-rate, per-repo failing conditions, `closestToGreen` worklist; `getOrgPrSignals` / `getOrgGovernance` (Delivery tab); `getOrgRollup` dimension averages (`org-rollup.ts:311`) | **Ships.** Strongest pillar. |
| **Team quality / bus factor** | `getContributorInsights` (`org-contributors.ts:65`) — `busFactor` computed by commit-share accumulation (`:148-171`), `soloMaintainer` at top-share ≥80% or n=1 (`:168`), `staleRepos`, champions; `getOrgTeamRollup` (`org-teams.ts:362`) per-CODEOWNERS-team posture + knowledge score | **Ships.** Second strongest. |
| **AI-code exposure** | `prStats.aiInvolvedRate` + `aiGovernedRate` with per-tool attribution; `aiUsage` re-derived from PR-level involvement (reference-scan P0-5), persisted via `aiUsageJson` | **Ships**, with the P0-5 caveat that it must stay regression-tested. |
| **Code security** | `buildSecurityOverview` (`src/lib/org/security.ts:86`) — per-repo 0–10 control battery + vuln exposure, gate-banded, `securityMarkdown` + a dedicated `/api/org/security/pdf` | **Ships**, bounded by the documented "config-as-code only" ceiling (`calibration.md`). |
| **Fleet distribution** | `postureCounts` + `dimAverages` + `repos[]` (`org-rollup.ts:383-391`), `getOrgGapAnalysis` org-common vs repo-outlier split (`org-insights.ts:927`), `getOrgMovers`, `forecastTrajectory` | **Ships.** The widest gap vs Factory, as claimed. |
| **Open-source / IP risk (licenses)** | **Nothing.** No license detection, no SPDX/copyleft flagging anywhere. | **Missing.** |
| **Code quality (defect-level)** | **Nothing.** D2/D6 measure *whether guardrails exist*, not code health. `VALUE-CASE.md:19` already concedes this vs Sonar. | **Missing.** |

So: **five of seven pillars ship; two do not.** A DD artifact that silently omits license/IP risk will be
rejected by a PE buyer — that is a standard scope item. The honest packaging is a *scoped* report that
names its own boundary.

Supporting infrastructure that already exists: `@react-pdf/renderer` documents + shared theme
(`src/lib/pdf/theme.tsx`), a working branded PDF path (`api/org/briefing/pdf/route.ts:59-71` with an
entitlement re-check at render, SSRF-guarded logo → data-URI), CSV egress
(`api/org/export/route.ts`, kinds `contributors|delivery|passports|teams`, fail-closed on unknown
scope), `CopyForLlm` markdown export, and the signed anonymous share link
(`api/org/briefing/share` → `/share/briefing/[token]`, `noindex`).

### The gap in code terms

1. No assembler that composes the pillars into one object. Each builder is called by its own page.
2. No DD-shaped artifact. The briefing PDF is a *period* report (movement, goals, trajectory); a DD
   report is a *point-in-time* report (standing, concentration, exposure, risk register) with no
   period framing.
3. No **coverage/fidelity ledger**. A DD report must state, per pillar, what was measured, on how many
   repos, with which engine, and what could not be seen. All the inputs exist
   (`getOrgEngineMix`, `report.warnings` via `warningsJson`, `report.confidence`/coverage,
   `axisMeasured`, `n/a` security checks) — nothing aggregates them.
4. No scope selector. A diligence engagement is over a named repo set; segments
   (`src/lib/db/segments.ts`) are the right primitive and already thread through every rollup as
   `segmentId`, but there is no "engagement" concept that pins a repo set + a date.
5. Branding does not reach the report/security PDFs (`report-document.tsx`, `security-document.tsx`
   take no branding param; `report/pdf/route.ts:72` hardcodes an `ascent-` filename).

### The design

**Query layer.** One new pure assembler, no new queries:

```
src/lib/org/diligence.ts
  buildDiligenceReport(orgSlug, { segmentId?, techGroupId?, asOf? }) -> DiligenceReport | null
```

Composes, in parallel: `getOrgRollup`, `getOrgGapAnalysis`, `getContributorInsights`,
`getOrgTeamRollup`, `buildGovernanceOverview`, `buildSecurityOverview`, `getOrgPrSignals`,
`getOrgEngineMix`, `getOrgBenchmark` (**percentile suppressed until §0 clears** — carry it as
`benchmarkAvailable: false` with a reason string, not a number). Plus one genuinely new pure function
in the same file:

```
buildCoverageLedger(rollup, engineMix, repos) -> PillarCoverage[]
  { pillar, reposMeasured, reposTotal, engine: "llm"|"mixed"|"signal-only",
    unmeasured: string[], caveats: string[] }
```

fed by the persisted `warningsJson` (reference-scan P1-5), per-scan `confidence`, `axisMeasured`
(`model.ts:353`), and the security battery's `n/a` checks.

**Schema.** One additive model, mirroring the `Segment` pattern (TEXT JSON, no jsonb, DSQL-safe):

```prisma
model DiligenceEngagement {
  id, orgId, name, segmentId?, createdAt, asOf, createdByLogin,
  scopeJson   String   // frozen repo fullName[] + commit shas at freeze time
  notesJson   String?  // per-pillar analyst annotations
  @@unique([orgId, name])
}
```

The frozen scope is the load-bearing part: a DD report must be reproducible six months later, and
`getOrgRollup`'s "latest scan per repo" is not. Freeze `fullName@sha` and read through
`getScanReportByCommit`.

**API routes.**
- `GET /api/org/diligence?org=&segment=&format=json|md` — the assembled object / markdown.
- `GET /api/org/diligence/pdf?org=&engagement=` — `@react-pdf` document, branded (extend the
  briefing PDF's entitlement-re-check + logo-data-URI pattern verbatim).
- `POST /api/org/diligence/engagement` — freeze a scope. Owner-gated (`requireOrgOwnerPost`).
- Extend `api/org/export/route.ts` with `kind=diligence-repos` (per-repo row: level, overall,
  adoption, rigor, posture, D1–D9, bus factor, AI-involved %, AI-governed %, security band, gate
  verdict) — the appendix spreadsheet every DD buyer asks for.

**UI.** `src/app/org/[slug]/diligence/page.tsx` under Govern. Sections in buyer order: Verdict &
scope → Fleet distribution (posture quadrant, §3) → Process quality → Team quality & key-person risk
→ AI-code exposure → Security posture → Coverage & method (the ledger) → **Out of scope** (license/IP,
defect-level code quality, runtime/infra — named explicitly). New components must respect the 300-LOC
rule: `diligence/DiligenceVerdict.tsx`, `PillarCard.tsx`, `CoverageLedger.tsx`, `OutOfScope.tsx`.

**Graceful degradation.** Everything here requires `DATABASE_URL` (unavoidable — it is a fleet
product; the layout guard at `org/[slug]/layout.tsx` already handles DB-less). Without a GitHub App:
public repos only via `/api/org/import`, and the ledger says so. Without an LLM key: the engine mix
reads `mock` and the ledger downgrades the whole report to `signal-only` — **and the PDF must refuse to
render a verdict in that mode**, per `VALUE-CASE.md` D32.

**Effort: M.** ~12–15 files (1 assembler + tests, 1 schema model + migration, 4 routes, 1 page,
4–5 components, 1 PDF document, doc). Depends on §3 (quadrant) for the distribution section and
consumes §4 (admission list) as the "operational recommendation" section. Does **not** depend on §2.

### Open decisions
- **D-T3-1.** Do we ship a DD report with license/IP risk explicitly out of scope, or build a minimal
  license detector first (manifest + `LICENSE` parsing is ~1 file, but SPDX-grade attribution is not)?
- **D-T3-2.** Priced per engagement or per repo scanned? The frozen-scope model supports either.
- **D-T3-3.** Does the DD report render at all when `engineMix` is majority-mock? Recommend: no.

---

## Direction 2 — The benchmark corpus as a compounding asset

### Verified against code

`GOLDEN-TRIO.md` treats this as unbuilt. **It is substantially built** — and better than the doc
implies. `getOrgBenchmark` (`org-insights.ts:638`) already delivers:

- Org-mean-vs-**other-org-means** percentile (`orgMeans`, `:698`) — a real bug-fix over ranking one
  aggregate inside a per-repo distribution, documented at `:693-697`.
- A **language peer cohort** (dominant `primaryLanguage`), with `overallPercentile` +
  `adoptionPercentile` (`:709-726`).
- Statistical floors: `CORPUS_MIN = 5` peer orgs, `COHORT_MIN = 5` — `percentileOf` returns `null`
  below them (`:627, :619, :631`), so a 1-org corpus can't emit "you beat 100%".
- Consumers already wired: Briefing tile (`executive/page.tsx:108-114`), peer-cohort line (`:141-147`),
  briefing PDF (`briefing-document.tsx:75-94`), `/portfolio` (`portfolio.ts:81,101`), digest ordinals
  (`alerts.ts:269`).

So the real Direction 2 is **not "build percentiles"** — it is **"make the existing percentile
trustworthy and add stack/size/archetype cohorts"**.

### The gap in code terms

1. **Corpus contamination** (§0c) — no engine/rubric filter. *This is the blocker.*
2. Cohorts are language-only. `archetype` is persisted on `Scan` (`enterprise.md` §2) and
   `classifyArchetype` already produces solo/team/org (`analyze/index.ts:908`); size (stars, contributor
   count, file count) is available at scan time but not persisted as a bucket. Tech-stack grouping
   exists separately (`src/lib/db/tech-groups.ts`) and is not joined to the benchmark.
3. No published methodology. `maturity-model.md` publishes the rubric; nothing publishes the corpus
   construction, the cohort definitions, the floors, or the known biases.
4. No noise treatment — a percentile is reported to the integer with no band (§0b).

### The design (gated)

**Phase 2a — corpus hygiene (do this regardless, it is cheap and it de-risks everything).**
In `getOrgBenchmark`, filter the corpus query to scans where `engineProvider NOT IN ('mock')` and
`rubricVersion = SCORING_RUBRIC_VERSION` (add `rubricVersion` to the `Scan` select; it is already in
the cache fingerprint, confirm it is persisted or add the column). Return `corpusEngine` +
`corpusRubric` on `OrgBenchmark` and render them next to every percentile. Return `null` percentile
when the eligible corpus falls under `CORPUS_MIN`. **~2 files. S.**

**Phase 2b — cohorts.** Add `archetype` and a `sizeBucket` (derived, bucketed at scan time and
persisted on `Scan` as a string: `xs/s/m/l/xl` by contributor count) to the corpus row, and generalize
the cohort block into `cohortsFor(corpus, me): Cohort[]` returning language / archetype / size /
tech-group cohorts, each independently floor-gated at `COHORT_MIN`. Render as a small table, not a
single number. **~4 files + 1 migration. M.**

**Phase 2c — published methodology.** A static `/methodology` page + `docs/BENCHMARK-METHODOLOGY.md`:
corpus construction and its recency cap, eligibility filters, cohort definitions, the floors, the
noise band, and a **Known biases** section that names the GitHub-native ceiling and the
config-as-code-only D9 limit. This is the thing that makes the number defensible; publishing the
limits is the asset, not the number. **~2 files. S.**

**Graceful degradation.** Already correct — `getOrgBenchmark` returns `null` DB-less, and every
consumer handles null (`executive/page.tsx:110` renders `—`).

**Effort: S+M+S ≈ M overall.** But **2b/2c are gated on §0a re-scan validation and §0c hygiene.**

### Recommendation — **disagree with the strategy doc's sequencing, but not with the direction**

`GOLDEN-TRIO.md` sequences 2 fourth. Split it: **do 2a now** (it is 2 files and it silently corrupts
every percentile already shipping in the Briefing PDF and on `/portfolio` — this is a live correctness
bug, not a feature), and **defer 2b/2c** until the corpus re-scan lands.

### Open decisions
- **D-T3-4.** Do we re-scan the 10-org reference corpus (~110 live scans, ~6 min median each per
  `scan-timing`) to validate §0a? Without it, 2b/2c stay blocked indefinitely.
- **D-T3-5.** Is the public `/leaderboard` corpus (PUBLIC org) the same corpus as the benchmark? Today
  they are different reads (`getPublicScanGallery` vs `getOrgBenchmark`). Published methodology forces
  us to say which one "the corpus" means.

---

## Direction 3 — Sell the quadrant, not the score

### Verified against code

The strategy doc calls this "copy + layout over shipped data". **Correct, and the computation side is
in even better shape than claimed.**

- `postureFor(adoption, rigor)` (`model.ts:377`) is canonical and single-sourced; `POSTURE_META`
  (`:409`) is the one taxonomy; `POSTURE_THRESHOLD = 50` carries a written rationale (`:363-373`)
  including the admission of no hysteresis.
- `axisMeasured` (`model.ts:353`) exists specifically so a fully-unmeasured axis can't silently place a
  repo in the wrong quadrant — `engine.ts:249-269` warns rather than asserting.
- `PostureQuadrant.tsx:37` is a finished dependency-free SVG with region tints, a threshold crosshair,
  axis labels, and **a trail to the previous scan** (`:152-158`).
- Postures are computed at every level of aggregation already: per repo (`engine.ts:284`), per team
  (`org-teams.ts:268`), per segment (`segments.ts:292, :349`), per simulated fleet (`orgsim.ts:119`).

### The gap in code terms — narrower than the doc thinks

1. **`PostureQuadrant` is rendered on exactly two surfaces, both per-repo**: the report Scoring tab
   (`PosturePanel.tsx:26`) and the roadmap sandbox (`RoadmapSandbox.tsx:184`). **No org-level page
   plots it.** The fleet shows postures only as *counts* (`org-rollup.ts:383`, rendered as distribution
   bars in `LiveWarRoomPanels.tsx:69`).
2. `/portfolio` already carries `adoption`, `rigor` and `posture` per company
   (`portfolio.ts:12-31`) and renders them as the bare string `"{adoption} / {rigor}"`
   (`PortfolioTable.tsx:73`).
3. The Executive Briefing headline is the **score**, not the quadrant. `briefing.ts` exposes only a
   scalar `adoptionRate` = share of repos at a high-adoption posture (`:260`, summing `ai-native` +
   `ungoverned`) — which conflates the two quadrants the story depends on separating. There is **no
   list of the "Fast & Ungoverned" repos** in `ExecBriefing`, the markdown, or the PDF.
4. Two *other* quadrants exist and will be confused with this one:
   `AiRoiQuadrant.tsx` (AI involvement × ROI, on `/delivery`) and `PassportScatter.tsx`
   (automation × production readiness, split at 65). Naming discipline is required.

### The design

**Query layer.** Extend `ExecBriefing` (`src/lib/org/briefing.ts:84`) with:

```ts
quadrant: {
  adoption: number; rigor: number; posture: Posture["id"];
  counts: Record<Posture["id"], number>;
  ungoverned: { fullName: string; adoption: number; rigor: number; overall: number;
                aiInvolvedRate: number | null; governedRate: number | null }[]; // named, capped ~8
  borderline: number; // repos inside the 45–55 corridor on either axis — the honesty counter
}
```

All inputs are already on `rollup.repos` (`OrgRepoRow` carries adoption/rigor/posture) and
`getOrgPrSignals.perRepo`. Pure derivation, one new tested function `buildQuadrantSummary(rollup, prSignals)`
in `briefing.ts` (watch the 393-LOC file — extract to `src/lib/org/briefing-quadrant.ts` and re-export,
per the barrel pattern in `AGENTS.md`).

**Schema.** None.

**API routes.** None new; the briefing PDF and markdown routes pick it up automatically because all
three renderers read one `ExecBriefing` object.

**UI.**
- Promote a fleet `PostureQuadrant` (avg adoption × avg rigor, with per-repo dots) to the **top** of
  `executive/page.tsx`, above the tiles. Reuse the existing component; add an optional `points[]` prop
  for the repo cloud. New file `src/components/org/executive/FleetQuadrant.tsx`.
- A named "Fast & Ungoverned" panel listing the repos, each deep-linking to its report and to
  `/org/[slug]/governance` — `src/components/org/executive/UngovernedPanel.tsx`.
- Mirror both into `briefing-document.tsx` (PDF) and `briefingMarkdown` (`briefing.ts:310`) — the
  three-renderer lockstep invariant is documented in that file and must be honored.
- `/portfolio`: swap the `"{adoption} / {rigor}"` cell for a mini quadrant glyph, or add a portfolio
  scatter above the table (`PortfolioTable.tsx:73`).
- **Honesty requirement:** render the `borderline` count with the existing corridor caveat. A quadrant
  headline with no hysteresis (§0b) is exactly the claim that breaks on the first re-scan.

**Graceful degradation.** Briefing already returns `null` at `scannedCount === 0`; the quadrant
suppresses when `axisMeasured` is false for either axis.

**Effort: S.** ~6–8 files, no schema, no new queries. Highest value/effort ratio of the five.

### Open decisions
- **D-T3-6.** Add posture **hysteresis** (e.g. require crossing 52 to enter a quadrant, 48 to leave)?
  This directly contradicts the deliberate 50-cut rationale in `model.ts:363-373` — it is a product
  call, not a bug fix, and it is a precondition for making the quadrant a *headline*.
- **D-T3-7.** Does D28 get decided by this? Shipping a quadrant-first briefing *is* choosing
  "briefing, not score". Say so.

---

## Direction 4 — Agent-admission control

### Verified against code — **the biggest correction in this document**

`GOLDEN-TRIO.md:174-178` frames this as new ("convert scoring into an operational decision"). **It is
roughly 70% shipped, under the name "Governance".**

`src/lib/org/governance.ts` (253 LOC) already produces, for a whole fleet:

- `buildGovernanceOverview(orgSlug, segmentId, techGroupId)` (`:101`) — every scanned repo evaluated
  against the org's gate policy; `passing` / `failing` / `passRate` (`:193-195`).
- `failures: GovernanceFailure[]` (`:58`) — worst-first, with the specific failing conditions per repo.
- `greenPath: GreenPathItem[]` / `closestToGreen` (`:34, :198`) — failing repos ranked by
  `failCount` then point-`gap` (`:185`), with per-dimension gaps and non-numeric `blockers`
  (level / posture).
- `governanceMarkdown` (`:218`) and `ciActionYaml` (`:212`) — **exportable already**.

And the policy layer is real:

- `GatePolicy` (`src/lib/scoring/gate.ts:13`) supports `minLevel`, `minOverall`, `minDimension`,
  per-dimension floors (`minDimensionFor`, e.g. `{D9: 50}`), `forbidPostures` (`["ungoverned"]`), and
  `requireProtectedBranch` — with fail-closed floor checks (`belowFloor`, `:53`) so an *unscored*
  dimension cannot slip the gate.
- `describeGatePolicy` (`:88`) renders one policy into four projections (human text, PR-comment chip,
  gate URL query, GitHub-Action `with:` line) so they cannot drift.
- `getOrgGatePolicy` / `setOrgGatePolicy` (`src/lib/db/org-gate.ts`) persist it per org, sanitized on
  write *and* read.
- `GET /api/gate/:owner/:repo` returns **200/422** for `curl --fail`, deterministic by default
  (`route.ts:26`), unauthenticated by design with `noAmbientToken` so it cannot be used to enumerate
  private repos.

### The gap in code terms — four things, all small

1. **Binary, not tiered.** The gate answers pass/fail. Admission control needs three tiers:
   `allowed` / `assisted-only` / `blocked`.
2. **One policy per org.** No per-repo or per-segment override. `Organization.gatePolicy` is a single
   TEXT column.
3. **The framing is "does this repo meet our quality bar", not "is it safe to let an agent in".** The
   inputs differ: agent admission cares about D2 (tests), D6 (guardrails), D9 (security), branch
   protection, `aiGovernedRate` (are AI PRs actually reviewed) and CODEOWNERS coverage — *not* about
   D5 docs or D7 velocity. There is no admission-specific scoring function.
4. **No machine-readable export of the decision.** `ciActionYaml` emits a CI snippet; there is nothing
   that emits an org ruleset, a CODEOWNERS suggestion, or an `.ai/manifest.yaml` fragment (the T2 tie-in).

### The design

**Query layer.** New pure module, sitting on top of the existing gate:

```
src/lib/org/admission.ts
  ADMISSION_INPUTS = ["D2","D6","D9"] as const   // rigor guardrails that make agent output safe
  admissionFor(repo: OrgRepoRow, gov: GovernanceFailure|null, pr: PrRepoSignal|null,
               policy: AdmissionPolicy) -> AdmissionVerdict
  buildAdmissionList(orgSlug, segmentId?, techGroupId?) -> AdmissionOverview
```

`AdmissionVerdict = { tier: "allowed"|"assisted"|"blocked", reasons: string[], gap: number, remediation: string[] }`.
Tiering rule (explicit, publishable, deterministic):

- **blocked** — any of: D2 or D9 below floor; posture `ungoverned`; default branch readable *and*
  unprotected; `aiGovernedRate` below policy with ≥3 AI PRs (reuse the existing `aiGovernedRate` gate
  condition from T1).
- **assisted** — passes the blocked bar but fails `minLevel` / `minDimension`, or has
  `busFactor === 1` / `soloMaintainer` (from `getContributorInsights.concentration`), or CODEOWNERS is
  absent (`org-teams.ts` "unowned").
- **allowed** — clears everything, and `axisMeasured` is true for rigor (never admit on an unmeasured
  axis).

Reuse `effectiveFloor` / `failsFloor` (`gate.ts:62, 67`) verbatim so admission and the CI gate cannot
disagree.

**Schema.** One additive column, mirroring `gatePolicy`:
`Repository.admissionOverride String?` (serialized `{tier, reason, setBy, setAt}`), plus
`Organization.admissionPolicy String?` for the org-level thresholds. TEXT JSON, sanitized at the edge.
A human override must be recorded in the audit log (`AuditLog`, action `admission.overridden`) — this
is the artifact a CISO is buying.

**API routes.**
- `GET /api/org/admission?org=&segment=&format=json|csv|yaml` — the ranked list.
  `format=yaml` emits an `.ai/manifest.yaml` `agents.admission` fragment (T2 tie-in) and/or a GitHub
  org-ruleset skeleton.
- `POST /api/org/admission/override` — owner-gated per-repo override, audited.
- Extend `GET /api/gate/:owner/:repo` with `?policy=admission` returning the tier in the JSON body
  while keeping the 200/422 contract on `blocked` (do not change the existing status semantics).

**UI.** `src/app/org/[slug]/admission/page.tsx` (or a tab on `/governance`, which is arguably the
better home — it is the same data with a different question). Ranked table: tier chip, repo, reasons,
cheapest remediation, override control. Components: `AdmissionTable.tsx`, `AdmissionSummary.tsx`,
`OverrideDialog.tsx`. Reuse `CopyForLlm` for the markdown export.

**Graceful degradation.** Works DB-less for a *single* repo through the existing gate endpoint (it
already runs a deterministic scan with no DB); the fleet list requires DB. Without an App token,
branch-protection is unreadable — the policy must then **not** fire `requireProtectedBranch` (the
existing gate already has this "only fails when governance was READABLE" guard, `gate.ts:24-29`) and
the tier must be reported as `assisted` with an explicit "protection unverified" reason, never
`allowed`.

**Effort: M.** ~10 files (1 module + tests, 1 migration, 3 routes, 1 page, 3 components). Depends on
nothing; **feeds Direction 1** (the DD report's operational recommendation) and the T1 gate.

### Open decisions
- **D-T3-8.** Is admission its own tab, or a lens on `/governance`? Recommend a lens — a second page
  reading the same data with a different verdict invites drift.
- **D-T3-9.** Does a human override expire? A stale "allowed" override on a repo that has since
  regressed is the failure mode that discredits the artifact. Recommend: overrides carry a
  `validUntil` and auto-lapse.

---

## Direction 5 — Cost-joined investment simulation

### Verified against code

**The strategy doc's claim "the spend join is already scaffolded" is true. Its implied claim that
`orgsim` can be extended with cost is not.**

`orgsim` (`src/lib/scoring/orgsim.ts`, 213 LOC) is:
- Fully deterministic and pure (`:3-5, :60`) — no `Date.now()`, no RNG, no DB, no LLM.
- Modelling **maturity points, not money**: a scenario is `{dimId, target}[]` applied to a repo scope;
  each present-and-below-target dimension is raised to the target (`:130-138`) and the live blend is
  re-run via `overallScoreFor` / `axisScore` (`:62-84`).
- `rankFleetInvestments` (`:192-212`) just runs one simulation per dimension at target 70 and sorts by
  fleet `avgOverall` gain.
- **Known weakness:** fleet averages are *unweighted per-repo means* (`:87`), so a toy repo counts as
  much as the monorepo. This matters more once dollars are attached.

The spend layer is real but thin:
- `AiUsageRecord` (`prisma/schema.prisma:885-902`): `orgId, source, scope, scopeKey, periodStart,
  tokens, costCents, sessions, seats, fidelity`, unique on the composite.
- `getOrgUsageRollup` (`src/lib/db/integrations.ts:93`) — trailing 35 days, per-repo keyed lowercase,
  seats as peak not sum.
- Ingest is **Claude Code OTLP/JSON only** (`integrations/otlp.ts:91-137`: three counters —
  `claude_code.token.usage`, `claude_code.cost.usage`, `claude_code.session.count`; seats = distinct
  `user.email`). Repo attribution comes solely from the `git.repository` resource attribute (`:96`) —
  **datapoints without it are silently dropped.** Protobuf → 415. Logs are accepted and discarded.
- Copilot and OpenAI are `status: "planned"` (`integrations/providers.ts:57, :72`) — **no connector
  exists**, which matches the `ai-usage-connector-feasibility` memory finding that those APIs don't key
  by repo anyway.
- Unconnected, `/delivery` runs on an **FNV-hash-simulated** spend layer
  (`aiDeliveryModel.ts:88-96, :162-171`): seats, plan assignment and monthly spend are invented from a
  hash of the repo name. To its credit, `classify()` gates the two spend-derived verdicts behind
  `spendReal` (`:104-115`), so it will not accuse a team of waste on fake dollars.

### The gap — and why the strategy doc's framing should be **killed**

The doc wants: *"closing D8 across these 12 repos costs $X and buys level Y in Z quarters."*

**The `$X` in that sentence does not exist and cannot be derived.** ascent has:
- **provider spend** (what AI tooling costs, when connected), and
- **maturity points** (what practice gaps exist).

It has **no cost-of-remediation model** — no effort estimates, no engineer rates, no historical
"closing D8 took N weeks" data. `Recommendation` carries `impactWeight`, not cost. To produce `$X` we
would have to invent an effort model, which is precisely the `aiDeliveryModel` FNV-hash mistake that
`VALUE-CASE.md` D32 was written to stop, escalated onto a customer-facing investment recommendation.

Also: the "Z quarters" half is already there and is **not** spend-joined —
`forecastTrajectory` + `projectGoal` (`forecast.ts:119, :272`) give ETA-to-target from the actual trend,
which is more defensible than any synthesized cost curve.

### The design — descoped to what the data supports

**Kill:** "closing D8 costs $X."
**Keep and ship:** *spend **exposure** joined to the simulator's target cohort* — a statement about
money that is entirely measured:

> "The 12 repos in this scenario currently carry **$4,100/mo** of measured Claude Code spend, of which
> **$2,600/mo** flows into repos at an `ungoverned` posture. Closing D8 to 70 across them moves the
> fleet from L2→L3 with an ETA of Q2 on the current trend."

Every number there is either measured (`getOrgUsageRollup`, `fidelity: "measured"`) or already
computed (`orgsim`, `forecast`). Nothing is synthesized.

**Query layer.** `src/lib/scoring/orgsim-cost.ts` — a pure joiner (keeps `orgsim.ts` DB-free and
under LOC):

```ts
joinScenarioSpend(scenario: FleetSimulation, usage: OrgUsageRollup | null, repos: OrgRepoRow[])
  -> { fidelity: UsageFidelity | "unavailable"; scopeMonthlyCents: number;
       ungovernedMonthlyCents: number; unattributedCents: number; coveredRepos: number }
```

`unattributedCents` is mandatory: OTLP drops datapoints with no `git.repository`, so the join *must*
report what it could not attribute or it repeats the aiUsage credibility failure.

**Schema.** None. Optionally `AiUsageRecord` already suffices.

**API.** Extend `POST /api/org/simulate` response with an optional `spend` block; hard-gate it on
`fidelity === "measured"` (never `allocated`, never `simulated`).

**UI.** One extra line in `Simulator.ProjectionResult.tsx`, rendered only when the join is measured,
with an explicit fidelity chip. Reuse the existing `locked`/simulated affordances from
`AiRoiLedger.tsx:108`.

**Graceful degradation.** No integration connected → the block is **absent**, not simulated. This is
the whole point.

**Effort: S** as descoped (~4 files). **L** if anyone insists on the cost-of-remediation model —
and that L is mostly fabrication.

### Open decisions
- **D-T3-10.** Accept the descope, or invest in a real effort model (would need engagement data we
  don't have and probably a customer-supplied rate card)?
- **D-T3-11.** Fix `orgsim`'s unweighted fleet mean (`:87`) before attaching dollars? A weighted mean
  changes existing simulator output, so it needs a deliberate call.

---

## 6. Ranking, build order, and the wobble work

### Value / effort

| # | Direction | Built | Effort | Value | V/E | Verdict |
|---|---|---|---|---|---|---|
| **3** | Quadrant-first briefing | ~70% (per-repo quadrant done, org-level missing) | **S** (~7 files) | High — differentiates the pitch immediately | **Highest** | **Ship first** |
| **4** | Agent-admission control | ~70% (`governance.ts` + `GatePolicy` + gate API) | **M** (~10 files) | High — CISO framing, feeds T1 gate and §1 | **High** | **Ship second** |
| **1** | Technical due diligence pack | ~65% (5 of 7 pillars) | **M** (~14 files) | Highest per-unit price ($25k–$110k manual alternative) | **High** | **Ship third** |
| **5** | Cost-joined simulation | Spend layer real, join absent | **S** (descoped) | Medium — closing arithmetic only | Medium | **Descope and ship late** |
| **2** | Benchmark corpus | ~60% (percentile + language cohort ship) | **M** | High long-term, **unsafe now** | Blocked | **2a now (bug fix), 2b/2c gated** |

### Recommended build order

**W (wobble hardening) → 2a → 3 → 4 → 1 → 5.**

This disagrees with `GOLDEN-TRIO.md`'s `3 → 1 → 4 → 2 → 5` in three places:

- **W and 2a come first.** They are small correctness work, not features, and both §1 and §3 put
  numbers in front of a buyer that the current code can wobble or contaminate. `2a` in particular is a
  **live bug**: a mock-polluted percentile already ships in the Briefing PDF and on `/portfolio`.
- **4 before 1.** `governance.ts` means 4 is a *lens* on shipped code, and 1 consumes 4's output as its
  operational-recommendation section. Building 1 first means writing that section twice.
- **5 is descoped, not sequenced last-but-equal.** As specified in the strategy doc it should not be
  built at all.

**The wobble work (W1–W4), ~5 files total, S:**

- **W1.** Set `LLM_TEMPERATURE=0` for the scoring path (already supported, `config.ts:53-55`) and pin
  provider + model for any number a customer anchors on. This is `VALUE-CASE.md` D29 and it is free.
  Note `claude-cli` has **no** temperature knob — so any anchored number must not come from claude-cli.
- **W2.** Apply `isWithinNoise` in `getOrgMovers` (`org-insights.ts:179-180`) so a `+1` stops entering
  `gainers` in the raw data every downstream consumer reads.
- **W3.** Make the two structural cliffs auditable rather than silent: when the D9 escape hatch fires
  (`engine.ts:151`) or the guardband doubles (`:173`), record it as a first-class field on the report
  (it currently only produces a `warnings` string). A diligence buyer must be able to see that D9 was
  dropped by an LLM prose match.
- **W4.** Decide hysteresis (D-T3-6). Without it, a quadrant-headline briefing (§3) can flip its own
  headline on an unchanged repo.

### Cross-direction dependency graph

```
W1-W4 ──┬──> 3 (quadrant headline needs hysteresis + noise honesty)
        ├──> 1 (DD report needs a stable number + the coverage ledger)
        └──> 2b/2c (percentile needs a noise band)
2a ─────────> 2b ──> 2c        (blocked on the §0a re-scan)
3 ──────────> 1                (DD "fleet distribution" section IS the quadrant)
4 ──────────> 1                (DD "operational recommendation" section IS the admission list)
4 ──────────> T1-2             (admission tiers feed the ungoverned-AI-change gate)
5 ──────────> (needs 1 or 4 to have a recommendation to close arithmetic on)
```

---

## 7. Corrections to `docs/GOLDEN-TRIO.md` §T3

1. **§T3-2 precondition is understated and misdirected.** The golang fix *does* have a deterministic
   composite regression test (`signals.test.ts:286-336`) — but it is a synthetic fixture, signal-layer
   only, with an 8-point tolerance. And the *real* blocker for Direction 2 is the **uncontaminated-corpus
   problem** (§0c), which no document mentions.
2. **§T3-4 is not a new build.** `buildGovernanceOverview` + `GatePolicy` + the 200/422 gate are ~70%
   of agent-admission control. Reframe as "tier the verdict and export the decision", not "convert
   scoring into an operational decision".
3. **§T3-2 is not unbuilt either.** `getOrgBenchmark` already ships org-vs-org percentiles, a language
   peer cohort, and statistical floors, consumed by the Briefing, the PDF, `/portfolio` and the digest.
4. **§T3-5 cannot deliver its own headline sentence.** There is no cost-of-remediation model and no
   basis for one. Descope to measured spend *exposure* on the scenario cohort.
5. **§T3-1's "1:1 pillar map" omits two Sema pillars ascent has nothing for:** open-source/IP license
   risk and defect-level code quality. A DD artifact must name them as out of scope.
6. **`tiger/backlog.md` P2-7 is stale** — `src/lib/maturity/noise.ts` exists with `SCORE_NOISE_BAND = 2`
   and an empirical basis, applied in alerts, the digest cron and the delta formatters. The residual gap
   is that it is *not* applied in `getOrgMovers`, in the benchmark, or to level/posture demotion alerts
   (which fire at any magnitude, `alerts.ts:83-98`), and its empirical basis is **n=1**.
7. **White-label reach is narrower than "white-label branding" implies.** It is a *briefing* white-label
   (`briefing-document.tsx`, `/share/briefing/[token]`). The **report PDF and security PDF take no
   branding parameter** and `report/pdf/route.ts:72` hardcodes an `ascent-` filename — which is a direct
   problem for Direction 1, where the forwarded artifact is the thing being sold.
8. **The `/leaderboard` corpus and the benchmark corpus are different reads**
   (`getPublicScanGallery` on the PUBLIC org vs `getOrgBenchmark`'s cross-tenant sample). Publishing a
   methodology forces a decision about which one is "the corpus".

---

## 8. Consolidated open decisions for the human

| ID | Decision |
|---|---|
| D-T3-1 | DD report: license/IP risk explicitly out of scope, or build a minimal license detector? |
| D-T3-2 | DD pricing: per engagement or per repo scanned? |
| D-T3-3 | Refuse to render a DD verdict when the engine mix is majority-mock? (Recommend: yes.) |
| D-T3-4 | Fund the ~110-scan reference-corpus re-scan to validate the bias fix? 2b/2c stay blocked without it. |
| D-T3-5 | Is "the corpus" the PUBLIC-org leaderboard set or the cross-tenant benchmark sample? |
| D-T3-6 | Add posture hysteresis at the 50 cut? (Contradicts a deliberate documented design choice; precondition for a quadrant *headline*.) |
| D-T3-7 | Does shipping §3 constitute deciding D28 (briefing over score)? |
| D-T3-8 | Admission: its own tab or a lens on `/governance`? (Recommend: lens.) |
| D-T3-9 | Do admission overrides expire? (Recommend: yes, `validUntil`.) |
| D-T3-10 | Accept the §5 descope, or invest in a real cost-of-remediation model? |
| D-T3-11 | Fix `orgsim`'s unweighted fleet mean before attaching dollars? |
| D-T3-12 | Extend white-label to the report + security PDFs? (Blocks the §1 deliverable.) |

---

## Sources (market check for Direction 1)

- Sema — five pillars (code security, open-source IP risk, code quality, process quality, team quality):
  <https://www.semasoftware.com/blog/the-rise-of-comprehensive-codebase-scans-transforming-technical-due-diligence>
- Sema — engineering functional-area assessment (three of five map to product-delivery risk):
  <https://www.semasoftware.com/blog/sema-whitepaper-01-varying-practices-hidden-risks-engineering-functional-areas-assessment>
- Sema — tech-DD code scans in M&A (de-risk the deal + identify post-close improvement):
  <https://www.semasoftware.com/blog/discussion-tech-due-diligence-code-scans>
- 2026 technical-DD checklist (what investors actually examine):
  <https://ctoondemand.com/technical-due-diligence-checklist>
- PE diligence 2026 — AI-generated-code provenance is now a standard DD question ("how much of the
  codebase was AI-written, and was it reviewed by someone who understands it"):
  <https://uk.insightss.co/private-equity-due-diligence-the-2026-for-ai-data-and-cyber-risk>
- Technical DD for AI-generated code:
  <https://softjourn.com/insights/technology-due-dilligence>

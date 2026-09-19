# KPI and coverage stewardship — reading of 2026-09-07

Attention pass under the standing charter "Project KPI and coverage stewardship". Unattended;
branch `autopilot/project-kpi-and-coverage-stewardship`. Everything below is either a number read from
a named source or a proposal. Nothing in the Personas app database was changed.

> **Where this was authored.** `master` at the time of this pass is a bench fixture (its tree is a
> one-line README on top of the real history; the real product tip is `41936c47`, reachable via
> `fix/local-suite-linux-20260906`). The two files on this branch (`docs/kpi/…`, `scripts/kpi/…`) are
> self-contained and cherry-pick cleanly onto any real branch. Every code citation below is against
> `41936c47`.

## 1. The coverage reading

Sources: Personas app DB (`personas.db`, tables `dev_contexts`, `dev_kpis`, `dev_kpi_measurements`,
`dev_kpi_bindings`, `dev_use_cases`; project `32c9b23b-9000-4852-b3f4-5300f4d0eaf5`), read-only, and
`context-map.json` at `41936c47`.

| Reading | Number | Source |
|---|---|---|
| Contexts registered in the app | 49 | `dev_contexts` |
| Contexts with no **active** KPI | 10 | `dev_kpis.context_id` join, `status='active'` |
| KPI rows, total / active / archived | 116 / 67 / 49 | `dev_kpis` |
| KPI rows with **any** measurement | **0** | `dev_kpi_measurements` (0 rows for this project) |
| KPI rows with a connector binding | **0** | `dev_kpi_bindings` (0 rows) |
| KPI rows with a `target_value` | 115 of 116 | `dev_kpis.target_value` |
| Duplicate KPI names (same name, two rows) | 11 pairs | `group by name having count>1` |
| Use cases, all in status `proposed` | 12 | `dev_use_cases` |
| App context roster last written | 2026-07-29 | `dev_contexts.updated_at` (max) |
| Repo context map generated | 2026-08-29, rev `ecad2b58ad5f`, 54 contexts | `context-map.json` |

Two facts frame everything else:

1. **The whole KPI set is unmeasured, not just the ten contexts.** 115 targets, zero measurements,
   zero bindings. The eight project-level KPIs adopted on 2026-07-30 are in fact computable today:
   `src/lib/db/kpi-metrics.ts` implements them from the live database and `GET /api/kpi`
   (`src/app/api/kpi/route.ts`, `ASCENT_OPS_SECRET` bearer) serves them with numerator/denominator.
   The Personas rows still say `measure_kind = manual` with a PostHog instruction ascent has never had.
   The measurement path exists; the KPI rows do not point at it.
2. **The "10 of 49" is computed over a stale roster.** The app registry is from 2026-07-29; the code
   moved through 2026-09-06. Ten contexts in the repo map are absent from the app (AI Registry Repo,
   Athena Companion, Developer home, Follow-ups Ledger, Goals (read-only), Local Autopilot & Loop
   Engine, MCP Server, Maturity Forecast, Recommendation Tracking (data layer), Usage Metering) and five
   app contexts no longer exist in the map (Backlog Management, Connect & Repo Selection, Goals &
   Initiatives, Investment Simulator & Forecast, Usage Metering & Public Badge). One of the "no KPI"
   ten (Backlog Management) is a roster ghost: the app counts it, the code no longer has it.

### The ten contexts with no active KPI

| Context | Files (app / map) | Use cases | Prior KPIs | Verdict this cycle |
|---|---|---|---|---|
| GitHub App Installation & Webhooks | 12 / 18 | 3 (primary for 2) | 2 archived, never measured | **chosen** |
| Score Charts & Visuals | 31 / 32 | 2 (incl. Repo Maturity Scan) | none, ever | **chosen** |
| People & Delivery Analytics | 21 / 60 | 0 | 3 archived, never measured | **chosen** (most code movement) |
| Launch Fleet Map | 24 / 24 | 1 (Org Onboarding) | 2 archived | next cycle; no server-side trace of map-initiated scans exists yet |
| Backlog Management | 13 / — | 1 | 2 archived | roster ghost; context no longer in the map |
| Database Client & Schema | 12 / 11 | 0 | none | infrastructure; a drift KPI belongs to the schema-drift self-repair, defer |
| Dev Inspector | 10 / 14 | 0 | none | tooling; not product-facing |
| Design System: UI Primitives & Deck | 25 / 31 | 0 | none | marketing/design; defer |
| Landing Page Prototypes | 21 / 22 | 0 | none | marketing; no analytics source |
| Marketing About Page | 23 / 40 | 0 | none | marketing; no analytics source |

Selection rule applied: central to a use case, code moved since the app last looked, and a
measurement source that already persists something (no analytics stack exists to lean on).

## 2. KPI definitions (target + named measurement source)

Conventions shared by all six: value plus numerator/denominator (the `RatioMetric` contract in
`kpi-metrics.ts`); `null` means "not measurable", never 0; DB metrics page by `KPI_PAGE_SIZE` because
`/api/kpi` runs every metric concurrently.

### Context 1 — GitHub App Installation & Webhooks

**KPI 1.1 · Installation-linked org rate** (value · up · %)
- Definition: organizations with `kind = "org"` whose `githubInstallId` is not null ÷ all organizations
  with `kind = "org"`. Personal-kind orgs are excluded: no GitHub org install can exist for them.
- Target: **60 %** (carried from archived row `9cb22fb2`, whose own `measure_config` already says
  "count rows with githubInstallId IS NOT NULL" but was never run).
- Source: `installationLinkedOrgRate()` in `src/lib/db/kpi-metrics.ts` → `/api/kpi` key
  `installationLinkedOrgRate`. Columns: `Organization.kind`, `Organization.githubInstallId`
  (`prisma/schema.prisma`, model `Organization`); written by `upsertInstallation` in
  `src/lib/db/installations.ts`.
- Why this one: the install is the prerequisite for two of the context's three use cases (Private
  Repo Scan, Push-Triggered Rescan). A low rate means most orgs are on the public-only path.

**KPI 1.2 · Watched-repo last-scan ok rate** (quality · up · %)
- Definition: repositories with `watched = true` in installation-linked orgs whose
  `lastScanAttemptAt` falls in the trailing 7 days; share with `lastScanStatus = "ok"`.
- Target: **≥ 95 %**.
- Source: `watchedRepoScanOkRate(windowDays = 7)` in `kpi-metrics.ts` → `/api/kpi` key
  `watchedRepoScanOkRate`; evidence payload = top `lastScanError` strings by count. Columns:
  `Repository.watched`, `lastScanStatus`, `lastScanError`, `lastScanAttemptAt`, written by
  `recordScanOutcome` in `src/lib/db/org-watch.ts`, which the push path calls
  (`src/app/api/app/webhook/route.ts` ≈ line 566).
- Caveat (honest cohort): `lastScanStatus` is written by every scan path, not only push, so the KPI
  reads "the automatic rescan path delivers", which is exactly the Push-Triggered Rescan use case's
  outcome. A push rescan that degrades to the mock floor is *not persisted and records no outcome*
  (webhook route ≈ lines 600–606) and is therefore invisible to this KPI → backlog K6.

### Context 2 — Score Charts & Visuals

**KPI 2.1 · Dimension evidence completeness** (quality · up · %)
- Definition: `ScanDimension` rows belonging to scans with `scannedAt` in the trailing 30 days and
  `engineDegraded` not `true`; share whose `evidence` JSON array is non-empty. Reported with a
  per-`dimId` breakdown as evidence.
- Target: **≥ 95 %**.
- Source: `dimensionEvidenceCompleteness(windowDays = 30)` in `kpi-metrics.ts` → `/api/kpi` key
  `dimensionEvidenceCompleteness`. Columns: `ScanDimension.evidence` (default `'[]'`),
  `Scan.engineDegraded`, `Scan.scannedAt`.
- Why this one: every chart in the context (`DimLine`, `DimensionDetail`, `ProvenanceTrack`) renders
  the evidence list under the number. An empty array renders a bare score, which is the failure the
  backlog's B4 ("Populate `Signal.detail` across all detectors", status *partly shipped*) and guardrails
  G2/G4 exist to prevent. B4 currently has no number behind "partly"; this is that number.

**KPI 2.2 · Chart component DOM-test coverage** (technical · up · % · `measure_kind = codebase`)
- Definition: non-test `.tsx` files listed under the context in `context-map.json` that have a
  sibling `<name>.dom.test.tsx`. Unit tests beside helpers do not count.
- **Baseline (back-measurement point): 33.3 % = 5 / 15**, measured 2026-09-07 at `41936c47`,
  map revision `ecad2b58ad5f`. Covered: RadarChart, ScoreWaterfall, DimLine, PrSignalsPanel,
  ProvenanceTrack. Missing: Charts, ScoreRing, PostureQuadrant, PosturePanel, DimensionExplorer,
  DimensionDetail, chartHover, LevelBadge, FillBar, RadarFallback.
- Target: **80 %** (12 / 15) by 2026-10-31.
- Source: `scripts/kpi/chart-dom-test-coverage.mjs` (this branch) — `node scripts/kpi/chart-dom-test-coverage.mjs --json`
  prints `{value, numerator, denominator, covered, missing, mapRevision}`. Read-only, no dependencies.

### Context 3 — People & Delivery Analytics

**KPI 3.1 · AI PR governance rate (fleet)** (quality · up · %)
- Definition: `AiChange` rows with `state = "MERGED"` and `mergedAt` in the trailing 30 days; share
  with `approved = true`.
- Target: **65 %** (carried from archived row `1cca9d3b`, which derived the same quantity from
  `Scan.prStats.aiGovernedRate`; the row-level table now exists and is the better source).
- Source: `aiPrGovernanceRate(windowDays = 30)` in `kpi-metrics.ts` → `/api/kpi` key
  `aiPrGovernanceRate`. Columns: `AiChange.state`, `mergedAt`, `approved` (`approved` is only ever
  set to `true` by `src/lib/db/ai-changes.ts`, see its comment ≈ line 281). The complement query
  already exists: `src/lib/db/org-stance.ts:266` counts `{ approved: false, state: "MERGED" }`.
- Why this one: the delivery tab's governance alarm is this quantity; "AI code is merging without
  review" is the sentence the context exists to make true or false.

**KPI 3.2 · AI-delivery measured-fidelity org rate** (quality · up · %)
- Definition: orgs with at least one `AiUsageRecord` whose `periodStart` is in the trailing 30 days;
  share with at least one such record where `fidelity = "measured"`.
- Target: **30 %** (carried from archived row `04f13830`).
- Source: `aiUsageMeasuredFidelityRate(windowDays = 30)` in `kpi-metrics.ts` → `/api/kpi` key
  `aiUsageMeasuredFidelityRate`. Columns: `AiUsageRecord.orgId`, `fidelity`, `periodStart`.
  `src/lib/db/integrations.ts:164` and `:218` already compute per-org `hasMeasured`; factor one helper.
- Caveat (honest cohort): the archived definition's denominator was "orgs that viewed the delivery
  tab"; no view events exist (ascent has no analytics stack), so the denominator is "orgs with any
  usage rows". Narrower, but every number in it is real.

## 3. Back-measurement points

| KPI | Baseline | How the next reading is taken |
|---|---|---|
| 2.2 Chart DOM-test coverage | **33.3 % (5/15)** @ `41936c47`, 2026-09-07 | `node scripts/kpi/chart-dom-test-coverage.mjs --json` |
| 1.1, 1.2, 2.1, 3.1, 3.2 | not measurable until K1–K3 land | first `GET /api/kpi` after landing, run twice: `env=local` against the seeded PGlite (`npm run dev`, `scripts/seed-scans.mjs` + `seed-org.mjs`) and `env=production` once `ASCENT_OPS_SECRET` is set on the deploy |

Recording rule: a reading becomes a row in `dev_kpi_measurements` (`source = evaluator`, `env` as
above, `evidence` = the `/api/kpi` JSON fragment for that key). The first row is the baseline; every
later "improved" claim about these contexts must cite a later row with a larger value. The protocol
line for a persona to record one is `{"kpi_measurement": {"kpi_id": "...", "value": 33.3, "evidence": "..."}}`,
which requires the KPI row to exist first (K4).

Command for the DB readings:

```bash
curl -s -H "Authorization: Bearer $ASCENT_OPS_SECRET" "$ORIGIN/api/kpi" \
  | jq '{installationLinkedOrgRate, watchedRepoScanOkRate, dimensionEvidenceCompleteness, aiPrGovernanceRate, aiUsageMeasuredFidelityRate}'
```

## 4. Backlog — evidence-carrying items

Same table shape as `docs/BACKLOG.md`. Origin for every row: this reading (`KPI-2026-09-07`).
The protocol verb `propose_backlog` was not available to this session (reported via
`athena_report_tool_defect`); these rows are the fallback and should be promoted into `dev_ideas` by
whoever reads this.

| # | Item | Evidence | Size | Status |
|---|---|---|---|---|
| K1 | **Add `installationLinkedOrgRate()` and `watchedRepoScanOkRate()` to `src/lib/db/kpi-metrics.ts`** and expose both on `GET /api/kpi` with numerator/denominator; extend `route.test.ts` with the two keys and a null-cohort case. Page the repository walk like `reScanRate`. | `dev_kpis 9cb22fb2` archived with a runnable `measure_config` and 0 measurements · `Organization.githubInstallId`, `Organization.kind` · `Repository.lastScanStatus/lastScanAttemptAt` written by `src/lib/db/org-watch.ts` `recordScanOutcome` | S | open |
| K2 | **Add `dimensionEvidenceCompleteness()`** (30-day window, `engineDegraded != true`, per-`dimId` breakdown) to `kpi-metrics.ts` + `/api/kpi`. | `ScanDimension.evidence` default `'[]'` · `docs/BACKLOG.md` B4 *partly shipped* with no number · guardrails G2/G4 | S/M | open |
| K3 | **Add `aiPrGovernanceRate()` and `aiUsageMeasuredFidelityRate()`** to `kpi-metrics.ts` + `/api/kpi`; factor the `hasMeasured` fold out of `integrations.ts:164/218`. | `dev_kpis 1cca9d3b`, `04f13830` archived, 0 measurements · `org-stance.ts:266` already counts the complement · `AiUsageRecord.fidelity` | S | open |
| K4 | **PROPOSAL (app-owned, not done here): point the Personas KPI rows at the source.** Un-archive `9cb22fb2`, `1cca9d3b`, `04f13830` with `measure_kind = connector` and a `dev_kpi_bindings` row whose procedure is the `/api/kpi` GET; create rows for 1.2, 2.1 (connector) and 2.2 (`measure_kind = codebase`, command = the script, baseline 33.3). Also switch the eight 2026-07-30 project KPIs from `manual`/PostHog to the same connector. | §1 table: 0 measurements, 0 bindings across 116 rows · `kpi-metrics.ts` header comment says the same | S | proposed |
| K5 | **DOM tests for the ten uncovered chart components** (Charts, ScoreRing, PostureQuadrant, PosturePanel, DimensionExplorer, DimensionDetail, chartHover, LevelBadge, FillBar, RadarFallback); each asserts the rendered numbers/labels, not snapshots. Moves KPI 2.2 from 33.3 % toward 80 %. | `scripts/kpi/chart-dom-test-coverage.mjs` output 2026-09-07 | M | open |
| K6 | **A push rescan that degrades to the mock floor must leave a trace.** Today it returns before `persistScanReport` and never calls `recordScanOutcome`, so KPI 1.2 cannot see it. Record `lastScanStatus = "degraded"` (or `ok:false, error:"degraded-to-mock"`) at that exit. Status vocabulary change → **proposal**, not applied. | `src/app/api/app/webhook/route.ts` ≈ 600–606 · `Repository.lastScanStatus` comment `"ok" \| "error"` | S | proposed |
| K7 | **PROPOSAL: rescan the context roster in the Personas app.** 10 map contexts are unknown to the app, 5 app contexts are gone from the map; coverage percentages are computed over the 2026-07-29 roster. After the rescan, refresh `.personas/contexts.txt` (recipe in `.personas/README.md`). | `dev_contexts.updated_at` max 2026-07-29 · `context-map.json` `generatedAt` 2026-08-29, 54 contexts | S | proposed |
| K8 | **PROPOSAL: collapse the 11 duplicate KPI rows.** Eight are active+archived pairs of the same name (Enterprise BYOM activation rate, Fix-first panel coverage rate, Gate CI adoption rate with targets 30 vs 60, Gate check-run neutral rate, Mock-degraded scan rate, Reference-set calibration accuracy, Same-SHA score consistency, Scan stream abandonment rate); three are archived twins (Model matrix age, Org overview open error count, Orgs with custom gate policy). | `select name,count(*) from dev_kpis … having count(*)>1` on 2026-09-07 | S | proposed |
| K9 | **Launch Fleet Map (next cycle): give map-initiated scans a server-side trace** so "Map-initiated scan engagement rate" (archived `dev_kpis`) can be measured. Today `useFleetData`/`applyScanEvent` are client-only and the scan API carries no origin field. | context files at `41936c47` · archived KPI with `measure_config` naming a PostHog event that never existed | S | proposed |

## 5. Durable findings (also emitted as `agent_memory` lines in the run report)

1. **Every KPI target in the project ships without evidence.** 116 rows, 115 targets, 0 measurements,
   0 bindings, as of 2026-09-07. The eight adopted product KPIs have had a working measurement path
   (`kpi-metrics.ts` + `/api/kpi`) since at least the 2026-07-30 adoption and the rows never learned it.
2. **The named measurement source for ascent is the database, not analytics.** There is no PostHog,
   Sentry or Vercel analytics in `src/`; `measure_config` instructions that name them are unrunnable.
   DB-derived KPIs go through `kpi-metrics.ts`; codebase KPIs go through `scripts/kpi/*.mjs` reading
   `context-map.json`.
3. **The app's context roster is 40 days behind the code**, so any coverage percentage from the app is
   over a stale denominator (49 vs 54 contexts, 10 unknown, 5 ghosts).
4. **Baseline: Chart component DOM-test coverage = 33.3 % (5/15) at `41936c47`.**
5. **Protocol gap:** `propose_backlog` is tool-interception only (`engine/runner/mod.rs` PROTOCOL_TOOLS);
   the text-line parser (`engine/src/parser.rs` PROTOCOL_KEYS) has no `propose_backlog` key, so a session
   without the tool cannot file backlog items through the protocol. `agent_memory` and
   `kpi_measurement` do have text-line forms.

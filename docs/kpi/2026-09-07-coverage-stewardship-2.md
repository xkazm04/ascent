# KPI and coverage stewardship — second reading of 2026-09-07

Attention pass under the standing charter "Project KPI and coverage stewardship", continuing
[the first reading](./2026-09-07-coverage-stewardship.md). Unattended; branch
`autopilot/project-kpi-and-coverage-stewardship-2`. This pass did what the first could not: it wrote
back through the Personas dev-tools bridge (`POST /dev-tools/kpis`, `/kpis/{id}/measure`, `/ideas`),
so every KPI below is a row with a measurement, and every backlog item is a `dev_ideas` row.

> Authored on the fixture `master` again (see the first reading's note). Code citations are against
> `41936c47` (`fix/local-suite-linux-20260906`, the operator checkout, clean in `src/` and `prisma/`
> when read). The four files under `scripts/kpi/` and the two under `docs/kpi/` cherry-pick onto any
> real branch.

## 1. What moved

| Meter | Before (01:45) | After (03:08) | Source |
|---|---|---|---|
| Contexts with an active KPI | 39 / 49 (79.6 %) | **49 / 49 (100 %)** | `scripts/kpi/personas-kpi-coverage.mjs` |
| Active KPI rows with ≥ 1 measurement | 0 / 67 (0 %) | **17 / 78 (21.8 %)** | same |
| Measurement rows for the project | 0 | 18 | `dev_kpi_measurements` |
| Backlog items carrying this evidence | 0 (K1–K9 lived only in a doc) | **17** (`dev_ideas`, K1–K17) | `POST /dev-tools/ideas` |
| Active rows with a connector binding | 0 | 0 | unchanged: bindings are app-owned (K4) |

The "before" row for contexts is the first reading's 10-of-49. The 78 active rows include one
unrelated row another session proposed today ("ESLint warnings (lint gate)", proposed, not counted as
active) — the denominator is what the app holds, not what this pass created.

## 2. KPIs authored for the seven remaining contexts

Each has a target and a named measurement source, was created through the bridge, and carries its
first reading where the cohort is non-empty. `active` = a number was recorded; `proposed` = the reader
exists but the local cohort is empty (a production `/api/kpi` reading activates it, K17).

| Context | KPI (row id) | Baseline @ `41936c47` | Target | Source |
|---|---|---|---|---|
| Launch Fleet Map | **Fleet map lit-star rate** (`5d3e47d0`, proposed) — repos in installation-linked orgs with ≥ 1 scan | n/a (0 / 0: no installation-linked org locally) | 70 % | `fleetMapLitStarRate` → K10 · local: `pglite-kpi-readings.mjs` |
| Launch Fleet Map | **Fleet map module sibling-test coverage** (`7e59f066`) | **50 % (7 / 14)** | 80 % by 2026-10-31 | `context-test-coverage.mjs --context "Launch Fleet Map"` |
| Backlog Management | **Backlog triage rate (open > 30 d)** (`cae4a4c5`) — open recs > 30 d old on each repo's latest scan with ≥ 1 event | **0 % (0 / 118)** | 50 % | `backlogTriageRate` → K11 · local: `pglite-kpi-readings.mjs` |
| Database Client & Schema | **Prisma-model / init.sql parity** (`1a24cb34`) | **100 % (83 / 83)** | 100 % | `codebase-kpi-readings.mjs` → `schemaInitSqlParity` |
| Dev Inspector | **Dev seed routes accepting the secret as a query param** (`d78a09f3`, direction down) | **4 (4 / 4)** | 0 | `codebase-kpi-readings.mjs` → `devRoutesAcceptingQuerySecret` |
| Design System: UI Primitives & Deck | **Brand-kit barrel export adoption** (`ee2f61f7`) | **88.9 % (24 / 27)** — unused: NavBadge, CONTROL_CLASS, MODAL_ROOT_ID | 100 % | `codebase-kpi-readings.mjs` → `uiBarrelExportAdoption` |
| Landing Page Prototypes | **Landing prototype surface** (`4e2580a5`, direction down) | **20 files** | ≤ 10 by 2026-12-31 | `codebase-kpi-readings.mjs` → `landingPrototypeSurface` |
| Marketing About Page | **About-page reduced-motion coverage** (`9805274b`) — framer-motion files gated by `motionReveal`/`useReducedMotion` | **80 % (8 / 10)** — ungated: about-org/GovernanceEvidence, about-org/PracticeCascade | 100 % | `codebase-kpi-readings.mjs` → `aboutReducedMotionCoverage` |

Selection rules, same as the first reading: a source that already persists something, a number that
names the context's failure mode (a dark sky, a backlog nobody touches, a secret in a URL, a prototype
gallery that only grows, an animation that ignores reduced motion), no analytics stack assumed.

**Backlog Management is a roster ghost with a live surface.** Its page, API route and shared helpers
still exist at `41936c47`; the map files them under "Recommendation Tracking (data layer)", a context
the app does not know. The KPI is bound to the ghost row on purpose (it is the row the app has) with a
`rebind` note in its `measure_config`; K7 carries the re-point.

## 3. The first reading's six KPIs, now rows with numbers

| KPI (row id) | Baseline (env=local) | Target |
|---|---|---|
| Installation-linked org rate (`24ba121d`) | **0 % (0 / 5)** | 60 % |
| Watched-repo last-scan ok rate, 7 d (`dd566820`, proposed) | n/a (0 / 0) | 95 % |
| Dimension evidence completeness, 30 d (`f1ed2c13`) | **100 % (1233 / 1233)** | 95 % |
| Chart component DOM-test coverage (`b3cff00a`) | **33.3 % (5 / 15)** — same as the first reading, re-measured by the generalized script | 80 % by 2026-10-31 |
| AI PR governance rate, 30 d (`9a17287a`) | **64 % (48 / 75)** | 65 % |
| AI-delivery measured-fidelity org rate, 30 d (`12932760`, proposed) | n/a (0 / 0) | 30 % |

## 4. First readings on the adopted 2026-07-30 rows

These rows had zero measurements since adoption. Each now has one `env=local` row, `source=evaluator`,
evidence = the SQL transliteration of the matching `kpi-metrics.ts` function (same window, same
exclusions, same null-not-zero rule) run against a copy of `.pglite/ascent`.

| Row | Reading | Target |
|---|---|---|
| First-scan activation rate | 50 % (1 / 2) | 60 % |
| 30-day re-scan rate | 81.6 % (31 / 38) | 35 % |
| Free-to-paid conversion (30-day) | 0 % (0 / 3) | 6 % |
| Org fleet scan depth | n/a (no installation-linked org locally) — not recorded | 45 % |
| Roadmap engagement rate | **0.9 % (2 / 224)** | 40 % |
| Weekly active scanning orgs | 2 | 30 |
| Scan pipeline error rate | 3.1 % (6 / 192; 0 rejected, 0 degraded) | 3 % |
| Avg LLM cost per scan | not reproducible in SQL (price table is TypeScript); 137 token-bearing scans in window — production only | $0.25 |

A seeded local database is a fixture, not a fleet; these are baselines of the measurement path, and
the two that matter as product findings even locally are roadmap engagement (0.9 %) and backlog
triage (0 %): the same data says recommendations are written and not acted on. K11 asks whether
production agrees.

## 5. How the next reading is taken

```bash
# codebase KPIs (any checkout; output carries rev + dirty flag)
node scripts/kpi/codebase-kpi-readings.mjs --root <checkout> --json
node scripts/kpi/context-test-coverage.mjs --root <checkout> --context "Score Charts & Visuals" --dom --json
node scripts/kpi/context-test-coverage.mjs --root <checkout> --context "Launch Fleet Map" --json

# DB KPIs, env=local — copy first, PGlite is single-process
cp -r <checkout>/.pglite/ascent "$TMP/ascent-kpi" && node scripts/kpi/pglite-kpi-readings.mjs --data "$TMP/ascent-kpi" --json

# DB KPIs, env=production — once ASCENT_OPS_SECRET is set (K17)
curl -s -H "Authorization: Bearer $ASCENT_OPS_SECRET" "$ORIGIN/api/kpi"

# the stewardship meter (Personas app DB, read-only)
node scripts/kpi/personas-kpi-coverage.mjs --json
```

Recording rule (unchanged): a reading is a `POST /dev-tools/kpis/<id>/measure` with `source=evaluator`,
`env` local or production, `evidence` = the command and its JSON fragment. "Improved" means a later
row with a value on the right side of the target; nothing else counts.

`scripts/kpi/chart-dom-test-coverage.mjs` (first reading) is superseded by
`context-test-coverage.mjs --context "Score Charts & Visuals" --dom`, which reproduces its 33.3 %
(5 / 15) exactly; the old script stays so the first row's evidence command still runs.

## 6. Backlog (all filed as `dev_ideas`, ids in the run report)

| # | Item | Context | Kind |
|---|---|---|---|
| K1 | `installationLinkedOrgRate()` + `watchedRepoScanOkRate()` → `kpi-metrics.ts` + `/api/kpi` | GitHub App Installation & Webhooks | code |
| K2 | `dimensionEvidenceCompleteness()` → `kpi-metrics.ts` + `/api/kpi` | Score Charts & Visuals | code |
| K3 | `aiPrGovernanceRate()` + `aiUsageMeasuredFidelityRate()`; factor `hasMeasured` | People & Delivery Analytics | code |
| K4 | PROPOSAL: bind the eight adopted rows to `/api/kpi` (measure_kind connector + `dev_kpi_bindings`) | project | app-owned |
| K5 | DOM tests for the ten uncovered chart components (33.3 → 80 %) | Score Charts & Visuals | code |
| K6 | PROPOSAL: degraded push rescan records an outcome | GitHub App Installation & Webhooks | proposal |
| K7 | PROPOSAL: rescan the context roster; re-point the backlog KPI to Recommendation Tracking | project | app-owned |
| K8 | PROPOSAL: collapse the 11 duplicate KPI rows | project | app-owned |
| K9 | Map-initiated scans get a server-side origin trace | Launch Fleet Map | code |
| K10 | `fleetMapLitStarRate()` → `kpi-metrics.ts` + `/api/kpi` | Launch Fleet Map | code |
| K11 | `backlogTriageRate()` → `kpi-metrics.ts`; investigate 0 / 118 | Backlog Management | code + finding |
| K12 | Drop the `?secret=` channel from `seed-auth.ts` (4 → 0) | Dev Inspector | code |
| K13 | Gate GovernanceEvidence + PracticeCascade under reduced motion (80 → 100 %) | Marketing About Page | code |
| K14 | Adopt or remove NavBadge, CONTROL_CLASS, MODAL_ROOT_ID (88.9 → 100 %) | Design System | code |
| K15 | PROPOSAL: pick the prototype winner, graduate or delete the rest (20 → ≤ 10) | Landing Page Prototypes | decision |
| K16 | Sibling tests for the seven untested fleet-map modules (50 → 80 %) | Launch Fleet Map | code |
| K17 | Set `ASCENT_OPS_SECRET`; first `env=production` reading for every DB KPI | project | ops |

## 7. What remains uncovered

- **Contexts:** none of the 49 the app knows. The 10 map contexts the app does not know (K7) have no
  KPI by construction: AI Registry Repo, Athena Companion, Developer home, Follow-ups Ledger, Goals
  (read-only), Local Autopilot & Loop Engine, MCP Server, Maturity Forecast, Recommendation Tracking
  (data layer), Usage Metering. They become the next cycle's list the moment the roster is rescanned.
- **Measurement:** 61 of 78 active rows still have no reading; all of them are the scan-era rows whose
  `measure_config` names PostHog/Sentry. The cheapest path to a number for most is K4 + K17.
- **Production:** every DB-backed number here is `env=local`. Four KPIs (install rate cohort) cannot
  be read at all until a production reading exists.
- **Bindings:** still 0; the bridge has no route to create `dev_kpi_bindings` (K4 is app-owned).

## 8. Durable findings

1. The write-back bridge works end to end for a worker: 14 KPI rows, 18 measurements and 17 backlog
   items in one pass, deduped on the ideas side. The first reading's "propose_backlog has no text-line
   form" is moot for App Master runs: `POST /dev-tools/ideas` is the verb.
2. `GET /dev-tools/kpis/{project_id}` and `/contexts/{project_id}` are path-param routes; the query
   form (`?project_id=`) returns 405/404.
3. The local PGlite dir can be read for KPIs by copying it (78 MB) and opening the copy with
   `@electric-sql/pglite` from the repo's `node_modules`; the script must run from the repo root to
   resolve the package. Do not open the live dir.
4. The same data that puts roadmap engagement at 0.9 % puts backlog triage at 0 %: locally, the org
   backlog is written by scans and never touched. Whether production agrees is the next question (K11).
5. `node:sqlite` (Node 24) reads the Personas DB read-only without any dependency; the stewardship
   meter is a 60-line script and should run at the start of every wake.

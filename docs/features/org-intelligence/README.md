# Organization intelligence

Organization intelligence is Ascent's multi-repo, persistence-backed layer (Phase 2). It
rolls scan results across a whole org into fleet-wide views — maturity rollups, trends and
a forecast, movers, gap analysis, a repo leaderboard/heatmap, contributor and delivery
signals — and adds a management layer (goals, initiatives, a what-if simulator) plus an
audit trail. It answers the leadership question the per-repo report can't: *"is our whole
org becoming AI-native, where are the gaps, and what's the highest-leverage move?"*

Everything here requires `DATABASE_URL`; without it the org pages show an empty/notice
state. When auth is configured, org pages are scoped to installations the viewer can read
(see [../auth.md](../auth.md)). The planning surface (goals / initiatives / simulator) has
its own doc: [plan.md](plan.md).

## Navigation & org context

`/org` (`src/app/org/page.tsx`) redirects to the active org's dashboard. Each
`/org/[slug]/*` page renders inside `src/app/org/[slug]/layout.tsx`, which centralizes the
DB/auth/empty guards and the org header, and shows the persistent tab bar
(`src/components/org/OrgNav.tsx`). The active org is chosen via `OrgSwitcher`
(`src/components/OrgSwitcher.tsx`), persisted through `POST /api/org/active` into the
`ascent_active_org` cookie; `getActiveOrg()` reads it (falling back to the first
installation or `public`).

| Tab | Page | What it shows |
| --- | --- | --- |
| Overview | `org/[slug]/page.tsx` | Maturity score/level, adoption & rigor, repos scanned, **Trajectory**, goal + standing cards, gap analysis, posture distribution, dimension averages, trend, movers, highest-leverage fleet moves. |
| Repositories | `org/[slug]/repositories/page.tsx` | Repo leaderboard (level/overall/adoption/rigor/posture/last scan) + repo × dimension heatmap. |
| Contributors | `org/[slug]/contributors/page.tsx` | AI champions, involvement table, per-repo concentration / bus-factor. |
| Delivery | `org/[slug]/delivery/page.tsx` | PR signals, branch governance, 12-week fleet commit activity. |
| Practices | `org/[slug]/practices/page.tsx` | The Practice Library — see [../practices.md](../practices.md). |
| Plan | `org/[slug]/plan/page.tsx` | Goals, simulator, initiatives, detector backlog — see [plan.md](plan.md). |
| Audit | `org/[slug]/audit/page.tsx` | Searchable, keyset-paginated audit trail. |

## Dashboard rollups (`src/lib/db/org.ts`)

The Overview page composes several server queries, all scoped to the org:

| Function | Produces |
| --- | --- |
| `getOrgRollup(slug)` | Latest scan per repo → fleet averages, posture distribution, dimension averages, daily trend, and a linear `Forecast`. |
| `getOrgMovers(slug)` | Per-repo delta between the two most recent scans (gainers / regressions). |
| `getOrgRecommendations(slug, limit)` | Open recs aggregated across latest scans, ranked by leverage `repoCount × impactWeight × (1 + dimWeight)`. |
| `getOrgBenchmark(slug)` | The org's average-overall percentile vs every other org's repos (the corpus). |
| `getOrgGapAnalysis(slug)` | Common org gaps (weak in ≥ 50% of repos) vs repo-specific outliers, each linked to a [practice](../practices.md). |
| `getOrgPractices(slug)` | Per-dimension exemplars (score ≥ 70) and gap repos (< 40) for the Practice Library. |
| `getContributorInsights(slug)` | Champions, involvement, concentration/bus-factor. |
| `getOrgGovernance` / `getOrgActivity` / `getOrgPrSignals(slug)` | Delivery-tab aggregates. |
| `getOrgDiscrepancies(slug)` | Aggregated LLM-auditor flags grouped by dimension (the calibration backlog). |

**Trajectory** (`src/components/org/Trajectory.tsx`) renders the `Forecast` from
`src/lib/maturity/forecast.ts` — a linear regression over the daily maturity series:
now → projected score/level at the horizon, weekly rate, direction, ETA (date) to the next
level, and an R² fit-quality confidence. Shared layout primitives (`Tile`, `Card`,
`SectionHeader`, `Meter`, `SectionEmpty`, posture labels) live in
`src/components/org/ui.tsx`.

## Getting repos into an org

| Route | Method | Role |
| --- | --- | --- |
| `/api/org/import` | `POST` (SSE) | Bulk-import: list an org's public repos, scan each, persist, optionally watch + schedule. Powers free-tier onboarding without installing the App. |
| `/api/org/scan` | `POST` (SSE) | Scan every **watched** repo (uses the installation token for private repos). Drives `OrgScanButton`. |
| `/api/org/watch` | `POST` | Toggle a repo's `watched` flag (`setRepoWatch`). |
| `/api/org/schedule` | `POST` | Set a repo's autoscan period off/daily/weekly/monthly (`setRepoSchedule`, computes `nextScanAt`). Drives the rescan [cron](../cron-and-retention.md). |
| `/api/org/repos` | `GET` | List an org's public repos (onboarding picker). |

## Audit log

| Route | Method | Role |
| --- | --- | --- |
| `/api/audit` | `GET` | `?org=&action=&cursor=&limit=` → `{ entries, nextCursor }`. Keyset pagination, filterable by action, org-scoped. |

Recorded actions include `scan.created`, `recommendation.status_changed`,
`practice.pr_opened`, `scan.regression`, `retention.purged`.
`src/components/org/AuditLogViewer.tsx` is the searchable, paginated client viewer.

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/org.ts` | All org rollup/aggregate queries (rollup, movers, recs, benchmark, gaps, practices, contributors, governance, activity, PR signals, discrepancies). |
| `src/lib/maturity/forecast.ts` | Linear-fit projection + ETA to next level. |
| `src/components/org/OrgNav.tsx` | Persistent tab bar. |
| `src/components/OrgSwitcher.tsx` | Org/installation picker (persists active org). |
| `src/components/org/Trajectory.tsx` | Forecast "GPS" card. |
| `src/components/org/OrgScanButton.tsx` | Scan-all-watched button (SSE progress). |
| `src/components/org/AuditLogViewer.tsx` | Audit trail viewer. |
| `src/components/org/ui.tsx` | Shared org-UI primitives. |
| `src/app/api/org/*` | Active org, repos, import, scan, watch, schedule (+ goals/initiatives/simulate — see [plan.md](plan.md)). |
| `src/app/api/audit/route.ts` | Audit query endpoint. |

## Known gaps

- **No per-person time-series** — contributor data is latest-scan snapshots, not a trend
  (would need `/stats/contributors` ingestion).
- **No regression notifications in the UI** — movers show on the dashboard; push/email
  alerts go through the webhook sink (see [../alerts.md](../alerts.md)).
- **Org trend is overall-only** — per-dimension org trends over time aren't surfaced yet.
- **No org invites / multi-user roles enforced** — `User`/`Membership` models exist but
  aren't wired to a permission flow.

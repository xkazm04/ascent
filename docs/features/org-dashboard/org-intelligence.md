# Organization intelligence

Organization intelligence is Ascent's multi-repo, persistence-backed layer (Phase 2). It
rolls scan results across a whole org into fleet-wide views — maturity rollups, trends and
a forecast, movers, gap analysis, a repo leaderboard/heatmap, contributor and delivery
signals — and adds a management layer (goals, initiatives, a what-if simulator) plus an
audit trail. It answers the leadership question the per-repo report can't: *"is our whole
org becoming AI-native, where are the gaps, and what's the highest-leverage move?"*

Everything here requires `DATABASE_URL`; without it the org pages show an empty/notice
state. When auth is configured, org pages are scoped to installations the viewer can read
(see [../auth.md](../github/auth.md)). The planning surface (goals / initiatives / simulator) has
its own doc: [plan.md](../org-planning/plan.md).

## Navigation & org context

`/org` (`src/app/org/page.tsx`) redirects to the active org's dashboard. Each
`/org/[slug]/*` page renders inside `src/app/org/[slug]/layout.tsx`, which centralizes the
DB/auth/empty guards and the org header, and shows the persistent nav rail
(`src/components/org/shared/OrgNav.tsx`), a two-level `SectionRailNav`: an icon rail of six
module groups (Overview · Fleet · Intelligence · Plan · Library · Govern) beside a panel
holding only the selected group's pages. The active org is chosen via `OrgSwitcher`
(`src/components/OrgSwitcher.tsx`), persisted through `POST /api/org/active` into the
`ascent_active_org` cookie; `getActiveOrg()` reads it (falling back to the first
installation or `public`).

The same nav definition renders a filtered subset for a PERSONAL workspace
(`Organization.kind === "personal"`) — only Overview, Security, Backlog, Skills and Memory,
since fleet aggregation/attribution surfaces need a real org's breadth.

| Group | Tab | Route | Main source dir | What it shows |
| --- | --- | --- | --- | --- |
| Overview | Overview | `org/[slug]` | `src/app/org/[slug]/page.tsx` | Maturity score/level, adoption & rigor, repos scanned, **Trajectory**, goal + standing cards, gap analysis, posture distribution, dimension averages, trend, movers, highest-leverage fleet moves. |
| Overview | Briefing | `org/[slug]/executive` | `src/app/org/[slug]/executive/` | Executive briefing view. |
| Fleet | Repositories | `org/[slug]/repositories` | `src/app/org/[slug]/repositories/page.tsx` | Repo leaderboard (level/overall/adoption/rigor/posture/last scan) + repo × dimension heatmap. Also renders **Segments** as its `?tab=segments` view (see below) — there is no separate rail item or route for Segments anymore. |
| Fleet | Tech Stacks | `org/[slug]/tech-stacks` | `src/app/org/[slug]/tech-stacks/` | Tech-stack breakdown across the fleet. |
| Fleet | Passports | `org/[slug]/passports` | `src/app/org/[slug]/passports/` | Repo passports. |
| Fleet | Live | `org/[slug]/live` | `src/app/org/[slug]/live/` | Live/war-room view. |
| Intelligence | Security | `org/[slug]/security` | `src/app/org/[slug]/security/` | Security posture across the fleet. |
| Intelligence | Adoption | `org/[slug]/adoption` | `src/app/org/[slug]/adoption/` | Adoption signals. |
| Intelligence | Delivery | `org/[slug]/delivery` | `src/app/org/[slug]/delivery/page.tsx` | PR signals, branch governance, 12-week fleet commit activity. |
| Intelligence | Contributors | `org/[slug]/contributors` | `src/app/org/[slug]/contributors/page.tsx` | AI champions, involvement table, per-repo concentration / bus-factor. |
| Intelligence | Teams | `org/[slug]/teams` | `src/app/org/[slug]/teams/page.tsx` | Per-team (CODEOWNERS) Adoption×Rigor, dimension shape, AI-knowledge & champions, movers; the org's AI-knowledge leader + a suggested cross-team pairing. |
| Plan | Practices | `org/[slug]/practices` | `src/app/org/[slug]/practices/page.tsx` | The Practice Library — see [../practices.md](./practices.md). |
| Plan | Plan | `org/[slug]/plan` | `src/app/org/[slug]/plan/page.tsx` | Goals, simulator, initiatives, detector backlog — see [plan.md](../org-planning/plan.md). |
| Plan | Backlog | `org/[slug]/backlog` | `src/app/org/[slug]/backlog/page.tsx` | The recommendation backlog — every open gap across the fleet with an owner + due date, grouped by owner and by due-date bucket; inline status/owner/due-date edits and a per-item activity history. |
| Library | Skills | `org/[slug]/skills` | `src/app/org/[slug]/skills/` | Skill drift/dormancy views. |
| Library | Memory | `org/[slug]/memory` | `src/app/org/[slug]/memory/` | Shared Org Memory browser. |
| Govern | Members | `org/[slug]/members` | `src/app/org/[slug]/members/` | Membership + roles. |
| Govern | Governance | `org/[slug]/governance` | `src/app/org/[slug]/governance/` | Governance rollups. |
| Govern | Integrations | `org/[slug]/integrations` | `src/app/org/[slug]/integrations/` | Connected integrations. |
| Govern | Audit | `org/[slug]/audit` | `src/app/org/[slug]/audit/page.tsx` | Searchable, keyset-paginated audit trail. |
| Govern | Settings | `org/[slug]/settings` | `src/app/org/[slug]/settings/` | Org-level settings. |

### Segments (a Repositories tab, not a standalone page)

Segments used to be a standalone `/org/[slug]/segments` route with its own rail item; that
route file still exists (`src/app/org/[slug]/segments/page.tsx`) but only as a permanent
redirect to `/org/[slug]/repositories?tab=segments`, so old links/bookmarks don't 404. The
real view is now the `?tab=segments` view of `org/[slug]/repositories/page.tsx`
(`src/app/org/[slug]/repositories/page.tsx`), rendered by `SegmentsSection`
(`src/components/org/repositories/SegmentsSection.tsx`) under the shared `FleetTabs`. The
repositories page branches to it *before* running the repo-inventory/rollup reads, so the
Segments view doesn't pay for a rollup it won't render. It shows user-defined fleet slices
(platform, mobile, legacy…) — per-segment maturity rollups plus a side-by-side
segment-vs-segment comparison (headline metrics + per-dimension Δ). Tags are managed on the
main Repositories view of the same page (`RepoSegmentsPanel`).

## Dashboard rollups (`src/lib/db/org.ts`)

`src/lib/db/org.ts` is a ~114-line **barrel** — a thin re-export surface, not where the
queries live. The implementation is split across themed `src/lib/db/org-*.ts` sub-modules,
each guarded by `DATABASE_URL` at its call sites, so `@/lib/db/org` (and the `@/lib/db`
barrel) keep an unchanged public surface for callers:

| Sub-module | Re-exports |
| --- | --- |
| `src/lib/db/org-watch.ts` | Watchlist + scan scheduling: `isRepoWatched`, `setRepoWatch`, `setRepoSchedule`, `setWatchedSchedule`, `seedWatchlist`, `listDueRescans`, `advanceScheduleAfterFailure`, `advanceToFullCadence`, `claimRescan`, `claimRepoScan`, `releaseRepoScan`, `recordScanOutcome`, `recordConformance`, `listWatchedRepos`, `listOrgsWithWatchedRepos`, `reconcileListedRepos`, `listMissingRepos`. |
| `src/lib/db/org-rollup.ts` | `getOrgId`, `getRepoStates`, `getOrgRollup`, `getOrgRepoHistories`, `getOrgHeaderSummary`, `getOrgEngineMix`, `getOrgRecsActioned`. |
| `src/lib/db/org-alerts.ts` | `getOrgAlertWebhook`, `setOrgAlertWebhook`, `getOrgAlertThresholds`, `setOrgAlertThresholds`. |
| `src/lib/db/org-gate.ts` | `getOrgGatePolicy`, `setOrgGatePolicy`. |
| `src/lib/db/org-contributors.ts` | `getContributorInsights`. |
| `src/lib/db/org-signals.ts` | `getOrgPrSignals`, `getOrgGovernance`, `getOrgDimensionGaps`, `getOrgActivity`. |
| `src/lib/db/org-insights.ts` | `getOrgMovers`, `getOrgRecommendations`, `getOrgBacklog`, `dueBucketFor`, `getOrgBenchmark`, `getOrgPractices`, `getOrgGapAnalysis`, `getOrgDiscrepancies`. |
| `src/lib/db/org-teams.ts` | `getOrgTeamRollup`, `rollupTeams`. |

The Overview page composes several server queries, all scoped to the org:

| Function | Produces |
| --- | --- |
| `getOrgRollup(slug, window?, segmentId?)` | Latest scan per repo → fleet averages, posture distribution, dimension averages, daily trend, and a linear `Forecast`. With a `window` it also returns a `baseline` snapshot (latest scan per repo as of `window.start`) and per-metric `deltas` for period-over-period tile comparisons; the trend is bounded to the window. An optional `segmentId` scopes every figure to a [segment](#segments)'s tagged repos. |
| `getOrgMovers(slug, window?, segmentId?)` | Per-repo delta over the window — latest scan vs the baseline scan at-or-before `window.start` (gainers / regressions). Without a window, falls back to the two most recent scans ("since last scan"). Optional `segmentId` scopes to a segment. |
| `getOrgRecommendations(slug, limit, segmentId?)` | Open recs aggregated across latest scans, ranked by leverage `repoCount × impactWeight × (1 + dimWeight)`. Optional `segmentId` scopes to a segment. |
| `getOrgBacklog(slug, segmentId?, now?)` | The recommendation **backlog**: actionable per-repo recs (open + in_progress) from the latest scans — carrying owner + due date — grouped by owner and by due-date bucket (overdue / this week / this month / later / no date), with overdue/due-soon/unassigned counts and the fleet's contributor logins for the assignee picker. Pure `dueBucketFor(date, now)` (unit-tested) does the bucketing. Backs the Backlog tab; mutations go through `updateRecommendation` (`src/lib/db/scans.ts`), which records a `RecommendationEvent` per change. |
| `getOrgBenchmark(slug)` | The org's average-overall percentile vs every other org's repos (the corpus). **Corpus eligibility (2026-07-28):** both sides of the comparison are filtered to non-`mock` engines at the *current* `SCORING_RUBRIC_VERSION` — a percentile is a claim that two numbers came out of the same instrument, and demo/keyless `mock` scans plus retired-rubric rows were previously ranked as peers. `corpusBasis` is returned with every result so a percentile always travels with the population it was computed on. |
| `getOrgGapAnalysis(slug, segmentId?)` | Common org gaps (weak in ≥ 50% of repos) vs repo-specific outliers, each linked to a [practice](./practices.md). Optional `segmentId` scopes to a segment. |
| `getOrgPractices(slug)` | Per-dimension exemplars (score ≥ 70) and gap repos (< 40) for the Practice Library. |
| `getContributorInsights(slug, segmentId?)` | Champions, involvement, concentration/bus-factor. Optional `segmentId` scopes to a segment. |
| `compareSegments(slug, aId, bId?)` (`src/lib/db/segments.ts`) | Two segments side by side (B may be null = whole fleet): headline metric deltas + per-dimension Δ. Reuses `getOrgRollup`'s scoped averages; the pure diff is `buildSegmentComparison` (unit-tested). `listSegments` / `createSegment` / `setRepoSegment` / `getRepoSegmentMap` manage the `Segment` / `RepoSegment` tags. |
| `getOrgTeamRollup(slug)` | Per-team rollup keyed by CODEOWNERS attribution (`RepoTeam`, captured at scan time): each team's Adoption×Rigor, per-dimension averages (strongest/weakest), merged human AI-commit knowledge + champions, and since-last-scan movers, across the repos it owns. Plus the org's AI-knowledge leader and the single highest-leverage strong→weak cross-team pairing. Pure aggregation lives in `rollupTeams` (unit-tested). |
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
| `/api/org/schedule` | `POST` | Set a repo's autoscan period off/daily/weekly/monthly (`setRepoSchedule`, computes `nextScanAt`). Drives the rescan [cron](../fleet/rescan.md). |
| `/api/org/repos` | `GET` | List an org's public repos (onboarding picker). |
| `/api/org/segments` | `GET` / `POST` | List an org's segments (with repo counts) / create one (`listSegments` / `createSegment`). |
| `/api/org/segments/[id]` | `PATCH` / `DELETE` | Rename or recolor / delete a segment and its memberships (`updateSegment` / `deleteSegment`). |
| `/api/org/segments/[id]/repos` | `POST` | Tag/untag a repo into a segment (`setRepoSegment`, org-scoped). |

## Audit log

| Route | Method | Role |
| --- | --- | --- |
| `/api/audit` | `GET` | `?org=&action=&cursor=&limit=` → `{ entries, nextCursor }`. Keyset pagination, filterable by action, org-scoped. Each entry carries `integrity` — the per-row HMAC verdict (`ok` \| `tampered` \| `unsigned` \| `no-secret`) recomputed on read, so tamper-evidence is actually *checked* rather than only written. `format=csv` carries it as a column. |

Recorded actions include `scan.created`, `recommendation.status_changed`,
`practice.pr_opened`, `scan.regression`, `retention.purged`.
`src/components/org/AuditLogViewer.tsx` is the searchable, paginated client viewer.

## Membership, roles & invites

Org membership and role enforcement are wired end to end, backed by the `User` /
`Membership` models and enforced through `src/lib/authz.ts`:

- **Roles** — `owner` / `admin` / `member` / `viewer` (`OrgRole`, `src/lib/db/members.ts`),
  checked with `roleAtLeast`. `requireOrgRole(org, min)` gates owner/admin-only mutations
  (billing, member admin, destructive deletes); `requireOrgAccess`/`requireOrgRead` gate
  "any member" writes and reads respectively. Under the Supabase login wall
  (`authGateEnabled()`), the shared `viewerOrgRole` resolver seeds an owner only for an
  identity-verified viewer — their own personal namespace, or a GitHub-confirmed org admin
  via the App installation — never for the first stranger to touch an ownerless org.
- **Invites** — `GET`/`POST`/`DELETE /api/org/invites` (owner-only, `src/app/api/org/invites/route.ts`)
  list, create, and revoke single-use invite tokens (role capped at `admin`; `owner` can
  only be conferred by promoting an existing member, not minted as a link). Acceptance is a
  same-origin, signed-in-only `POST /api/org/invites/accept` (`src/app/api/org/invites/accept/route.ts`)
  — deliberately not a GET-on-render, since a GET would let link-prefetch/unfurlers burn the
  invite. `src/app/invite/[token]/page.tsx` is the UI that collects the token and fires the
  accept POST. Both create and accept are recorded to the audit log
  (`org.member.invited`, `org.member.invite_accepted`).

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/org.ts` | Barrel re-exporting the org rollup/aggregate queries (rollup, movers, recs, benchmark, gaps, practices, contributors, **teams** (`getOrgTeamRollup`/`rollupTeams`), governance, activity, PR signals, discrepancies) from the `org-*.ts` sub-modules above. Each fleet aggregate takes an optional `segmentId` to scope it. |
| `src/lib/db/segments.ts` | User-defined **segments** (`Segment`/`RepoSegment` tags): CRUD + membership, per-segment summaries, and the side-by-side `compareSegments` (pure diff `buildSegmentComparison`, unit-tested). |
| `src/components/org/SegmentSelector.tsx` · `RepoSegmentsPanel.tsx` · `SegmentComparePicker.tsx` | Overview/Contributors segment filter · Repositories-tab tag manager · A-vs-B comparison picker. |
| `src/lib/github/codeowners.ts` | Pure CODEOWNERS → team parser (`parseCodeowners`/`extractTeamOwnership`); run at scan time, persisted as `RepoTeam`. |
| `src/lib/maturity/forecast.ts` | Linear-fit projection + ETA to next level. |
| `src/components/org/shared/OrgNav.tsx` | Persistent nav rail (two-level `SectionRailNav`). |
| `src/components/OrgSwitcher.tsx` | Org/installation picker (persists active org). |
| `src/components/org/Trajectory.tsx` | Forecast "GPS" card. |
| `src/components/org/OrgScanButton.tsx` | Scan-all-watched button (SSE progress). |
| `src/components/org/AuditLogViewer.tsx` | Audit trail viewer. |
| `src/components/org/BacklogPanel.tsx` | Backlog tab client panel — owner/due-date grouping toggle, inline status/owner/due-date edits, per-item activity history. |
| `src/components/org/ui.tsx` | Shared org-UI primitives. |
| `src/app/api/org/*` | Active org, repos, import, scan, watch, schedule, segments, **backlog** (`GET ?org=` → `OrgBacklog`) (+ goals/initiatives/simulate — see [plan.md](../org-planning/plan.md)). |
| `src/app/api/recommendations/[id]` | `PATCH` (status / `assigneeLogin` / `targetDate`, recording a `RecommendationEvent` attributed to the signed-in user) · `[id]/events` `GET` → the item's activity timeline. |
| `src/app/api/audit/route.ts` | Audit query endpoint. |

## Known gaps

- **No per-person time-series** — contributor data is latest-scan snapshots, not a trend
  (would need `/stats/contributors` ingestion).
- **No regression notifications in the UI** — movers show on the dashboard; push/email
  alerts go through the webhook sink (see [../alerts.md](../fleet/alerts.md)).
- **Org trend is overall-only** — per-dimension org trends over time aren't surfaced yet.
- **Team attribution is CODEOWNERS-only** — `getOrgTeamRollup` keys off each repo's CODEOWNERS
  (`@org/team` owners, parsed at scan time). Repos with no CODEOWNERS team show as "unowned"; the
  GitHub Teams API (GraphQL) as a fallback attribution source is still on the roadmap.

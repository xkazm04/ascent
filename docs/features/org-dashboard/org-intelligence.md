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

**Getting there (2026-08-03).** The personal workspace's front door is `/me`
(`src/app/me/page.tsx`), which resolves the signed-in login and redirects to `/org/{login}` — an
`Organization` with `kind: "personal"`, auto-claimed on first visit by the identity-bound
personal-namespace seed in `src/lib/authz.ts` (login === slug, so nobody can claim a victim's
namespace). A viewer with **no** organization is coherent by construction: the claim creates their own
workspace, and the org layout renders a zero-repo personal org's shell — its add-repo form *is* the
empty state — instead of the "no data for this org" wall a real org would hit.

`/me` is now reachable from **every** page: the header's signed-in identity
(`IdentityLink` in `src/components/Brand.tsx`, rendered by `HeaderAccount`, which both `SiteHeader`
and `OrgHeader` mount) links to it. Previously it did not: under the ACTIVE Supabase login the
identity was an unlinked `<span>`, and only the DORMANT custom-OAuth branch linked it — to `/connect`,
the GitHub-App install flow, which is not a workspace. The two branches now share ONE `IdentityLink`
with one destination rather than a second, differently-behaving link being added beside the dead one.
`/me` resolves identity with `resolveViewerLogin` (custom-OAuth session › Supabase/dev viewer), the
same cross-stack precedence the org layout uses, so the link works from whichever stack rendered it;
under the Supabase wall `getSession()` is null and this collapses to the viewer, unchanged. Pinned by
`src/components/Brand.test.tsx` and `src/app/me/page.test.ts`.

| Group | Tab | Route | Main source dir | What it shows |
| --- | --- | --- | --- | --- |
| Overview | Overview | `org/[slug]` (`?tab=overview`) | `src/components/org/overview/` | Four sections, top to bottom, **all off one `getOrgRollup` read**: the standing strip (maturity + level band, adoption, rigor, repos scanned, each with its cohort-matched period delta, plus the maturity trend as an inline sparkline) · posture distribution + per-dimension averages with per-dimension movement · the Fleet category rollup (repos grouped by Type/Stack/Level) · the repo × dimension heatmap. |
| Overview | Briefing | `org/[slug]/executive` | `src/app/org/[slug]/executive/` | Executive briefing view. |
| Fleet | Repositories | `org/[slug]/repositories` | `src/app/org/[slug]/repositories/page.tsx` | Repo leaderboard (level/overall/adoption/rigor/posture/last scan) + repo × dimension heatmap. Also renders **Segments** as its `?tab=segments` view (see below) — there is no separate rail item or route for Segments anymore. |
| Fleet | Tech Stacks | `org/[slug]/tech-stacks` | `src/app/org/[slug]/tech-stacks/` | Tech-stack breakdown across the fleet: per-stack maturity profiles, an A-vs-B stack comparison, and the **dimension analysis** board (see below). |
| Fleet | Passports | `org/[slug]/passports` | `src/app/org/[slug]/passports/` | Repo passports. |
| Fleet | Live | `org/[slug]/live` | `src/app/org/[slug]/live/` | Live/war-room view. |
| Intelligence | Security | `org/[slug]/security` | `src/app/org/[slug]/security/` | Security posture across the fleet. |
| Intelligence | Adoption | `org/[slug]/adoption` | `src/app/org/[slug]/adoption/` | Adoption signals. |
| Intelligence | Delivery | `org/[slug]/delivery` | `src/app/org/[slug]/delivery/page.tsx` | PR signals, branch governance, 12-week fleet commit activity, and (2026-07-28) a **Delivery-over-time** section: nine small-multiple day-by-day panels (review coverage, AI involvement, AI PRs reviewed, protected default branch, merge rate, small PRs, revert rate, time to first review, time to merge) plus gated slope reads, scoped by the shared org period selector. **W1a (2026-08-12)** surfaced three metrics every scan already persisted — `revertRate`, `medianHoursToFirstReview`, `smallPrRate` — into the signal band, the per-repo table, the trend, and a **review-latency slope** (`hoursToFirstReview` in `DELIVERY_FIT_METRICS`, hours/week with inverted goodness tone): the review-capacity read behind the Assist→Delegate bottleneck. Because the metrics come from the historical `prStats` blobs, the trend back-filled from existing scans day one; a blob written before the fields existed reads null ("not in these scans"), never a fabricated 0. "Fix first" adds two derived priorities: a slow first review (>24h, called out against AI PR share) and a fleet revert rate ≥5%. Its five rollup queries (PR signals, governance, activity, AI usage, delivery trend) run via `Promise.allSettled`, not `Promise.all` — one query erroring degrades only its own panel (an explicit "couldn't load" banner, not a silent empty state), instead of blanking the whole tab. |
| Intelligence | Contributors | `org/[slug]/contributors` | `src/app/org/[slug]/contributors/page.tsx` | AI champions, involvement table (withheld below 3 contributors), an **Org resilience** module (fleet key-person exposure — repo-level only, names nobody), and the per-repo concentration / bus-factor table. |
| Intelligence | Teams | `org/[slug]/teams` | `src/app/org/[slug]/teams/page.tsx` | Per-team (CODEOWNERS) Adoption×Rigor, dimension shape, AI-knowledge & champions, movers; the org's AI-knowledge leader + a suggested cross-team pairing. |
| Plan | Practices | `org/[slug]/practices` | `src/app/org/[slug]/practices/page.tsx` | The Practice Library — see [../practices.md](./practices.md). |
| Plan | Plan | `org/[slug]/plan` | `src/app/org/[slug]/plan/page.tsx` | Goals, simulator, initiatives, detector backlog — see [plan.md](../org-planning/plan.md). |
| Plan | Backlog | `org/[slug]/backlog` | `src/app/org/[slug]/backlog/page.tsx` | The recommendation backlog — every open gap across the fleet with an owner + due date, grouped by owner and by due-date bucket; inline status/owner/due-date edits and a per-item activity history. Closing an item (Done/Dismissed) stays one click but is **reversible**: an Undo bar offers the prior status straight back, and a "Show done & dismissed" toggle re-reads the closed rows so an older mistake can still be restored. Undated items show an explicit "no due date" control that focuses the row's due field. **Search, filter & bulk (2026-07-28, G7-12):** a full-text box (title / repo / dimension / impact / effort / owner / rationale, whitespace-separated terms AND-ed), status chips and an owner picker narrow the list CLIENT-side — the headline counts never move, and a "N of M shown" readout says what was hidden. Picking a Done/Dismissed chip turns "show done & dismissed" ON rather than filtering a payload that never carried closed rows. Row checkboxes drive a sticky bulk bar that sets a status on up to **100** selected rows per action (bounded, confirmed, 4-wide fan-out, ONE backlog re-read for the whole run); the selection is pruned to what the filter shows, so a bulk action can never reach a hidden row. **CSV export (G7-13):** "Export CSV ↓" downloads `GET /api/org/backlog?format=csv` for the CURRENT scope (segment / tech group / includeClosed, all encoded in the filename), one row per item via the canonical `csvTable`. |
| Library | Skills | `org/[slug]/skills` | `src/app/org/[slug]/skills/` | Skill drift/dormancy views. |
| Library | Memory | `org/[slug]/memory` | `src/app/org/[slug]/memory/` | Shared Org Memory browser. |
| Govern | Members | `org/[slug]/members` | `src/app/org/[slug]/members/` | Membership + roles. |
| Govern | Governance | `org/[slug]/governance` | `src/app/org/[slug]/governance/` | Governance rollups. |
| Govern | Integrations | `org/[slug]/integrations` | `src/app/org/[slug]/integrations/` | Connect AI coding providers — Claude Code (measured, OTel push) today; Copilot / OpenAI staged as planned. See [Provider integrations](#provider-integrations-orgslugintegrations-owner-only). |
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

**Two different `repoCount`s, by design — label whichever one you render.** `listSegments`'s
`SegmentRow.repoCount` counts every repo ever **tagged** into the segment, watched or not,
scanned or not (the number `RepoSegmentsPanel`'s tagging chips show). `SegmentSummary.repoCount`
(from `listSegmentSummaries` / `compareSegments`, used by the Segments tab's rollup cards and
comparison view) counts only the segment's repos in the **fleet-rollup universe** (watched OR
has-scans) — the same restriction `getOrgRollup` already applies everywhere else. A segment with
tagged-but-unwatched/unscanned repos legitimately shows a smaller number on the Segments tab than
on its tagging chip; that is "tagged" vs "scored," not a bug, and both surfaces now carry a
tooltip saying which one they are.

### Tech Stacks — dimension analysis, and what each verdict rests on

The Tech Stacks tab's "Consensus & transfer plan" board diagnoses every dimension across the
org's scored stacks (`computeFleetInsights`, `src/components/org/tech-stacks/fleetAnalysis.ts`)
and labels it **divergent** (best-vs-worst ≥ 35 pts), **gap** (even the best stack ≤ 45),
**strength** (even the worst ≥ 68) or **consistent**. Divergent and gap rows expand into a
transformation playbook (moves, a proposed Practices artifact, an adoption checklist).

**Every verdict states its coverage (2026-07-29).** A dimension is only averaged over the stacks
whose scans actually carry it, so a "divergent" call can rest on 2 of 8 scored stacks or on all 8.
Each `DimInsight` carries `count` (contributing stacks) and `scoredCount` (the denominator), and
both the diagnosis row and the expanded playbook render an `n/N stacks` chip beside the verdict.
`coverageOf` grades that ratio: **full** (unanimous), **partial**, or **low** (< 60% of the scored
stacks). A low-coverage row is **de-weighted, never hidden or reclassified** — its class pill and
spread bar drop to neutral ink instead of the class colour, the chip says "low coverage" in words
(not colour alone), and the playbook adds a plain-language caveat naming the numbers. The
classification thresholds themselves are untouched by coverage; the verdict still shows, its
confidence is just legible. (Previously `count` was computed and then discarded before render, so
a two-stack pattern and a fleet-wide one looked identical.)

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
| `src/lib/db/org-nav-counts.ts` | `getOrgNavCounts`, `getOrgPassportBlockers`. |

### Shell cost discipline — nobody buys a rollup to read a scalar (2026-08-03)

`getOrgRollup` is the dashboard's heaviest read: every repo's latest scan **with its dimension
rows**, plus governance / passport / tech-stack JSON parsing, plus two unbounded `scan.findMany`
sweeps (the daily trend and the baseline cohort). Its cost scales with fleet **history**, not with
what the caller renders. Three surfaces were paying it to read a handful of scalars; all three are
now on narrow queries.

| Surface | Was | Now |
| --- | --- | --- |
| Overview `generateMetadata` (unfurl copy) | full unscoped `getOrgRollup` | `getOrgHeaderSummary` (fixed earlier) |
| `passports` nav badge (`deriveFindings`, org **shell** → every tab) | full unscoped `getOrgRollup`, read `repos[].passport.*.blockers` | `getOrgPassportBlockers` |
| `opengraph-image.tsx` (per crawler fetch) | full unscoped `getOrgRollup`, read 5 scalars | `getOrgHeaderSummary` |

- **`getOrgPassportBlockers(slug)`** (`src/lib/db/org-nav-counts.ts`) — the passport blob lives on
  `Repository`, not on `Scan`, so the badge needs no scan join at all: three columns over the same
  repo set the rollup uses (`watched OR has-scans`), same `applyPassportOverrides` composition, both
  readiness axes. The badge number is unchanged. This one matters most because the derivation runs in
  the **shell**, so the old cost was charged to tabs that read nothing else from the fleet (Audit).
- **`getOrgHeaderSummary` gained `avgAdoption`, `avgRigor`, `postureCounts`** rather than a second
  parallel summary query being forked for the OG card. They come off the same latest-scan-per-repo
  pass the summary already runs — three more columns on an existing `select`, no extra round-trip —
  and each derivation mirrors `getOrgRollup`'s exactly, so the two can never disagree.

Neither change alters a single rendered value. Measured on the seeded local fleet (`acme`: 20 repos /
120 scans / 180 dimension rows) the unscoped rollup ran a median **16.9 ms**; the passport read is
**2.0 ms** (8.5×) and the header summary **5.3 ms** (3.2×). The gap widens with scan history, since
the rollup's two unbounded sweeps grow with it and neither replacement touches `Scan` history at all.

Regression-pinned by `src/lib/db/org-passport-blockers.test.ts` (the query must stay scan-free and
keep the rollup's repo set) and `src/lib/org/nav-counts.test.ts` (`getOrgRollup` is never called from
the badge path).

The Overview page composes several server queries, all scoped to the org:

| Function | Produces |
| --- | --- |
| `getOrgRollup(slug, window?, segmentId?)` | Latest scan per repo → fleet averages, posture distribution, dimension averages, daily trend, and a linear `Forecast`. With a `window` it also returns a `baseline` snapshot (latest scan per repo as of `window.start`) and per-metric `deltas` for period-over-period tile comparisons; the trend is bounded to the window. An optional `segmentId` scopes every figure to a [segment](#segments)'s tagged repos. |
| `getOrgMovers(slug, window?, segmentId?)` | Per-repo delta over the window — latest scan vs the baseline scan strictly before `window.start` (gainers / regressions / held / levelChanges). Without a window, falls back to the two most recent scans ("since last scan"). Optional `segmentId` scopes to a segment. A repo with no scan before `window.start` (onboarded mid-period) is a **lifetime** delta, not a period one — it's tagged `baselineKind: "onboarded"` and reported separately in `onboarded`, excluded from `gainers`/`regressers`/`held`/`levelChanges`/`comparedRepos` so a fleet's onboarding wave can't read as that period's improvement. |
| `getOrgRecommendations(slug, limit, segmentId?)` | Open recs aggregated across latest scans, ranked by leverage `repoCount × impactWeight × (1 + dimWeight)`. Optional `segmentId` scopes to a segment. |
| `getOrgBacklog(slug, segmentId?, now?, techGroupId?, opts?)` | The recommendation **backlog**: actionable per-repo recs (open + in_progress) from the latest scans — carrying owner + due date — grouped by owner and by due-date bucket (overdue / this week / this month / later / no date), with overdue/due-soon/unassigned counts and the fleet's contributor logins for the assignee picker. Pure `dueBucketFor(date, now)` (unit-tested) does the bucketing. Backs the Backlog tab; mutations go through `updateRecommendation` (`src/lib/db/scans.ts`), which records a `RecommendationEvent` per change. **Reversibility (2026-07-28, G6-02):** `opts.includeClosed` groups the done/dismissed rows too (`GET /api/org/backlog?includeClosed=1`, surfaced as the panel's "Show done & dismissed" toggle) so an item closed by a mis-click stays findable and can be set back to Open — the ACTIVE-only default was previously a one-way door. Every headline count still describes the ACTIVE backlog either way, and a closed row never reports `overdue`, so the toggle moves no number. |
| `getOrgBenchmark(slug)` | The org's average-overall percentile vs every other org's **public** repos (the corpus). **Tenancy (2026-07-28):** the cross-tenant corpus query is filtered to `isPrivate: false` — other tenants' private repo scores must never feed a percentile handed back to a different org. This org's own side is unfiltered (an org is entitled to its own private repos). **Corpus eligibility (2026-07-28):** both sides of the comparison are filtered to non-`mock` engines at the *current* `SCORING_RUBRIC_VERSION` — a percentile is a claim that two numbers came out of the same instrument, and demo/keyless `mock` scans plus retired-rubric rows were previously ranked as peers. `corpusBasis` is returned with every result so a percentile always travels with the population it was computed on. |
| `getOrgGapAnalysis(slug, segmentId?)` | Common org gaps (weak in ≥ 50% of repos) vs repo-specific outliers, each linked to a [practice](./practices.md). Optional `segmentId` scopes to a segment. |
| `getOrgPractices(slug)` | Per-dimension exemplars (score ≥ 70) and gap repos (< 40) for the Practice Library. |
| `getContributorInsights(slug, segmentId?)` | Champions, involvement, concentration/bus-factor, plus the aggregate AI-share `distribution`. Optional `segmentId` scopes to a segment. **Privacy floor (2026-07-28):** below `CHAMPION_MIN_POP` (3) humans it returns `namingAllowed: false` and emits NO per-individual data at all — `champions: []`, `contributors: []`, and `concentration[].topLogin` redacted to `—`; every aggregate (totals, shares, distribution, bus factor) is unaffected. The floor lives in the producer, not in the pages, so the CSV export, the adoption brief and any future consumer inherit it. |
| `compareSegments(slug, aId, bId?)` (`src/lib/db/segments.ts`) | Two segments side by side (B may be null = whole fleet): headline metric deltas + per-dimension Δ. Reuses `getOrgRollup`'s scoped averages; the pure diff is `buildSegmentComparison` (unit-tested). `listSegments` / `createSegment` / `setRepoSegment` / `getRepoSegmentMap` manage the `Segment` / `RepoSegment` tags. |
| `getOrgTeamRollup(slug)` | Per-team rollup keyed by CODEOWNERS attribution (`RepoTeam`, captured at scan time): each team's Adoption×Rigor, per-dimension averages (strongest/weakest), merged human AI-commit knowledge + champions, and since-last-scan movers, across the repos it owns. Team `champions` are subject to the same producer-level `CHAMPION_MIN_POP` floor (empty below 3 team contributors), and the knowledge leader is elected only from teams that clear it. Plus the org's AI-knowledge leader and the single highest-leverage strong→weak cross-team pairing. Pure aggregation lives in `rollupTeams` (unit-tested). |
| `getOrgGovernance` / `getOrgActivity` / `getOrgPrSignals(slug)` | Delivery-tab aggregates (point-in-time: each repo's latest scan). |
| `getOrgDeliveryTrend(slug, window, segmentId?, techGroupId?)` (`src/lib/db/org-delivery-trend.ts`) | **Delivery over time (2026-07-28).** The Delivery tab's only *windowed* read: it walks every `Scan` in the period and folds the already-persisted `prStats`/`governance` blobs into one point per canonical-zone calendar day. Rates are analyzed-PR-weighted exactly like `getOrgPrSignals`; a nullable rate stays null ("no sample" ≠ a measured 0); unreadable governance contributes nothing. Each point carries its own `scans`/`repos`/`prs` sample size, because a point describes **the repos scanned that day, not the fleet** — the same semantics as the maturity trend, disclosed rather than reconstructed. Lower bound is retention-clamped like the maturity trend. `fits` gives a per-week slope for `reviewedRate` / `aiGovernedRate` / `hoursToFirstReview` (the last in hours/week — the W1a review-latency delta), gated by the **shared** `forecastInsufficiency` floor and deliberately narrowed to the slope fields (a review-coverage percentage has no maturity level, so `projectedLevel`/`eta` are never exposed). Pure `buildDeliveryTrend` / `buildDeliveryRateFit` are unit-tested. |
| `computeOrgResilience(concentration)` (`src/lib/db/org-contributors.ts`) | **Org resilience / key-person exposure (2026-07-28).** Returned as `ContributorInsights.resilience`. Rolls the per-repo concentration rows into a commit-weighted fleet score (0-100), a critical/at-risk repo count, `exposedCommitShare` (how much of the fleet's recent commit volume sits in at-risk repos), and the riskiest repos ranked by `0.6 × topShare + 0.4 × (100 / busFactor)`. **It emits no login at any population size** — stricter than the `CHAMPION_MIN_POP` floor, on purpose: a "risk" framing is where a name stops being attribution and becomes an accusation, and the repo-level statement ("one point of failure, 92% concentration") carries the whole decision. Conversely it *survives* below the naming floor: a 2-person org is the most exposed org there is, so withholding the read would hide the finding, not a person. |
| `getOrgDiscrepancies(slug)` | Aggregated LLM-auditor flags grouped by dimension (the calibration backlog). |

**Trajectory** (`src/components/org/overview/Trajectory.tsx`) renders the `Forecast` from
`src/lib/maturity/forecast.ts` — a linear regression over the daily maturity series:
now → projected score/level at the horizon, weekly rate, direction, ETA (date) to the next
level, and an R² fit-quality confidence. Shared layout primitives (`Tile`, `Card`,
`SectionHeader`, `Meter`, `SectionEmpty`, posture labels) live in
`src/components/org/ui.tsx`.

## Canonical time-zone policy (`src/lib/org/timezone.ts`)

Every calendar-day decision the org dashboard makes — window preset starts, custom-range
parsing, trend day-keys, due-date bucketing — resolves in **one** reference frame. Before
this existed each of those picked its own: presets and the custom-range parser used the
**server's local** zone, `daysUntil` compared a UTC-truncated target against a
locally-truncated `now`, and the usage chart keyed days in UTC. The same scan could fall
inside the window on one surface and outside it on another, and a backlog item could read
"Overdue" a day early. (G4-07)

**The policy**

1. There is exactly one canonical zone per deployment, returned by `orgTimeZone()`.
2. It defaults to **UTC**. Server-local was never a decision — it is whatever the host
   happened to be set to (UTC on Vercel, CET on a European dev laptop), so identical data
   produced different day buckets in dev and prod and would move if the host's `TZ` changed.
   UTC is stable, reproducible, matches how date-only columns are already persisted
   (midnight UTC), and matches the day-key axis `src/lib/db/usage.ts` already uses.
3. A deployment may override it with the **`ASCENT_ORG_TZ`** env var (any IANA name, e.g.
   `America/New_York`). An unknown zone degrades to UTC rather than throwing mid-render.
4. **All intervals are half-open**: `[start, endExclusive)`. `ResolvedWindow.endExclusive`
   is the canonical upper bound; `ResolvedWindow.end` survives only as its last
   representable instant (`endExclusive − 1ms`) for call sites whose Prisma filter still
   says `lte`. New code should use `endExclusive` with `lt`.
   **`OrgWindow` — the shape the db layer queries with — now carries `endExclusive` too**, and
   `upperBound()` (`src/lib/db/org-shared.ts`) turns a window into `lt: endExclusive`, falling
   back to `lte: end` only for callers that have nothing else. Every fleet aggregate
   (`getOrgRollup`, `getOrgMovers`, `getOrgTeamRollup`, `getOrgRepoHistories`,
   `getOrgEngineMix`, `getOrgRecsActioned`, `getOrgDeliveryTrend`) goes through it. This
   matters where two windows **abut**: the executive briefing's prior period ends exactly
   where the current one starts, and under the old inclusive bound a scan landing on that
   boundary instant was counted on *both* sides.
5. A **date literal** (a `yyyy-mm-dd` a human picked, or a date-only DB column such as
   `Recommendation.targetDate`) is *not* an instant. It is read back with
   `dayKeyOfDateColumn` (UTC getters — the frame it was written in) and only then compared
   against `now`'s day in the canonical zone. Never re-truncate a date-only column in a
   westward zone; you get the previous day.
6. Day arithmetic is **calendar** arithmetic (`addDaysInZone`), never `n × 86_400_000`. A
   DST day is 23 or 25 hours, and the old `startOfDay(now − 90 × DAY)` could snap the 90d
   baseline to an adjacent calendar day depending on the render hour.

**Primitives** — `orgTimeZone()`, `resolveOrgTimeZone()`, `knownTimeZone()`, `partsInZone`, `zonedMidnight`, `startOfDayInZone`,
`addDaysInZone`, `startOfQuarterInZone`, `dayKeyInZone`, `dayKeyOfDateColumn`,
`parseDayKey`, `daysBetweenDayKeys`. Pure and isomorphic (no `next/headers`, no I/O), so
`src/lib/window.ts` — which the client `TimeRangeSelector` also imports — can depend on it.

### Which tabs the period actually governs (2026-08-03)

The period is **cross-tab state**: `resolveOrgWindow` layers `?range=` over the `ascent_period`
cookie, so a window chosen on Overview follows the user onto every other tab. Two tabs cannot
honour it, and that is now **disclosed on the tab instead of being silently true**.

| Tab | Period-scoped? |
| --- | --- |
| Overview · Delivery · Briefing · Security · Teams | **Yes** — all resolve `resolveOrgWindow(sp)` and pass the window into their queries. |
| Repositories · Tech Stacks · Passports | **No, by design** — latest-snapshot catalogs. They present no aggregate a range could re-cut. |
| **Adoption · Contributors** | **No — and they say so.** |

**Why they can't be scoped, and why threading a window would be a fake fix.**
`RepoContributor` (`prisma/schema.prisma`) is uniquely keyed `(repoId, login)` and upserted each
scan: it holds *cumulative* `commits` / `aiCommits` totals plus one `lastActiveAt`, with no dated
commit history. `Scan.prStats` is likewise a pre-computed JSON aggregate read off each repo's
**latest** scan (`getOrgPrSignals`). Neither can answer "commits in the last 30 days" at any cost.
Adding a `window` parameter to `getContributorInsights` / `buildAdoptionOverview` would produce a
signature that accepts a range and ignores it — worse than today, because the lie would then be in
the code as well as on screen.

**The contract is disclosure.** `SnapshotScopeNotice`
(`src/components/org/shared/SnapshotScopeNotice.tsx`) renders **above the tiles** on both panels:
it names the range the user has selected, draws it as a visibly **inert** chip (struck through,
`aria-disabled` — the period is acknowledged, never implied to be in force), states that the figures
are a scan-time snapshot, and links to a tab that *does* honour the period. The old footnotes that
buried this under the numbers were trimmed to the mechanics they uniquely explain. Pinned by
`SnapshotScopeNotice.test.tsx`.

**Bucket labels state their maths.** The backlog's due buckets are *rolling* days, not
calendar periods: labels are interpolated from `DUE_SOON_DAYS` (7) and `DUE_MONTH_DAYS` (31)
in `src/components/org/shared/backlogShared.ts`, so "Due within 31 days" can never drift
from the cutoff that produced it. The `this_month` enum key is historical — it has never
meant a calendar month.

**Per-org zones (policy note 6).** `Organization.timezone` holds one org's IANA zone ("this
org's Monday"). Resolution order is **column → `ASCENT_ORG_TZ` → UTC**, owned by
`resolveOrgTimeZone(stored)`; never read the column at a call site, or the validation and the
fallback order drift per surface — the exact defect class this policy exists to prevent. The
storage accessors are `getOrgTimeZone(slug)` / `getOrgTimeZoneSetting(slug)` /
`setOrgTimeZone(slug, tz)` in `src/lib/db/org-settings.ts` (`getOrgTimeZoneSetting` returns the
raw column, so a settings UI can distinguish "inherited" from "explicitly UTC"). An invalid zone
is rejected on **write**; an unknown one already stored still degrades to the default on read
rather than throwing mid-render.

The column is nullable and nothing was backfilled, so every existing org inherits the deployment
default exactly as before. Routed through it today: the backlog's due-date bucketing
(`getOrgBacklog` → `daysUntil`/`dueBucketFor`, which now take an optional `tz`) and the delivery
trend's day buckets (`getOrgDeliveryTrend` → `buildDeliveryTrend`). Other surfaces still resolve
via the deployment default until they are threaded the same way.

**Not yet routed through the policy** (each still uses its own frame; safe under the UTC
default, would diverge the moment `ASCENT_ORG_TZ` is set):
`src/lib/db/org-rollup.ts`'s `localDayKey` (server-local — the trend day-key axis),
`src/lib/db/usage.ts`'s `dayKey` (UTC), and the client-side `daysUntil` in
`src/components/org/live/LiveWarRoomHeader.tsx` (genuinely viewer-local, and therefore able
to disagree with the server's bucket by a day).

## Executive briefing (`src/lib/org/briefing.ts`)

`buildExecBriefing(org, window, periodTitle, segmentId, techGroupId)` is pure assembly over the
rollups above. **Three surfaces render the same `ExecBriefing`** and must never disagree: the
Briefing tab (`src/app/org/[slug]/executive/page.tsx`), the board PDF
(`GET /api/org/briefing/pdf` → `src/lib/pdf/briefing-document.tsx`), and the "Copy for LLM"
markdown (`briefingMarkdown`). The anonymous share link (`/share/briefing/[token]`) re-runs the
same builder against the token's window.

**One ranked source for "what to do next" (G5-02).** The briefing carries
`recommendations: OrgRec[]` — the top-5 `getOrgRecommendations` rows, fetched once inside
`buildExecBriefing` under the same segment/stack scope as everything else. Read it through
`briefingNextMove(b)`, and render the sentence with `nextMoveLine(rec)`. Previously the page
queried this itself while the export path kept an older `risks[0] ?? b.security` heuristic: on a
small, high-scoring fleet with an empty `risks` list the PDF and the markdown printed the security
dimension as "the fleet's weakest dimension" **even when it was the fleet's strongest** — a board
document naming a strength as the weakness. There is deliberately **no dimension fallback** now: an
empty list means the section is omitted, never replaced by a second notion of "weakest".

**Window resolution matches the page (G5-10).** The PDF route resolves its window with
`resolveOrgWindow` (`src/lib/org/period.ts`) — the same cookie-aware precedence every org tab uses:
explicit `?range=` › the remembered-period cookie › the default. It previously called the
cookie-blind `resolveWindow`, so a bookmarked or shared PDF URL with no `?range=` silently exported
the 90d default while the page beside it showed the org's remembered period. Boundary arithmetic is
inherited unchanged from the canonical time-zone policy above.

**Download affordance (G5-23).** The Briefing tab's "Download PDF" uses `DownloadButton`, not a bare
anchor: the render is CPU-bound (`maxDuration = 60`) and every error branch returns JSON, which a
plain anchor would display as the whole page. Same treatment as the Security tab's export.

### LLM narrative (`src/lib/org/briefing-narrative.ts`, G5-03)

The board PDF may open with a short LLM-written narrative. Because a briefing PDF is the surface most
likely to leave the building unedited, this is not a general "summarize it" call — three guarantees
are enforced in code:

1. **Grounded by construction.** The only input the model sees is `narrativeFacts(b)` — the
   briefing's own markdown (minus the trailing `## Ask`, which is an instruction, not a fact).
2. **No new numbers.** Every numeric token in the returned prose must already be in the briefing —
   `isGrounded(text, allowedNumbers(b))`, where `allowedNumbers` unions the numbers in the briefing
   object with the ones the markdown prints. One invented figure — including one the model *derived*,
   like a coverage percentage — discards the whole narrative. The model chooses emphasis and wording;
   never a quantity.
3. **Degrades to deterministic copy.** Unconfigured, disabled, non-2xx, refusal, timeout, malformed,
   markdown-structured, tag-leaking, or ungrounded ⇒ `deterministicNarrative(b)`, assembled from the
   same figures by template. There is no error state to render.

**Off by default**, requiring both `BRIEFING_NARRATIVE=1` and `ANTHROPIC_API_KEY`; with neither
(the default, including CI) the module performs no network I/O. `BRIEFING_NARRATIVE_MODEL` and
`BRIEFING_NARRATIVE_TIMEOUT_MS` (default 20s) tune it. Transport is raw `fetch` against the Anthropic
Messages API, matching `src/lib/llm/openai.ts`'s "no SDK dependency added" convention and reusing the
scan providers' `withLlmTimeout`.

`ExecBriefing.narrative` is **not** populated by `buildExecBriefing` — a deliverable opts in via
`attachBriefingNarrative(b)`. Only the PDF route does, deliberately: the "Copy for LLM" markdown is
consumed by another model, which gains nothing from prose we generated for it.

## Getting repos into an org

| Route | Method | Role |
| --- | --- | --- |
| `/api/org/import` | `POST` (SSE) | Bulk-import: list an org's public repos, scan each, persist, optionally watch + schedule. Powers free-tier onboarding without installing the App. |
| `/api/org/scan` | `POST` (SSE) | Scan every **watched** repo (uses the installation token for private repos). Drives `OrgScanButton`. |
| `/api/org/watch` | `POST` | Toggle a repo's `watched` flag (`setRepoWatch`). |
| `/api/org/schedule` | `POST` | Set a repo's autoscan period off/daily/weekly/monthly (`setRepoSchedule`, computes `nextScanAt`). Drives the rescan [cron](../fleet/rescan.md). |
| `/api/org/repos` | `GET` | List an org's public repos (onboarding picker). |
| `/api/org/export` | `GET` | `kind=contributors\|delivery\|passports\|teams` as JSON or CSV (`format=csv`), gated by `requireOrgRead` and scoped by `segment`/`stack`. `kind=contributors` returns **403** below the 3-contributor naming floor rather than a header-only CSV — a CSV carries no scope marker once it leaves the app. |
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
- **The invite is now delivered** (G7-02) — creating an invite with an `email` sends **one**
  transactional message to that address via the shared email transport (`src/lib/email/invite.ts`).
  *Trigger*: an owner's `POST /api/org/invites` with `email` set. *Recipient*: only that address.
  *Opt-out*: `notify: false` in the same request; deployment-wide, `EMAIL_INVITES=off`, and the whole
  path is inert with no email provider (`SES_FROM_EMAIL` unset). There is no list and no repeat send,
  so there is nothing to unsubscribe from — the mail says exactly that.
  The address is **not verified** (an owner typed it), so the mail discloses only the org slug, the
  role, the inviting login, the link and the expiry — no scores, repos, or member list — and accepting
  still requires the accepter's Supabase-**confirmed** email to match the pin (`acceptInvite`), so a
  misdirected message cannot hand a stranger the role. The response reports `emailed`:
  `"sent" | "skipped" | "failed" | null`, and the invite + token are returned either way, so the
  owner's manual copy/paste path is never lost. The audit entry records the outcome.

## Provider integrations (`org/[slug]/integrations`, owner-only)

Connects AI coding providers so the **AI delivery** views run on real usage instead of the
simulated placeholder. One card per provider from the registry
(`src/lib/integrations/providers.ts`), each declaring the best per-repo **fidelity** it can
reach: `measured` (Claude Code, via the OTel `git.repository` resource attribute),
`allocated` (Copilot / OpenAI — reported above repo level, distributed by git-attributed AI
volume), `simulated` (nothing connected yet). Claude Code is the only `available` one today;
the other two render as `planned`.

**The ingest surface** (`src/app/api/integrations/ingest`, plus `/v1/metrics` and `/v1/logs`)
is the app's only internet-facing, body-accepting endpoint authenticated by nothing but a
bearer token, so it carries the same guards as the rest of the public funnel — all three
routes share one front door, `guardIngest` in `src/lib/integrations/ingest-guard.ts`:

| Guard | Behavior |
| --- | --- |
| Rate limit | `INGEST_RATE_LIMIT` layered on the shared limiter (`src/lib/rate-limit.ts`) — per-IP burst 3,000/min + a 20,000/min per-instance global, both env-overridable (`RATE_LIMIT_INGEST_PER_IP` / `_GLOBAL`). Derived from Claude Code's real push cadence: metrics flush every 60s and logs every 5s **per developer machine**, so a 200-seat org behind one egress IP legitimately produces ~2,600 req/min. Charged **before** token verification, so a flood is refused without spending crypto. |
| Body cap | `MAX_BODY` = 1 MB, checked against a declared `content-length` first and then by streamed byte count, so an oversized push is refused (**413**) after one chunk rather than buffered. Applies to the accept-and-discard paths too (the protobuf drain, `/v1/logs`). |
| Token | `parseIngestToken` re-derives the HMAC from the slug **and minted epoch** in the token; constant-time compare, then the epoch is checked against the org's stored one. Runs **before** any body/wire-format handling, so a bad-token protobuf push gets 401, never 415. |

### Token rotation (`Organization.ingestTokenEpoch`)

The token is designed to be copied — into a shell profile, a CI secret, a Slack thread by mistake.
It carries the per-org **revocation epoch** it was minted at, the same version-bump shape
`SessionRevocation` uses for the session cookie's `sv`:

| Epoch | Token |
| --- | --- |
| 0 (never rotated) | `asc_otel.<slug>.<mac>`, `mac = HMAC(secret, "otel:<slug>")` — byte-for-byte the pre-rotation format, so **no org re-onboards** |
| N | `asc_otel.<slug>.e<N>.<mac>`, `mac = HMAC(secret, "otel:<slug>:e<N>")` |

The epoch is inside the signed material, so an old mac can't be relabelled with a higher epoch.
**Regenerate token** on the Integrations page (owner-only, behind an inline confirm that states the
consequence — every exporter still using the old token starts getting 401s on its next push, with no
queue or recovery) POSTs `/api/integrations/token { org, rotate: true }`, which bumps the epoch, audits
the act (`integrations.token.rotate`) and returns the new token. The panel re-renders the masked field,
the env snippet and the Test button from that response, so the owner copies a working configuration
**without a reload** — which matters because the response is the only place the new token exists.

**The mask is real, not decorative.** One `Reveal` control governs *both* rendered surfaces — the token
field and the `ENVIRONMENT` block — because the snippet used to interpolate the full token
(`…HEADERS=Authorization=Bearer asc_otel.<slug>.<mac>`) three lines below a field showing bullets, so
screenshotting or screen-sharing the page leaked the credential the owner believed was hidden. Masking
stops at the display: **Copy always puts the working token on the clipboard**, on the field and on the
snippet alike, since a clipboard full of `•` would be a worse failure than the leak. Both
representations come from one pair of functions (`src/components/org/integrations/envSnippet.ts`), so
there is no per-surface masking rule to drift. Pinned by
`src/components/org/integrations/ClaudeCodeSetup.dom.test.tsx`, which asserts the raw mac is absent
from the entire rendered DOM while masked and present after reveal.

Rotating `INTEGRATIONS_INGEST_SECRET` still works as the break-glass for **all** orgs at once.
If the stored epoch can't be read while a DB is configured, ingest answers **503**, never a
fall-back-to-0 that would resurrect the token the owner just revoked.

### Reporting what actually landed

An integration that receives forty datapoints and stores zero used to look, on this page, exactly
like one that is working. Three independent paths drop data, and all three are now **counted and
reported** rather than silently skipped:

| Reason | What it means |
| --- | --- |
| `unknown-metric` | The datapoint's metric is outside the three-name allowlist (`claude_code.token.usage` / `.cost.usage` / `.session.count`). Its **value** is dropped — widening the allowlist is a non-goal; reporting the drop is the point. |
| `no-repo-attr` | The resource carries no `git.repository`, so the spend can't be attributed to a repository. |
| `unsupported-host` | The remote resolves to a host whose repo identity Ascent doesn't model — GitLab, Bitbucket, self-hosted. `resolveGitRepo` **names the host** so the report is actionable. A non-GitHub remote is explicitly reported as unsupported; it never silently vanishes. |

`parseOtlpMetrics` returns `{ records, received, skipped, unsupportedHosts }`, and the **202 body
carries `received` / `stored` / `skipped`-by-reason** plus a plain-language `note` when anything was
dropped (omitted entirely when nothing was).

Per provider, the Integrations card shows **last received** time and what landed — distinct repos
attributed and cost over the trailing 35 days — read from `AiUsageRecord.updatedAt`
(`getProviderIngestStatus`), so there is **no schema behind it and no second write path to drift**.
Three explicit states: never received; received but **nothing attributed to a repo** (the
previously-invisible failure, called out in orange with the `git.repository` fix); receiving.

`/v1/logs` is exempt: it authenticates and 202-accepts without parsing, deliberately.

`/v1/metrics` **refuses OTLP/protobuf with 415** naming the
`OTEL_EXPORTER_OTLP_PROTOCOL=http/json` fix. This is deliberate: Ascent decodes OTLP/JSON only,
and a 202 on a payload it cannot parse would read to the collector as "delivered" while nothing
ever persists. `/v1/logs` authenticates and 202-accepts without parsing — the token/cost signal
lives in metrics; folding log events into usage is a later step.

## Key files

| File | Role |
| --- | --- |
| `src/lib/db/org.ts` | Barrel re-exporting the org rollup/aggregate queries (rollup, movers, recs, benchmark, gaps, practices, contributors, **teams** (`getOrgTeamRollup`/`rollupTeams`), governance, activity, PR signals, discrepancies) from the `org-*.ts` sub-modules above. Each fleet aggregate takes an optional `segmentId` to scope it. |
| `src/lib/db/segments.ts` | User-defined **segments** (`Segment`/`RepoSegment` tags): CRUD + membership, per-segment summaries, and the side-by-side `compareSegments` (pure diff `buildSegmentComparison`, unit-tested). |
| `src/components/org/SegmentSelector.tsx` · `RepoSegmentsPanel.tsx` · `SegmentComparePicker.tsx` | Overview/Contributors segment filter · Repositories-tab tag manager · A-vs-B comparison picker. |
| `src/components/org/tech-stacks/fleetAnalysis.ts` | Pure cross-stack dimension analysis: classification thresholds, per-dimension leader/laggard/spread, and `coverageOf` (what a verdict rests on — see [above](#tech-stacks--dimension-analysis-and-what-each-verdict-rests-on)). |
| `src/components/org/tech-stacks/analysisShared.tsx` | Shared diagnosis chrome — class pill (de-weightable), `CoverageChip`, 0→100 range bar, plain-language note, the `ConsensusRow`. |
| `src/lib/github/codeowners.ts` | Pure CODEOWNERS → team parser (`parseCodeowners`/`extractTeamOwnership`); run at scan time, persisted as `RepoTeam`. |
| `src/lib/org/timezone.ts` | **The canonical org time-zone policy** — one reference frame (UTC by default, `ASCENT_ORG_TZ`-overridable) for every calendar-day boundary: zoned midnights, calendar-day arithmetic, day keys, date-literal parsing. See [above](#canonical-time-zone-policy-srcliborgtimezonets). |
| `src/lib/window.ts` | Resolves `?range=/from=/to=` into a `ResolvedWindow` (`start`, half-open `endExclusive`, `end` compat bound, labels) using the canonical zone. Pure + isomorphic. `src/lib/org/period.ts` adds the `ascent_period` cookie precedence (`?range` > cookie > default). |
| `src/lib/maturity/forecast.ts` | Linear-fit projection + ETA to next level. |
| `src/lib/org/briefing.ts` | `buildExecBriefing` (the one assembly behind page/PDF/markdown/share), `briefingMarkdown`, and the single ranked next move (`briefingNextMove` / `nextMoveLine`). |
| `src/lib/org/briefing-narrative.ts` | Opt-in, number-grounded LLM narrative for the board PDF, with a deterministic template floor. Off unless `BRIEFING_NARRATIVE=1` + `ANTHROPIC_API_KEY`. |
| `src/components/org/shared/OrgNav.tsx` | Persistent nav rail (two-level `SectionRailNav`). |
| `src/components/OrgSwitcher.tsx` | Org/installation picker (persists active org). |
| `src/components/org/overview/Trajectory.tsx` | Forecast "GPS" card. Mounted by `/trends` (`TrajectoryPanel`) and the personal overview — **not** by the org Overview tab, whose forward-looking read is the standing strip's sparkline. |
| `src/components/org/OrgScanButton.tsx` | Scan-all-watched button (SSE progress). |
| `src/components/org/AuditLogViewer.tsx` | Audit trail viewer. |
| `src/components/org/backlog/BacklogPanel.tsx` | Backlog tab client panel — grouping toggle, inline status/owner/due-date edits, per-item activity history, undo bar, search/filter row and the bulk-action bar. |
| `src/components/org/backlog/backlogFilter.ts` | Pure search/filter model (`matchesBacklogFilter`, `filterBacklog`, `filterWantsClosed` — the rule that composes a closed-status chip with the `includeClosed` fetch). |
| `src/components/org/backlog/useBacklogBulk.ts` | Bulk status runner — `MAX_BULK` (100) per action, `BULK_CONCURRENCY` lanes, one refresh at the end. |
| `src/components/org/backlog/BacklogGroups.tsx` | The grouped Cards + rows + the three empty states (filter-empty is distinct from backlog-empty). |
| `src/components/org/ui.tsx` | Shared org-UI primitives. |
| `src/app/api/org/*` | Active org, repos, import, scan, watch, schedule, segments, **backlog** (`GET ?org=` → `OrgBacklog`) (+ goals/initiatives/simulate — see [plan.md](../org-planning/plan.md)). |
| `src/app/api/recommendations/[id]` | `PATCH` (status / `assigneeLogin` / `targetDate`, recording a `RecommendationEvent` attributed to the signed-in user) · `[id]/events` `GET` → the item's activity timeline. |
| `src/app/api/audit/route.ts` | Audit query endpoint. |

## Mock scores never enter an average (2026-08-03)

A scan run without a model produces a **deterministic mock** score (`engine: "mock"`) — a
placeholder floor, not a grade. Anywhere the Overview presents a figure as a *measurement*, mock
rows are excluded from it:

| Figure | Rule |
| --- | --- |
| Fleet masthead `avg`, per-group `avg` (`avgRealScore`) | Averaged over live-scored repos only. **Null, never 0**, when the set has none — the renderers land on the `—` no-score path, because a `0` in `scoreHex(0)` alarm-red reads as a catastrophic grade rather than "not measured". The repo *count* still describes the whole set, and the tooltip names the denominator (`N live-scored · M mock excluded`). |
| Fleet + per-group `avg move` (`avgRealMove`) | Excludes single-scan repos and **engine-transition** deltas, so a mock→live re-scan cannot fake improvement. Pre-existing; the score average now matches its precedent. |
| Corpus percentile (`getOrgBenchmark`) | Both sides filtered to non-`mock` engines at the current rubric version (see above). |

Groups with no live-scored repo sort **last**, not as the worst-scoring cohort. Pinned by
`src/components/org/overview/fleetAverages.test.ts` (all-mock, mixed, and zero-scored fleets).

## Known gaps

- **The Overview shows standing, not a punch list.** It renders where the fleet stands and how its
  composition is moving; it does NOT rank "what to fix first". A derived three-item punch list
  (`OverviewFixFirst` / `fixFirst.ts`) existed and was deleted on 2026-08-03 because three of its
  four inputs — `getOrgMovers`, `getOrgGapAnalysis`, `listGoals` — are queries the Overview does not
  make, and adding them would put three reads on the dashboard's landing path to render three lines.
  The same answers live one click away and unabridged: gap analysis and reusable exemplars on
  [Practices](./practices.md), goal pacing on [Plan](../org-planning/plan.md), and the ranked
  narrative on the Briefing tab. Reviving it means giving it its own `<Suspense>` boundary and
  accepting the reads — a deliberate decision, not a restore.

- **No per-contributor drill-down page, deliberately** — and no per-person time-series to build one
  from: `RepoContributor` is uniquely keyed `(repoId, login)` and upserted each scan, so it is a
  *current* snapshot with no history. Two reasons this stays unbuilt rather than "not yet": (1) the
  data doesn't exist — a "this person's trajectory" page could only be faked; (2) the only per-person
  history that *does* exist (`AiChange.authorLogin`) is documented in the schema as internal-only and
  pseudonymized in customer-facing packs, so building a profile page on it would invert an existing
  privacy decision. Team-level drill-down already exists (the expandable `TeamsMatrixDetail` row).
- **No DORA panel, deliberately** — of DORA's four metrics, Ascent ingests neither a deployment feed
  nor an incident feed, so **deployment frequency** and **time to restore** are not derivable at all;
  **lead time for changes** (commit → running in production) is only partially observable as PR
  open→merge latency, which the Delivery trend ships under its true name ("time to merge"); and
  **change failure rate** has only `prStats.revertRate` (a VCS revert, not a production failure)
  behind it. Labelling any of these "DORA" would invite a leader to benchmark a proxy against
  published industry figures. Unblocking it needs GitHub Deployments/Releases ingestion plus an
  incident source — a data-ingestion project, not a dashboard one.
- **No regression notifications in the UI** — movers show on the dashboard; push/email
  alerts go through the webhook sink (see [../alerts.md](../fleet/alerts.md)).
- **Org trend is overall-only** — per-dimension org trends over time aren't surfaced yet.
- **Team attribution is CODEOWNERS-only** — `getOrgTeamRollup` keys off each repo's CODEOWNERS
  (`@org/team` owners, parsed at scan time). Repos with no CODEOWNERS team show as "unowned"; the
  GitHub Teams API (GraphQL) as a fallback attribution source is still on the roadmap.

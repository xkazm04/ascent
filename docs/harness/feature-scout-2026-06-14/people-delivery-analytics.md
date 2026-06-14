# Feature Scout — People & Delivery Analytics (ascent, 2026-06-14)
> Total: 6
> Severity: 1C / 3H / 2M / 0L

## 1. Delivery trend over time (PR signals & governance history)
- **Severity**: Critical
- **Category**: functionality
- **File**: src/app/org/[slug]/delivery/page.tsx:31; src/lib/db/org-signals.ts:20
- **Scenario**: A delivery lead wants to know whether review coverage, time-to-merge, and AI-governance are getting better or worse since they started a push — not just today's snapshot. The Commit-activity card already shows a weekly sparkline, so users will reasonably expect the PR/governance tiles to trend too.
- **Gap**: `getOrgPrSignals`/`getOrgGovernance` read only each repo's *latest* scan (`scans: { orderBy: { scannedAt: "desc" }, take: 1 }`) and the page renders point-in-time tiles with no time dimension. Confirmed: no `OrgWindow`/`getOrgWindow`/`TimeRangeSelector`/`searchParams` usage anywhere under the delivery route (grep found those only on the overview `page.tsx`). Yet `Scan.prStats`/`governance` are fully historical — `Scan` is indexed `@@index([repoId, scannedAt])` and the overview already does windowed comparison via `getOrgMovers`. The trend data exists; it's simply never queried for delivery.
- **Impact**: Every org leader and EM. Converts a static "where are we" board into a "are we improving" instrument — the single most-expected analytics capability and the basis for proving the platform's value over time.
- **Fix sketch**: Add `getOrgPrSignalsTrend(slug, window)` / `getOrgGovernanceTrend` in org-signals.ts that bucket scans by `scannedAt` (reuse the windowed-scan grouping pattern already in `getOrgMovers`, org-insights.ts:80-112), returning a series per metric. Reuse the existing `ActivityChart` and `TimeRangeSelector` components on the delivery page. ~1–1.5 days (no schema change).

## 2. Per-repo PR breakdown on the delivery tab (built-but-unexposed PrStats fields)
- **Severity**: High
- **Category**: functionality
- **File**: src/app/org/[slug]/delivery/page.tsx:44-81; src/lib/types.ts:256
- **Scenario**: The fleet-average "Review coverage 62%" tells a leader something is off but not *which* repos drag it down. For governance they can already drill to a per-repo table (delivery/page.tsx:109 `gov.perRepo.map`), so the missing PR equivalent is a jarring asymmetry.
- **Gap**: `OrgPrSignals` only returns fleet means (org-signals.ts:51-61) — there is no `perRepo` array for PR stats, and the page renders no PR table. Worse, `PrStats` (types.ts:256) computes and persists `medianHoursToFirstReview`, `revertRate`, `draftRate`, `botAuthoredRate`, `avgReviews`, `avgComments`, `avgLineChanges`, `avgChangedFiles`, and raw `open/merged/closedUnmerged` counts — all surfaced in the *per-repo* `PrSignalsPanel.tsx` but never aggregated or shown at org level (grep confirms those field names appear only in types/scoring/pulls and the single-repo panel, never in org-signals.ts or delivery/page.tsx).
- **Impact**: EMs and platform owners. Turns an average into an actionable list ("these 3 repos have <30% review coverage / >15% revert rate") and exposes already-computed signals (time-to-first-review, revert rate, draft rate) at no scan cost.
- **Fix sketch**: Extend `OrgPrSignals` with `perRepo: { fullName, name, reviewedRate, mergeRate, smallPrRate, medianHoursToFirstReview, revertRate, botAuthoredRate }[]` (data already parsed in the loop at org-signals.ts:32-41) plus fleet means for the new fields; add an `OrgTable` mirroring the governance table, risk-sorted (lowest review coverage / highest revert first). ~0.5 day.

## 3. Contributor & team drill-down (deep-link from rollup to detail)
- **Severity**: High
- **Category**: user_benefit
- **File**: src/app/org/[slug]/teams/page.tsx:99-110; src/app/org/[slug]/contributors/page.tsx:113-135
- **Scenario**: Looking at the "AI champions" or a team card, a leader wants to click a person to see all their repos, AI share, and last-active — or click a team's repo chip to jump to that repo's report. Today every login and repo chip is inert text.
- **Gap**: No contributor- or person-detail route exists (`find` under `src/app/org` shows only `contributors/` and `teams/` directories, no `[login]`/person/member sub-route). Neither page renders any `<Link>`/`href` (grep for href/Link in both files returned nothing), and the teams page never links to contributors. The data to populate a drill-down already exists: `ContributorInsight` carries `repoNames`, `aiShare`, `repos`, `lastActiveAt` per person (org-contributors.ts:42-52), and `TeamRollup.repos`/`champions` are fully populated.
- **Impact**: All dashboard users. Drill-down is table-stakes for analytics products; it connects the three tabs into a navigable journey (team → its people → each person's repos → repo report) instead of three dead-end tables.
- **Fix sketch**: Make repo chips link to `/report/{owner}/{repo}` (data already has `fullName`). Add a `org/[slug]/contributors/[login]/page.tsx` server component reusing `getContributorInsights` (filter to the login) for a per-person profile. Link logins in the Involvement table and champion cards. ~1 day.

## 4. DORA-style delivery framing (lead time, change-fail proxy, throughput)
- **Severity**: High
- **Category**: feature
- **File**: src/app/org/[slug]/delivery/page.tsx:44-81; src/lib/db/org-signals.ts:7-17
- **Scenario**: Engineering leaders benchmark against the industry-standard DORA metrics. They'll expect a "maturity/delivery" platform to speak that language: throughput, lead time for changes, change-failure rate, and an MTTR proxy.
- **Gap**: No DORA vocabulary or composition anywhere (grep for `dora|deployment frequency|lead time|change.fail|mttr|cycle time` found only unrelated auth-error strings). The raw ingredients already exist and are unused for this: `medianHoursToMerge` + `medianHoursToFirstReview` (lead-time-for-changes proxy), `revertRate` (change-failure-rate proxy), and `commitActivity`/PR throughput counts (deployment-frequency proxy). They're computed per repo but never recombined into the framework leaders recognize.
- **Impact**: Buyers/executives evaluating the org layer; sharpens competitive positioning vs LinearB/Swarmia/Haystack. High narrative leverage for relatively low build cost since the inputs are persisted.
- **Fix sketch**: Add a "Delivery performance" section to the delivery page mapping existing signals to four DORA-style cards with honest "proxy" labelling (the codebase already favors careful framing — e.g. `aiGovernedRate` null-when-no-sample). Compute in a small `lib/org/dora.ts` helper over `getOrgPrSignals` + `getOrgActivity`. ~1 day.

## 5. Segment scoping on Delivery & Teams (parity with Contributors)
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/org/[slug]/delivery/page.tsx:29-31; src/app/org/[slug]/teams/page.tsx:115-117
- **Scenario**: An org has tagged a "platform" segment and views Contributors scoped to it via the `SegmentSelector` (contributors/page.tsx:28-30, 53). They naturally expect Delivery and Teams to respect the same scope — but switching tabs silently reverts to the whole fleet.
- **Gap**: Only the contributors page is segment-aware. `getOrgPrSignals`, `getOrgGovernance`, `getOrgActivity` (org-signals.ts) and `getOrgTeamRollup` (org-teams.ts:322) take no `segmentId` and apply no `segmentScope(...)` to their repo queries (grep for `segmentId`/`segmentScope`/`listSegments` in those files returned nothing), and neither page renders a `SegmentSelector`. The `segmentScope` helper and the pattern are already proven in org-contributors.ts and org-insights.ts.
- **Impact**: Any multi-team org using segments. Removes an inconsistency that makes the analytics feel untrustworthy, and lets leaders analyze delivery/team health for a specific business unit.
- **Fix sketch**: Thread `segmentId?: string | null` through the four org-signals/teams functions (add `...segmentScope(segmentId)` to each `prisma.repository.findMany` where), read `searchParams.segment` + render `SegmentSelector` on both pages mirroring contributors/page.tsx:27-30. ~0.5 day.

## 6. Export contributor / team / delivery data (CSV / copy-for-LLM)
- **Severity**: Medium
- **Category**: user_benefit
- **File**: src/app/org/[slug]/contributors/page.tsx:99-140; src/app/org/[slug]/delivery/page.tsx:96-131
- **Scenario**: A leader wants the involvement table, team rollup, or PR/governance per-repo data in a spreadsheet for a board deck or a 1:1 prep — or pasted into an LLM for a summary. Today they'd retype it from the rendered table.
- **Gap**: CSV export exists for *per-repo trends* (api/history/route.ts:97-100, `text/csv`) and *usage* (api/usage/route.ts:90), and there's a `CopyForLlm` component — but none of the three People & Delivery tables offers export or copy. Grep for `text/csv`/`.csv`/content-disposition shows no org-people/delivery export endpoint, and neither page imports `CopyForLlm`.
- **Impact**: Leaders and analysts preparing reviews. Low-cost, high-satisfaction power-user feature that extends the platform's reach into existing reporting workflows; reuses an established pattern.
- **Fix sketch**: Add a small `ExportButton`/`CopyForLlm` on each table that serializes the already-loaded server data to CSV (or add `?format=csv` to a thin `/api/org/[slug]/contributors|delivery|teams` route mirroring api/history/route.ts). Reuse `safeFilenameSlug`. ~0.5 day.

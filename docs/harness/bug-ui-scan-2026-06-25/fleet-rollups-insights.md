# Fleet Rollups & Insights — Bug + UI Scan
> Context: Fleet Rollups & Insights (Org Scanning & Fleet Rollups)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

## 1. Org-rollup family looks up the org with the RAW slug while auth + getOrgId normalize it
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: silent-failure
- **File**: src/lib/db/org-rollup.ts:52,188 (getRepoStates, getOrgRollup); src/lib/db/org-insights.ts:73 (getOrgMovers); src/lib/db/org-contributors.ts:51; src/lib/db/org-teams.ts:326 — all do `findUnique({ where: { slug: orgSlug } })` un-normalized, vs `getOrgId` at org-rollup.ts:34-37 which `.trim().toLowerCase()`s
- **Value**: impact 7 · effort 2 · risk 2
- **Scenario**: Org logins are PERSISTED lower-cased (the install flow lowercases; see the getOrgId doc). A viewer opens `/org/PostHog` (org row slug = "posthog"). `canReadOrg("PostHog")` (authz.ts:107) normalizes and authorizes them — then `getOrgRollup("PostHog")` does `findUnique({ where: { slug: "PostHog" } })`, finds nothing, and returns null. The member sees an empty "no data" dashboard for their own org. A concrete internal caller already triggers this: src/app/api/app/repos/route.ts:50-54 passes `org ?? repos[0]?.owner` (the GitHub owner login, which is CASE-PRESERVED) straight into `getRepoStates` and `getOrgMovers`, so the fleet-map movers/state overlay silently goes blank for any mixed-case org.
- **Root cause**: `getOrgId` was built as the single canonicalizing resolver ("lets every caller's lookup hit regardless of whether it pre-lowercased") and members.ts/invites.ts/authz route through it — but the rollup functions in the very same file/family each re-implement the lookup with the raw slug, so the data layer and the auth layer disagree on identity.
- **Impact**: Authorized-but-empty dashboards (success theater: looks like "your org has nothing scanned" rather than an error). Every aggregate in the context (rollup, movers, contributors, teams, backlog, benchmark, signals, governance, activity) is affected for any org whose canonical login contains uppercase.
- **Fix sketch**: Normalize once at the top of each public function (`orgSlug = orgSlug.trim().toLowerCase()`), or resolve through `getOrgId(orgSlug)` and query by `orgId` — making the unnormalized-slug class impossible across the whole family.

## 2. getOrgMovers (windowed path) loads the org's ENTIRE scan history into memory
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/db/org-insights.ts:84-97
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: With a `window.start` (the default 90d view, and every executive/briefing/live render), the query is `prisma.scan.findMany({ where: { repo:{orgId,...seg}, scannedAt: { lte: end } } })` — bounded only on the UPPER side. For an org scanned daily across hundreds of repos for a year+, this pulls every scan ever (tens of thousands of rows) into Node and groups them in a Map on each dashboard load. Unlike the rollup trend (org-rollup.ts:274-279) which clamps the lower bound to the plan's retention cutoff, movers has no `gte` floor.
- **Root cause**: The function only needs, per repo, the latest scan ≤ end plus the latest scan < start; instead it fetches all-time history and reduces in memory.
- **Impact**: Latency/memory time bomb that scales with fleet age, not with what the period needs — degrades the most-viewed page silently as data accumulates.
- **Fix sketch**: Add a lower bound — e.g. `gte: start` for the in-window set plus a separate "latest before start per repo" query, or clamp to the same retention floor the trend uses. Keeps the half-open baseline semantics while bounding the row count to the period.

## 3. getOrgActivity buckets GitHub's Sunday-anchored weeks on a Thursday-anchored grid
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/db/org-signals.ts:159-161 (weekIndex), applied 193-200
- **Value**: impact 4 · effort 3 · risk 3
- **Scenario**: `weekIndex(ms) = Math.floor(ms / WEEK_MS)` anchors week boundaries to the Unix epoch, which was a **Thursday**; GitHub `commit_activity` weeks start **Sunday**. The bucket for a repo's series is derived from `weekIndex(scan.scannedAt)`, so two repos covering the SAME Sun–Sat calendar week but scanned on opposite sides of a Thursday (e.g. one scanned Wed, one scanned Sat) get week indices differing by 1 — their identical real-world weeks land in adjacent fleet buckets and never sum together.
- **Root cause**: The rewrite (commented "align by absolute calendar week") aligns on a 7-day block phased to the epoch's Thursday and keyed off scan time rather than GitHub's actual week-start timestamp, so the phase varies by the scan's day-of-week.
- **Impact**: The fleet commit-activity sparkline is silently smeared by up to one week at the boundaries — the exact heterogeneous-cadence misalignment the rewrite claimed to fix, just shifted. Wrong-but-plausible data, no error.
- **Fix sketch**: Bucket on GitHub's per-element week-start timestamp if persisted; otherwise Sunday-anchor the index (shift the epoch phase by the 4-day Thursday→Sunday offset) so all repos share the same calendar-week grid regardless of scan day.

## 4. The CHAMPION_MIN_POP "success theater" guard lives in the UI and is absent from the data producers
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: state-corruption
- **File**: src/components/org/champions.ts:7 (constant + doc); producers emit champions unguarded at src/lib/db/org-contributors.ts:140-144 and src/lib/db/org-teams.ts:213-222 (neither imports CHAMPION_MIN_POP); only enforced at the 3 page views (teams/page.tsx:73, adoption/page.tsx:75, contributors/page.tsx:220)
- **Value**: impact 5 · effort 3 · risk 2
- **Scenario**: The constant's own doc mandates the guard be applied "IDENTICALLY everywhere champions are surfaced (Contributors, Adoption, Teams) so the org can't dodge it on one tab" — yet it is a UI-module constant duplicated into three page components, and `getContributorInsights`/`rollupTeams` populate `champions`/`knowledgeLeader` regardless of population. Any new surface that reads these (briefing PDF, live war room, OG image, CSV export, weekly digest) reintroduces the "single AI user becomes a celebrated #1 ★ champion / fleet reads 100% adopted" theater the guard exists to prevent.
- **Root cause**: Defense placed in the view layer, not the producer, so the invariant depends on every future consumer remembering to re-check `totalContributors`/`team.contributors`.
- **Impact**: Latent landmine — one un-gated consumer silently violates the stated privacy/anti-surveillance invariant on a tiny team.
- **Fix sketch**: Move the gate into the producers: when human population < CHAMPION_MIN_POP, return `champions: []`/`knowledgeLeader: null` (or a `championsSuppressed` flag) so every consumer inherits it; drop the constant into the lib layer so it isn't a UI-only import.

## 5. Custom range accepts from > to and silently empties the dashboard
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/window.ts:109-126
- **Value**: impact 3 · effort 2 · risk 2
- **Scenario**: `resolveWindow` parses `from`/`to` independently with no ordering check. A reversed custom range (typed into the URL, or `from` later than `to`) yields `start > end`. Downstream, getOrgRollup's trend query (`scannedAt: { gte: start, lte: end }`) matches nothing → blank trend/forecast, while the baseline query (`lt: start`) still returns rows compared against an `end`-bounded "current" snapshot that predates `start` — an incoherent, empty period with no validation error.
- **Root cause**: No invariant that `start <= end` (or `to >= from`) when building the custom window.
- **Impact**: Confusing empty dashboard / nonsensical deltas on a malformed range, presented as if it were real data.
- **Fix sketch**: If both bounds parse and `start > end`, swap them (or fall back to DEFAULT_RANGE) and surface a one-line "invalid range" hint in the selector.

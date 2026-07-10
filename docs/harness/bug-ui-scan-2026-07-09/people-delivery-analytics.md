# People & Delivery Analytics — bug-hunter + ui-perfectionist scan

> Context: People & Delivery Analytics (group: Org Dashboard & Analytics)
> Files scanned: 3
> Total: 6 findings (Critical: 0, High: 1, Medium: 3, Low: 2)

Notes on what was checked and cleared (so the low count is honest, not shallow):
- **Authorization / PII**: gated upstream in `src/app/org/[slug]/layout.tsx:57,83` (`authGateEnabled()` Supabase wall + `canReadOrg(slug)` tenant check) *before* any child page runs. Gating is on the ACTIVE gate, not the dormant `isAuthConfigured()`. Contributor logins/names are not reachable by a non-member. Not a finding.
- **Aggregation math**: `getContributorInsights`, `getOrgTeamRollup`, `rollupTeams`, `getOrgPrSignals`, `getOrgGovernance`, `getOrgActivity`, `buildAiDeliveryModel`, `explainTeamStandings` all guard every denominator (`total ? … : 0`, `Math.max(1, …)`, `.length ? … : null`). No divide-by-zero, no NaN reaches the DOM. The DB rollups return `null` on empty, so `activity.repos`/`pr.repos` are always ≥1 (the `> 1 ? "s" : ""` ternary can't hit the "0 repo" case).
- **N+1**: each rollup is one `findMany` with nested `select`; no per-contributor/per-team query loop.
- **teams/page.tsx**: thin, well-guarded wiring; `TeamsUnowned` self-guards (`unowned.length === 0` → null). Genuinely clean — 0 findings anchored here.

## 1. Allocated AI-spend is distributed across the whole org, not the filtered scope
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: aggregation-scope-mismatch
- **File**: src/app/org/[slug]/delivery/page.tsx:34
- **Scenario**: A leader opens `/org/acme/delivery?segment=payments` (or `?stack=…`). `pr`/`gov`/`activity` are fetched scoped by `segmentId`/`techGroupId`, but `getOrgUsageRollup(slug)` is called UNSCOPED (it takes no scope args). In "allocated" fidelity (an org-level provider total connected, no per-repo telemetry), `buildAiDeliveryModel` distributes the whole-org `allocTotalCents` over `weightSum = Σ aiPRs` of only the *filtered* repos (aiDeliveryModel.ts:129-131,147-151). So `Σ monthlySpend` over the 2-repo segment ≈ the entire company's AI spend.
- **Root cause**: assumption that the usage total shares the same scope as the PR signals it's joined to; it doesn't, and the allocation denominator shrinks with the filter while the numerator (org total) doesn't.
- **Impact**: money misattribution — the AI-delivery module's "idle spend / ungoverned spend / $ per AI PR / annual spend" figures inflate by (org total)/(segment subset) for any filtered view, driving wrong "reclaim $X" budget calls. (measured & simulated fidelity are per-repo and unaffected — only allocated is wrong.)
- **Fix sketch**: scale the allocated total to the visible scope before distributing — e.g. weight `allocTotalCents` by the filtered repos' share of org-wide AI-PR volume, or badge allocated figures "org-wide (unfiltered)" and suppress the $ readouts when a scope filter is active.

## 2. Adoption tiles read "100% AI-active" for a 1–2 person org (ungated success theater)
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: success-theater
- **File**: src/app/org/[slug]/contributors/page.tsx:243
- **Scenario**: An org with 1 contributor who has one AI-attributed commit. The champions grid is correctly hidden (gate at line 251: `totalContributors >= CHAMPION_MIN_POP`), but the summary tiles at 242-245 are ungated, so "AI-active" renders `100%` tinted green (`scoreHex`) and "Org AI commit share" shows an equally inflated headline.
- **Root cause**: the population floor is applied only to the champions leaderboard, not to the headline percentages — yet `components/org/champions.ts` documents the guard as protecting exactly the case where "the fleet reads as 100%-adopted — success theater," and says it "must be applied IDENTICALLY everywhere."
- **Impact**: overstates fleet AI maturity to a leader on a barely-adopted org; the one metric people screenshot is the least trustworthy at small N. UX/decision-integrity degradation.
- **Fix sketch**: gate the adoption tiles (or their color/emphasis) on `totalContributors >= CHAMPION_MIN_POP`; below it, show the raw count without the green % headline, mirroring the champions gate.

## 3. Delivery empty-state blames "no GitHub token" when a STACK filter emptied the view
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: misleading-error
- **File**: src/app/org/[slug]/delivery/page.tsx:60
- **Scenario**: User selects a tech-stack filter (`?stack=go`) that no scanned repo matches. `pr`/`gov`/`activity` all come back null → empty state. The message branches on `segmentId` only; with a stack filter (and no segment) `segmentId` is null, so it prints "Delivery signals … need a GitHub token. Re-scan with a token configured" — even though a token is configured and data exists, just filtered out.
- **Root cause**: the empty-state condition only accounts for the segment filter, not the composed tech-stack scope that `resolveOrgScope` also returns (`activeStack`/`techGroupId`).
- **Impact**: sends the user to re-configure a token they already have instead of clearing the filter; dead-end UX. (contributors/page.tsx:225 handles this correctly with `segmentId || activeStack ? "for this filter" : "yet"` — this page is the inconsistent one.)
- **Fix sketch**: branch on `segmentId || activeStack` and word it "No delivery signals for this filter — pick another segment/stack or scan more repos," matching the contributors page.

## 4. "Export CSV" silently drops the active tech-stack filter
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: filter-mismatch
- **File**: src/app/org/[slug]/contributors/page.tsx:74
- **Scenario**: With a stack filter active (`?stack=…`), the table shows techGroup-scoped rows (`getContributorInsights(slug, segmentId, techGroupId)`, line 218), but `ExportCsvLink` only accepts `segmentId` and builds `…&kind=contributors&format=csv&segment=…` (ui.tsx:289) — no stack param. The download therefore contains more rows than the table shows.
- **Root cause**: the export contract predates the tech-stack scope; the link component was never given a `stack`/`techGroupId` parameter, so export scope silently diverges from display scope.
- **Impact**: export ⊋ what's on screen whenever a stack filter is applied — a data-integrity/trust gap for anyone reconciling the CSV against the page. Same defect on delivery/page.tsx:51 (`kind="delivery"`).
- **Fix sketch**: thread the resolved `techGroupId` (or stack key) through `ExportCsvLink` and append `&stack=` / `&techGroup=`; have `/api/org/export` honor it so export scope matches the view.

## 5. Champion card can overflow / push the rank badge on a long login
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: truncation-overflow
- **File**: src/app/org/[slug]/contributors/page.tsx:29
- **Scenario**: A champion with a long GitHub login (up to 39 chars) on a narrow (single-column, mobile) card. The header is `flex items-center justify-between` with `<span class="font-mono text-base">{c.login}</span>` and the `#1 ★` badge — neither the login nor its flex parent has `min-w-0`/`truncate`, so a long login pushes the rank badge and can overflow the card edge.
- **Root cause**: truncation pattern not applied here; `truncate` alone doesn't work inside a flex child without `min-w-0` on the shrinkable cell.
- **Impact**: cosmetic overflow / misaligned rank badge on mobile for orgs with long usernames. The codebase already has the correct pattern in `components/org/TeamsUnowned.tsx:58` (`min-w-0 truncate`).
- **Fix sketch**: wrap the login in a `min-w-0 flex-1 truncate` cell and keep the badge `shrink-0`.

## 6. Hardcoded plural in the commit-activity caption yields "over 1 weeks"
- **Severity**: Low
- **Lens**: ui-perfectionist
- **Category**: pluralization
- **File**: src/app/org/[slug]/delivery/page.tsx:145
- **Scenario**: A fleet whose commit series spans a single week (`activity.weeks === 1`, reachable). The caption reads "… commits over 1 weeks" — the "repos" count right beside it IS pluralized correctly (`repo{activity.repos > 1 ? "s" : ""}`), so the mixed grammar is conspicuous. `pr.totalPrs …{pr.repos} repos` (line 83) is likewise hardcoded plural ("1 repos").
- **Root cause**: "weeks"/"repos" written as literal plurals while the adjacent unit was made conditional — inconsistent.
- **Impact**: minor copy polish; reads unfinished on small/new fleets.
- **Fix sketch**: a tiny `plural(n, "week")` helper (or `n === 1 ? "week" : "weeks"`) applied to both the weeks and PR/repo units in these captions.

# Code Refactor — Fleet Rollups & Insights
> Total: 5 | Critical: 0 High: 1 Medium: 3 Low: 1

## 1. Org-resolution preamble duplicated across the whole rollup family (a canonical resolver already exists but is bypassed)
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/org-rollup.ts:49-53,186-189,380-384,410-413; src/lib/db/org-insights.ts:71-74,164-167,352-355,557-561,670-674,761-765,860-864; src/lib/db/org-signals.ts:21-25,88-92,165-169; src/lib/db/org-contributors.ts:48-52; src/lib/db/org-teams.ts:323-327
- **Scenario**: Every exported aggregation in scope opens with the identical 4-line preamble:
  ```ts
  if (!isDbConfigured()) return <null|[]|{...}>;
  const prisma = getPrisma();
  const org = await prisma.organization.findUnique({ where: { slug: orgSlug } });
  if (!org) return <same>;
  ```
  That is 16 in-scope functions; a repo-wide grep finds ~45 copies of the `findUnique({ where: { slug: orgSlug … } })` line across the db layer. Meanwhile `getOrgId(slug)` (org-rollup.ts:34) is a canonical resolver that trims+lower-cases the slug and is already adopted by members.ts, invites.ts, scans-audit.ts and ~15 API routes — but none of the rollup family uses it.
- **Root cause**: The resolver consolidation was done for the membership/API side and never propagated to the rollup family, which keeps inlining the lookup. The copies also drift: most do `findUnique({ where: { slug: orgSlug } })` (full row, then use only `org.id`); getOrgEngineMix/getOrgRecsActioned use `select: { id: true }`; and unlike `getOrgId` none lower-cases the slug, so the convention is inconsistent within one file.
- **Impact**: 16+ near-identical preambles to read past; any change to the guard contract (e.g. slug canonicalization, a not-found metric) must be hand-applied in every function; the full-row-vs-`select:{id}` and lower-case-vs-not inconsistencies invite copy-paste drift.
- **Fix sketch**: Add a sibling resolver in org-shared.ts, e.g. `async function resolveOrg(slug, select?)` returning the org row (or `null`) with the `isDbConfigured()` guard folded in, and reuse `getOrgId` where only the id is needed. Convert each function's preamble to `const org = await resolveOrg(orgSlug); if (!org) return …;`. getOrgRollup (needs `org.plan`) passes `select: { id: true, plan: true }`.

## 2. `getOrgPractices` and `getOrgGapAnalysis` repeat the same repos query + `byDim` build
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/org-insights.ts:676-695 and src/lib/db/org-insights.ts:767-790
- **Scenario**: Both functions run the same query (latest scan per repo selecting `name, fullName, dimensions{dimId,score}`) and then build the same per-dimension index:
  ```ts
  const byDim = new Map<string, { name: string; fullName: string; score: number }[]>();
  for (const r of repos) {
    const dims = r.scans[0]?.dimensions; if (!dims) continue;
    for (const d of dims) {
      const arr = byDim.get(d.dimId) ?? [];
      arr.push({ name: r.name, fullName: r.fullName, score: d.score });
      byDim.set(d.dimId, arr);
    }
  }
  ```
  getOrgGapAnalysis additionally accumulates a `perRepo` map, but the query and the `byDim` construction are otherwise identical (the only nominal difference is `!dims` vs `!dims?.length`).
- **Root cause**: The two practice/gap views were written separately over the same "latest-scan dimensions per repo" shape; the shared loader was never factored out.
- **Impact**: ~12 duplicated lines in one file; the dimension-score data shape is defined twice, so a schema/parse change (or a fix to the `!dims` vs `!dims?.length` guard divergence) must be made in both places.
- **Fix sketch**: Extract one helper, e.g. `async function loadDimScores(prisma, where): Promise<Map<string, {name; fullName; score}[]>>` (plus optionally the `perRepo` map), and have both functions call it. Standardize on one empty-dimensions guard.

## 3. Windowed date-range where-fragment hand-rolled at every call site
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/org-rollup.ts:279, 391, 418 (and the baseline `lt: start` at 317)
- **Scenario**: The same spread is reconstructed inline to bound a query by `start`/`end`:
  ```ts
  ...(start || end ? { scannedAt: { ...(start ? { gte: start } : {}), ...(end ? { lte: end } : {}) } } : {})
  ```
  It appears for `scannedAt` in the trend query (line 279, with `trendStart`) and getOrgEngineMix (391), and for `createdAt` in getOrgRecsActioned (418). The getOrgMovers query (org-insights.ts:85) and the baseline `lt: start` (org-rollup.ts:317) are close variants of the same range math.
- **Root cause**: No shared builder for "optional gte/lte on a date column," so each query inlines the nested-spread idiom.
- **Impact**: A dense, easy-to-mistype expression duplicated across functions; half-open vs closed boundary semantics (the very thing the surrounding comments labor to keep consistent) are enforced by convention rather than a single helper.
- **Fix sketch**: Add `dateRange(start?: Date | null, end?: Date | null, field = "scannedAt")` to org-shared.ts (or window.ts) returning `{}` or `{ [field]: { gte?, lte? } }`, and spread its result at each site (passing `"createdAt"` for the recs query).

## 4. `{ sum, n }` accumulate-then-`Math.round(sum/n)` averaging duplicated instead of a shared streaming-mean helper
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/org-rollup.ts:256-268 (dimSum→dimAverages), 284-296 (byDay→trend); src/lib/db/org-teams.ts:171-176 + 199-205 (per-team dim averages)
- **Scenario**: The same group-into-`{sum,n}`-then-round pattern recurs:
  ```ts
  const entry = (map[key] = map[key] || { sum: 0, n: 0 });
  entry.sum += value; entry.n += 1;
  // …later…
  Math.round(entry.sum / entry.n)
  ```
  org-rollup builds it twice (per-dimension averages and per-day trend) and org-teams builds it once more for per-team dimension averages. org-shared already exposes `roundedMean(xs: number[])`, but it only accepts a materialized array, so these streaming accumulators reimplement the rounding by hand (org-insights.ts:797 does the array form: `Math.round(rows.reduce(...) / rows.length)`).
- **Root cause**: `roundedMean` covers the array case but not the "accumulate over a stream keyed by id" case, so each call site rolls its own `{sum,n}` averaging.
- **Impact**: The same numeric-averaging logic (and its rounding/empty handling) lives in 3-4 spots; a change to rounding policy or divide-by-zero handling won't propagate.
- **Fix sketch**: Add a tiny accumulator helper to org-shared.ts, e.g. a `MeanAccumulator`/`groupedMean(rows, keyFn, valueFn): Map<string, number>` that returns rounded means, and route the dimension/day/team aggregations through it (keeping `roundedMean` for the already-array cases).

## 5. `const mean = roundedMean` local alias collides with the genuinely-different exported `mean`
- **Severity**: Low
- **Category**: naming
- **File**: src/lib/db/org-signals.ts:45 (used at 55-60)
- **Scenario**: getOrgPrSignals does `const mean = roundedMean;` and then calls `mean(...)` for its rounded averages. But org-shared.ts exports two distinct functions: `mean` (true, *unrounded* arithmetic mean, org-shared.ts:35) and `roundedMean` (org-shared.ts:41). org-insights.ts:602-603 imports and uses the real unrounded `mean`, while org-rollup.ts and org-teams.ts alias the rounded one as `avg`. So within the same module family the identifier `mean` means two different things depending on file.
- **Root cause**: A convenience local alias reused the name of an existing, semantically-different shared export.
- **Impact**: A reader who knows `mean` is unrounded (and `roundedMean` is rounded) will mis-read org-signals' `mean(...)` calls as unrounded; the inconsistent `avg` (rollup/teams) vs `mean` (signals) alias for the same `roundedMean` adds friction.
- **Fix sketch**: Rename the local alias to match the rest of the family — `const avg = roundedMean;` — or drop the alias and call `roundedMean(...)` directly, reserving the name `mean` for the unrounded export.

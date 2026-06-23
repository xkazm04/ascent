# Code Refactor — Fleet Rollups & Insights
> Context group: Org Scanning & Fleet Rollups
> Total: 4 findings (Critical: 0, High: 1, Medium: 2, Low: 1)

This context is, on the whole, clean and well-factored: the `org-*.ts` family is consistently
sliced by responsibility, the barrel (`org.ts`) keeps the public surface explicit, and the dense
inline comments document the genuinely subtle period/baseline/cohort math. The findings below are the
high-value cleanups; there is no dead-misleading-code or actively-drifting duplicate-bug situation
here (no Critical). Several superficially-suspicious items were checked and cleared:
`CHAMPION_MIN_POP` (`components/org/champions.ts`), `resolveOrgWindow` (`lib/org/period.ts`),
`RepoState`/`getRepoStates`, `getOrgEngineMix`/`getOrgRecsActioned`, and the in-scope `daysUntil`
(`org-insights.ts`) are all genuinely referenced and were left alone. The cross-file `daysUntil` in
`LiveWarRoomHeader.tsx` is NOT a consolidation target — it has different semantics (string input,
nullable, time-of-day) and is a known open team decision ("canonical org tz"), so merging it would
not be behavior-preserving.

## 1. Dead exported function `getOrgContributors` (+ its `OrgContributor` type), fully superseded by `getContributorInsights`
- **Severity**: High
- **Category**: dead-code
- **File**: src/lib/db/org-contributors.ts:7-35 (function 16-35, interface 7-13)
- **Scenario**: `getOrgContributors` and the `OrgContributor` interface live at the top of the
  contributors module and are re-exported through both barrels (`org.ts:45-47`, `index.ts:111,148`),
  but nothing calls them. A repo-wide grep for `getOrgContributors(` finds only the definition; every
  actual consumer (the `/org/[slug]/contributors` page, `/api/org/export`, `lib/org/adoption.ts`, and
  the test suite) uses the richer sibling `getContributorInsights` in the same file. The only other
  hit is a passing mention in `docs/ENTERPRISE.md`, not a call site.
- **Root cause**: `getContributorInsights` (F5, "contributor intelligence") was added later and
  returns a strict superset of the data — its `contributors: ContributorInsight[]` already carries
  per-person `login/name/commits/aiCommits/repos` plus aiShare, champions, concentration. The simpler
  original aggregator was never removed once the richer one took over its callers.
- **Impact**: ~20 lines of dead query + an exported type that maintainers must reason about ("which
  contributor function do I call?"), a redundant Prisma `repoContributor.findMany`, and two stale
  barrel entries widening the public surface. It also invites a future caller to pick the impoverished
  function by mistake.
- **Fix sketch**: Delete the `OrgContributor` interface (7-13) and the `getOrgContributors` function
  (15-35) from `org-contributors.ts`. Remove `getOrgContributors` + `type OrgContributor` from the
  `export { … } from "@/lib/db/org-contributors"` block in `org.ts` (45,47) and from `index.ts`
  (111,148). No runtime callers to update; `getContributorInsights` stays. Optionally update the
  `ENTERPRISE.md` mention. Behavior-preserving (nothing consumes the removed surface).

## 2. The rounded-mean helper (`avg`/`mean`) is re-declared in every rollup module
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/org-rollup.ts:169,244 · src/lib/db/org-insights.ts:601-602 · src/lib/db/org-signals.ts:45 · src/lib/db/org-teams.ts:137
- **Scenario**: The same one-liner `const avg = (xs) => xs.length ? Math.round(xs.reduce((a,b)=>a+b,0)/xs.length) : 0`
  is hand-redeclared at least five times across the org-rollup family (twice within `org-rollup.ts`
  alone), plus a non-rounding `mean` variant in `org-insights.ts:601` and `org-signals.ts`. One copy
  (`org-rollup.ts:169`, inside `computeWindowDeltas`) deliberately omits the empty-array guard, so the
  copies have already drifted in a subtle, easy-to-miss way.
- **Root cause**: Each module was written to be self-contained, and a one-line averager felt too
  trivial to share — so it was retyped each time, and the guard slipped on one copy.
- **Impact**: Low individually, but it is the single most-repeated fragment in the context, and the
  drift (guarded vs. unguarded) is exactly the kind of inconsistency that becomes a divide-by-zero
  surprise when code is copy-pasted. Centralizing removes the ambiguity about which variant is canonical.
- **Fix sketch**: Add `roundedMean(xs: number[]): number` (the guarded form) and, if needed, a raw
  `mean(xs: number[]): number` to `org-shared.ts` (already the home for cross-module helpers like
  `segmentScope`/`isBot`). Replace the local `avg`/`mean` declarations in the five files with imports.
  Verify `computeWindowDeltas` (org-rollup.ts:169) keeps its behavior — it only calls `avg` after a
  non-empty guard, so the guarded shared helper is equivalent there. Pure refactor, behavior-preserving.

## 3. Champion selection is duplicated between `getContributorInsights` and `rollupTeams`
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/org-contributors.ts:121-140,170-173 · src/lib/db/org-teams.ts:208-222
- **Scenario**: Both functions take a human-only contributor list and derive "champions" with the same
  recipe: compute per-person `aiShare = round(aiCommits/commits*100)` (guarding `commits===0`), filter
  to `aiCommits > 0`, sort by an AI metric descending, and slice a top-N. `org-contributors.ts`
  produces `ContributorInsight[]` (champions sliced 6, ranked by `championScore`); `org-teams.ts`
  produces `TeamChampion[]` (sliced 3, ranked by `aiCommits`). The aiShare formula and the
  filter-sort-slice shape are byte-for-byte the same idea expressed twice, and both already pair it with
  the same bot-exclusion (`isBot`) merge loop.
- **Root cause**: The team rollup (C6) was built after contributor intelligence (F5) and re-implemented
  the same per-person AI aggregation inline rather than extracting the shared step, because the output
  shapes differ slightly (different slice size and sort key).
- **Impact**: Two places to keep in sync for "what counts as a champion / how aiShare is computed". A
  change to the aiShare rounding or the `aiCommits > 0` gate in one surface silently diverges from the
  other — and these feed user-visible "AI champion" badges that the product explicitly wants applied
  identically everywhere (see the `CHAMPION_MIN_POP` doc-comment).
- **Fix sketch**: Extract a small pure helper into `org-shared.ts`, e.g.
  `aiShareOf(commits, aiCommits)` and/or `pickChampions(people, { limit, by })`, where `people` is the
  common `{login,name,commits,aiCommits}` shape. Have both call sites compute aiShare and select
  champions through it, keeping their own `limit`/sort-key as params. Both functions already have unit
  coverage (`org-contributors.test.ts`, `teamRollup.test.ts`) to confirm the extraction is
  behavior-preserving.

## 4. `getOrgEngineMix` / `getOrgRecsActioned` bypass the `org.ts` barrel that every other rollup goes through
- **Severity**: Low
- **Category**: structure
- **File**: src/lib/db/org-rollup.ts:360-418 (consumed at src/lib/org/briefing.ts:14)
- **Scenario**: `org.ts` is documented as the barrel that keeps `@/lib/db/org`'s "exact public
  surface", and it re-exports the rollup family uniformly. But `getOrgEngineMix`, `getOrgRecsActioned`,
  and the `EngineMixEntry` type — all defined in `org-rollup.ts` alongside `getOrgRollup`, which IS
  barrelled — are absent from `org.ts`. Their sole consumer (`lib/org/briefing.ts:14`) reaches past the
  barrel with a deep import `from "@/lib/db/org-rollup"`, the only place in the context that does so.
- **Root cause**: These two aggregates (engine-mix / recs-actioned for the durable briefing) were added
  to `org-rollup.ts` after the barrel convention was set, and the author wired briefing.ts straight to
  the implementation file instead of extending the barrel.
- **Impact**: Cosmetic/organizational — an inconsistent import convention that erodes the barrel's
  "single public surface" guarantee and makes the briefing's dependency on the rollup module less
  discoverable. No correctness impact.
- **Fix sketch**: Add `getOrgEngineMix`, `getOrgRecsActioned`, and `type EngineMixEntry` to the
  `export { … } from "@/lib/db/org-rollup"` block in `org.ts` (and to `index.ts` if the briefing should
  consume them via `@/lib/db`), then change `briefing.ts:14` to import from `@/lib/db/org` (or
  `@/lib/db`). Pure re-routing of an import path; behavior-preserving.

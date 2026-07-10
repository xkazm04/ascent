# Code Refactor — Repositories & Segments
> Total: 5 | Critical: 0 High: 2 Medium: 2 Low: 1

## 1. A-vs-B comparison UI duplicated wholesale between the Segments and Tech-stacks pages
- **Severity**: High
- **Category**: duplication
- **File**: src/app/org/[slug]/segments/page.tsx:12-57,118-178 ; src/app/org/[slug]/tech-stacks/page.tsx:14,85-145,150-161
- **Scenario**: Both pages render the same comparison surface over the same `SegmentComparison` shape: a 4-`Tile` headline grid (A / B / Overall Δ / Adopt-Rigor Δ), a "Headline metrics" `Card` with three `MetricRow`s, and a "By dimension" `Card` mapping `comparison.dimDeltas` into meter rows. The `MetricRow` component (the 12-line `function MetricRow({ label, a, b })` block) is byte-for-byte identical in the two files, as is the `first(v)` searchParam helper and the `aId/bId` (resp. `aKey/bKey`) URL-resolution preamble.
- **Root cause**: The tech-stacks page was created by copying the segments page ("Mirrors the Segments comparison page" — its own header comment) and deliberately reuses the *data* layer (`buildSegmentComparison`, `SegmentSummary`/`SegmentComparison`) but not the *render* layer, so ~55 lines of JSX plus the `MetricRow` helper were cloned instead of shared.
- **Impact**: Any tweak to the comparison layout, color logic, empty-state copy, or accessibility must be made in two places and silently drifts otherwise; the cloned `MetricRow`/`first`/preamble are pure dead-weight duplication. Two near-identical files also inflate the bundle and the review surface.
- **Fix sketch**: Extract a shared `<SegmentComparisonView comparison={...} />` (plus the `MetricRow` sub-component) into `src/components/org/` and a shared `first()`/`resolveAB()` helper; both pages then pass their already-built `SegmentComparison` and the noun ("segment"/"stack") for the empty-state text. Removes the cloned `MetricRow` and the ~55-line block from one page.

## 2. Local `resolveOrgId` re-implemented in segments.ts instead of the canonical `getOrgId`
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/segments.ts:34-37 (6 call sites: 42,117,153,180,283) ; src/lib/db/tech-groups.ts:68,93
- **Scenario**: `segments.ts` defines a private `async function resolveOrgId(slug)` that does `getPrisma().organization.findUnique({ where: { slug }, select: { id: true } })` and is called from six functions. The sibling `tech-groups.ts` inlines the exact same lookup twice. Meanwhile `src/lib/db/org-rollup.ts` exports the canonical `getOrgId(slug)` (re-exported through `@/lib/db` and already used by members.ts, invites.ts, scans-audit.ts, org.ts, webhook), which does the identical lookup plus an `isDbConfigured()` guard and slug canonicalization (`slug.trim().toLowerCase()`).
- **Root cause**: The org-resolution preamble was copied per-module rather than imported from the one canonical resolver — exactly the "privately-drifting copy" the `getOrgId` doc comment warns against. (`plan.ts:41` carries a third identical private copy; this is a repo-wide theme, but segments.ts + tech-groups.ts are the in-scope instances.)
- **Impact**: Maintenance/confusion — five seams in this context resolve orgs through a hand-rolled copy that, unlike the canonical resolver, skips trim/lowercase normalization, so the family drifts from every other org lookup. Dead duplication of a trivially-importable helper.
- **Fix sketch**: Delete the private `resolveOrgId` in segments.ts and replace its 6 call sites with `getOrgId` from `@/lib/db/org-rollup` (or `@/lib/db`); replace the two inline `organization.findUnique({where:{slug}})` lookups in tech-groups.ts the same way. Confirm segments.test.ts's `slugToId` fake still resolves (it mocks `organization.findUnique`, which `getOrgId` also calls).

## 3. `isDbConfigured()` → 503 "Segments require a database." guard duplicated across all 4 segment routes
- **Severity**: Medium
- **Category**: duplication
- **File**: src/app/api/org/segments/route.ts:14,33 ; src/app/api/org/segments/[id]/route.ts:15 ; src/app/api/org/segments/[id]/repos/route.ts:13 ; src/app/api/org/segments/[id]/repos/bulk/route.ts:16
- **Scenario**: Five handler entry points open with the identical line `if (!isDbConfigured()) return NextResponse.json({ error: "Segments require a database." }, { status: 503 });`. The string, status, and shape are copied verbatim in each.
- **Root cause**: Each route handler re-states the persistence guard inline; there is no shared "segments require DB" gate (the `[id]/route.ts` `gate()` helper wraps it but the other three routes do not reuse it).
- **Impact**: A change to the message or status (or adding a request-id/log) must touch five spots; a typo in one makes the family inconsistent. Low-risk but pure copy-paste.
- **Fix sketch**: Add a tiny shared helper, e.g. `segmentsDbGuard(): NextResponse | null` (returns the 503 or null) in `src/lib/db` or a route-local util, and call it as the first line of each handler — or fold it into `requireOrgAccess`/`requireOrgRead` callers. The existing `gate()` in `[id]/route.ts` can delegate to the same helper.

## 4. `summarizeSegment` and `summarizeTechStack` are near-identical rollup-to-summary reducers
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/segments.ts:255-269 ; src/lib/db/tech-groups.ts:111-128
- **Scenario**: Both private functions call `getOrgRollup(...)` for a scope, return `null` on a null rollup, then build a `SegmentSummary` by copying the same eight fields (`repoCount, scannedCount, avgOverall, avgAdoption, avgRigor`, `posture: postureFor(rollup.avgAdoption, rollup.avgRigor).id`, `dimAverages`) and a whole-fleet fallback name. They differ only in which scope arg they pass to `getOrgRollup` (segmentId vs techGroupId) and how `id`/`name` are sourced.
- **Root cause**: tech-groups.ts cloned the segments reducer when adding stack comparison (it already shares `buildSegmentComparison` and the `SegmentSummary` type from segments.ts, but not this reducer).
- **Impact**: The mapping of a rollup into a summary now lives in two files; a new headline field (or a posture-derivation change) has to be mirrored or the two comparisons silently diverge.
- **Fix sketch**: Export a shared `rollupToSummary(rollup, { id, name }): SegmentSummary` (from segments.ts or org-rollup.ts) that owns the 8-field map + `postureFor`; both `summarizeSegment` and `summarizeTechStack` shrink to "resolve scope → `getOrgRollup` → `rollupToSummary`".

## 5. Raw-fallback posture label (`POSTURE_LABEL[x] ?? x`) inlined across the comparison pages
- **Severity**: Low
- **Category**: duplication
- **File**: src/app/org/[slug]/segments/page.tsx:17 (used 27,128,129) ; src/app/org/[slug]/tech-stacks/page.tsx:68,95,96
- **Scenario**: The segments page defines `const postureText = (posture) => POSTURE_LABEL[posture] ?? posture;` and uses it three times; the tech-stacks page repeats the same `POSTURE_LABEL[s.posture] ?? s.posture` expression inline three times. A shared `postureLabel()` already exists in `components/org/ui.tsx` but title-cases unknown ids, so these pages deliberately hand-roll the raw `?? posture` variant instead.
- **Root cause**: The shared helper has a different fallback than these pages want, so each page re-implements the raw-id fallback rather than the shared util offering it.
- **Impact**: Minor — four-plus inline copies of the same lookup-or-raw expression; if posture rendering ever needs to change for these pages, it must be edited in several spots.
- **Fix sketch**: Add a single exported helper next to `postureLabel` (e.g. `posturePlain(id)` returning `POSTURE_LABEL[id] ?? id`, with the intent documented), import it in both pages, and drop the local `postureText` plus the three inline copies.

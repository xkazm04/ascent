# Code Refactor — Scan Persistence & History
> Total: 4 | Critical: 0 High: 1 Medium: 2 Low: 1

## 1. Org-resolve → repo-findUnique → null-guard boilerplate repeated across 6 read functions
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/scans-read.ts:88-99, 114-122, 222-230, 384-389, 550-555, 661-671
- **Scenario**: Six exported read functions (`getHeadHint`, `getRepoPassport`, `getRepositoryHistory`, `getScanComparison`, `getLatestRecommendations`, `getScanReportByCommit`) each open with the identical 4-line skeleton:
  ```ts
  const orgId = await resolveOrgId(orgSlug);
  if (!orgId) return null;
  const repo = await prisma.repository.findUnique({ where: { orgId_fullName: { orgId, fullName } }, ... });
  if (!repo) return null;
  ```
  Two of them (`getRepositoryHistory:230`, `getScanReportByCommit:671`) then repeat the same cross-tenant guard `if (orgSlug === DEFAULT_ORG_SLUG && repo.isPrivate) return null;` (a write-side variant also lives in scans-persist.ts:82).
- **Root cause**: Each query was written independently; the org→repo lookup (the single most security-sensitive step, since `fullName` is only unique *within* an org) was never extracted, so the tenant-scoping contract is re-stated by hand six times.
- **Impact**: ~24 lines of churned boilerplate; any change to the scoping rule (e.g. tightening the private-repo guard, adding a `dbReadSafe` wrapper — which only 2 of the 6 currently use) must be applied in six places, and a missed one silently becomes a cross-tenant leak or an inconsistency. Hard to see at a glance which readers enforce the private guard.
- **Fix sketch**: Add a private helper in scans-read.ts (or scans-shared.ts), e.g. `resolveScopedRepo(prisma, orgSlug, owner, name, args, { guardPrivate })`, that resolves the org, runs the `orgId_fullName` findUnique with the caller's `select`/`include`, applies the optional private-org guard, and returns `repo | null`. Each reader collapses to one call.

## 2. Inline Prisma `select` shapes duplicated across read queries
- **Severity**: Medium
- **Category**: duplication
- **File**: src/lib/db/scans-read.ts:241, 395, 496, 565 (dim-score select); 123-127 & 673-677 (latest-scan-optionally-pinned)
- **Scenario**: The per-dimension trend projection `dimensions: { select: { dimId: true, score: true } }` is hand-written four times (`getRepositoryHistory`, `getScanComparison`, `getPublicScanGallery`, `getLatestRecommendations`). Separately, the "latest scan, optionally pinned to a commit" query skeleton `where: { repoId, ...(headSha ? { headSha } : {}) }, orderBy: { scannedAt: "desc" }` is duplicated verbatim between `getRepoPassport:123` and `getScanReportByCommit:673` (and recurs in spirit in `findScanByCommit`, `getLatestRecommendations`, and scans-persist.ts's `previous`/dedup reads).
- **Root cause**: The module already proves the pattern works — `HISTORY_POINT_SELECT` (line 159) and `historyPointFrom` (line 172) were factored out — but the dimension-score sub-select and the latest-scan filter never got the same treatment.
- **Impact**: A schema/column rename to `ScanDimension` or a change to the "latest" ordering tiebreaker must be chased across 4-6 call sites; drift here produces subtly different result sets between endpoints.
- **Fix sketch**: Export a `DIM_SCORE_SELECT = { dimId: true, score: true } as const` and spread it (mirroring `HISTORY_POINT_SELECT`). Add a small `latestScanWhere(repoId, headSha?)` (or a `findLatestScan(prisma, repoId, headSha, { select })` helper) for the optionally-pinned newest-scan lookup.

## 3. Persisted-JSON parsing helpers fragmented across two files and partly re-implemented
- **Severity**: Medium
- **Category**: structure
- **File**: src/lib/db/scans-shared.ts:197-205 (`parseStringArray`); src/lib/db/scans-read.ts:599-643 (`parseJson`, `parseJsonObject`, `parseNumberArray`, `parseDiscrepancies`)
- **Scenario**: The family of "parse a persisted JSON column safely" helpers is split: `parseStringArray` lives in scans-shared.ts while `parseJson`/`parseJsonObject`/`parseNumberArray`/`parseDiscrepancies` are private to scans-read.ts. `parseJsonObject` and `parseNumberArray` correctly delegate to the `parseJson` primitive, but `parseDiscrepancies` (632) and `parseStringArray` (197) each re-implement their own `try { JSON.parse(s) } catch { ... }` block instead of building on `parseJson`.
- **Root cause**: `parseStringArray` was hoisted into scans-shared.ts as "the dependency sink" (its own comment) so both modules could share it, but the rest of the parser family stayed behind in scans-read.ts, so the set is half-centralized and the two oldest parsers still hand-roll the try/catch.
- **Impact**: Two implementations of the same JSON.parse-with-fallback idiom can drift in edge handling (the exact bug `parseStringArray`'s comment says it was created to prevent); the family is harder to find and test as a unit.
- **Fix sketch**: Co-locate all persisted-column parsers in one module (extend scans-shared.ts, or a new `scans-json.ts`), and rewrite `parseDiscrepancies` and `parseStringArray` on top of `parseJson<unknown>()` so the raw try/catch exists exactly once.

## 4. `getScanReportByCommit` roadmap mapping re-implements part of `toPersistedRec`
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/scans-read.ts:693-701 vs src/lib/db/scans-shared.ts:212-238
- **Scenario**: `scans-shared.toPersistedRec` is the canonical Recommendation-row→object mapper (used by `getLatestRecommendations` and `updateRecommendation`). `getScanReportByCommit` instead maps recommendation rows inline to `LlmRoadmapItem`, hand-repeating the same field handling: `dimId as DimensionId`, `impact as Impact`, `effort as Effort`, `explore` via `parseStringArray`, `levelUnlock ?? undefined`.
- **Root cause**: The two readers target different output shapes (`PersistedRecommendation` vs `LlmRoadmapItem`), so the row-parsing logic was copied rather than shared — the "row↔report mapper partially re-implemented at call sites" theme.
- **Impact**: Minor; the per-field cast/parse logic for a recommendation row exists in two spots, so a change to how `explore` or `levelUnlock` is decoded must be made twice.
- **Fix sketch**: Extract a tiny shared `decodeRecRow(r)` that returns the common parsed core (`{ dimension, impact, effort, explore, levelUnlock }`) and have both `toPersistedRec` and the `getScanReportByCommit` roadmap map spread it, each adding its shape-specific fields.

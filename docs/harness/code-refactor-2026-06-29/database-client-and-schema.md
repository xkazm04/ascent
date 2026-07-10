# Code Refactor — Database Client & Schema
> Total: 4 | Critical: 0 High: 2 Medium: 1 Low: 1

## 1. Org-slug → id resolution is duplicated across the whole db layer (3 private `resolveOrgId` + ~30 inline lookups), despite a canonical resolver existing
- **Severity**: High
- **Category**: duplication
- **File**: src/lib/db/segments.ts:34-37, src/lib/db/plan.ts:41-44, src/lib/db/scans-shared.ts:183-189, src/lib/db/org-rollup.ts:34-39 (canonical `getOrgId`), plus ~30 inline sites (credits.ts, branding.ts, org-alerts.ts, org-gate.ts, org-llm.ts, org-skills.ts, playbooks.ts, passport-overrides.ts, tech-groups.ts, org-watch.ts, org-rollup.ts, usage.ts, org-teams.ts, org-signals.ts, org-insights.ts, org-contributors.ts)
- **Scenario**: Three modules each define a byte-for-byte identical private resolver:
  ```ts
  async function resolveOrgId(slug: string): Promise<string | null> {
    const org = await getPrisma().organization.findUnique({ where: { slug }, select: { id: true } });
    return org?.id ?? null;
  }
  ```
  (`segments.ts:34`, `plan.ts:41`, and the exported copy in `scans-shared.ts:183`). On top of that, the exact lookup `organization.findUnique({ where: { slug... }, select: { id: true } })` is inlined ~30 more times across the layer. Meanwhile `org-rollup.ts:34` already defines an exported `getOrgId(slug)` whose own doc-comment says it exists "so members.ts / invites.ts share this one resolver instead of each maintaining a privately-drifting copy."
- **Root cause**: Each new db module reimplemented org-id resolution instead of importing the shared one. The canonical `getOrgId` was introduced but never adopted by the sibling modules.
- **Impact**: ~35 copies of one lookup. They have already drifted: `getOrgId` normalizes the slug (`slug.trim().toLowerCase()`) and guards `isDbConfigured()`; the three `resolveOrgId` copies and most inline sites do neither, while a scattered subset call `.toLowerCase()` ad-hoc (credits.ts:157/248/276, org-alerts.ts:27/56, org-gate.ts:26, org-watch.ts:255). A future change to the canonical lookup (extra select column, a new normalization rule, an index hint) must be hand-applied in dozens of places.
- **Fix sketch**: Promote one resolver to the single source of truth (the normalizing/guarded `getOrgId`, or a new `scans-shared` export since that file is already the cross-group dependency sink). Delete the private `resolveOrgId` in `segments.ts` and `plan.ts` and the duplicate in `scans-shared.ts`; have all of them re-use the canonical one. Replace the ~30 inline `organization.findUnique({where:{slug},select:{id:true}})` lookups that only need the id with calls to that helper, settling the slug-casing question once (so `.toLowerCase()` is applied consistently, not per-call). Leave the genuinely-different lookups (`ensureOrgId` create-or-get, and the ones selecting more than `id` such as credits.ts:189 / org-contributors.ts:51) as-is.

## 2. `db/index.ts` barrel re-exports ~78 of 252 symbols that no module imports through the barrel
- **Severity**: High
- **Category**: dead-code
- **File**: src/lib/db/index.ts:1-264
- **Scenario**: A repo-wide scan of every `import { … } from "@/lib/db"` shows 78 of the barrel's 252 re-exported names are never imported via the barrel. They are still reachable (and actually used) only through their direct module paths, e.g. `getPrisma`, `reconnectDb`, `dbHealthCheck`, `isAuthExpiryError`, `dbReadSafe` are imported everywhere as `@/lib/db/client`, and `getSessionVersion`/`bumpSessionVersion` only as `@/lib/db/sessions`. The cleanest example is the retention block (lines 47-57): of its 9 re-exports only `purgeExpiredData` is imported via the barrel (`src/app/api/cron/purge/route.ts:10`); the other 8 (`envRetentionDefaults`, `resolveRetention`, `clampBatchSize`, `PURGE_ACTION`, `RETENTION_DEFAULT_BATCH_SIZE`, `RetentionPolicy`, `OrgPurgeResult`, `PurgeSummary`) are referenced only inside `retention.ts` itself and its test — never through `@/lib/db`. Other dead-via-barrel clusters: `client` 6/11, `sessions` 2/2 (line 100), the `org` block 24/71, `scans` 11/31, `segments` 4/16.
- **Root cause**: The barrel was grown to mirror each module's full public surface "just in case," but consumers settled on importing from the specific module file. The retention wave already noted this pattern; it persists module-wide.
- **Impact**: A 264-line export list that overstates the real public API ~2:1. Every added/removed symbol forces an edit here for re-exports nobody consumes; the noise hides which surfaces are genuinely shared, and it inflates what a `@/lib/db` import appears to pull in.
- **Fix sketch**: Trim the barrel to the names actually imported via `@/lib/db`. Start with the safe, fully-verified blocks: drop the 8 unused retention re-exports (keep only `purgeExpiredData`) and the entire `sessions` line (both consumers use `@/lib/db/sessions` directly). Then prune the per-module dead names confirmed by the import scan. Each removal is safe because every symbol remains exported from its own module for the direct importers. (Tests under `src/lib/db/*.test.ts` import from their direct module files, not the barrel, so they are unaffected.)

## 3. Triple-nested db barrels (`index.ts` → `org.ts` → `org-*.ts`) keep two hand-maintained, already-drifting org export lists
- **Severity**: Medium
- **Category**: structure
- **File**: src/lib/db/index.ts:101-173, src/lib/db/org.ts:1-100
- **Scenario**: `org.ts` is itself a pure barrel re-exporting ~50 names from eight `org-*.ts` sub-modules (org-watch, org-rollup, org-alerts, org-gate, org-contributors, org-signals, org-insights, org-teams). `index.ts` then re-re-exports a *different, curated* ~71-name subset from `@/lib/db/org`. The two lists already diverge: `org.ts` exports `getOrgEngineMix`, `getOrgRecsActioned`, and `type EngineMixEntry` that `index.ts` does not forward, while `index.ts:129` forwards `getOrgId` (which physically lives in `org-rollup.ts`, two hops away).
- **Root cause**: A second barrel layer was added for the org domain, but the top barrel kept its own parallel export list instead of `export * from "@/lib/db/org"`.
- **Impact**: Adding one org function means editing up to three files (the sub-module, `org.ts`, and `index.ts`) and reasoning about which subset each barrel exposes. The drift means callers can't rely on `@/lib/db` and `@/lib/db/org` having the same org surface, which defeats the point of a barrel.
- **Fix sketch**: Pick one re-export path. Either collapse `index.ts`'s 70-line org block to `export * from "@/lib/db/org"` (single maintained list, fixes the drift), or have feature code import org helpers from `@/lib/db/org` directly and drop the org re-exports from the top barrel entirely. Combine with finding #2's pruning so the surviving list reflects real consumers.

## 4. The `__ascentPgliteAdapter` global is typed ad-hoc in two files instead of a shared type
- **Severity**: Low
- **Category**: duplication
- **File**: src/lib/db/client.ts:323-330, src/lib/db/pglite-boot.ts:13
- **Scenario**: Both files independently re-declare the same global slot via a local `globalThis as unknown as { … }` cast. `client.ts` types `__ascentPgliteAdapter?: unknown` (alongside `__ascentPrisma` / `__ascentPrismaRefresh`), and `pglite-boot.ts` separately types `{ __ascentPgliteAdapter?: unknown }`. The two casts are the producer (`pglite-boot` sets it) and the consumer (`client.newClient` reads it) of one global key, with no shared declaration tying them together.
- **Root cause**: The PGlite global was added in two places without a central `globalThis` augmentation.
- **Impact**: Minor — the contract of the shared global lives in two casts that can silently disagree (e.g. if one is later narrowed to a real adapter type). No runtime cost.
- **Fix sketch**: Declare the Ascent globals once (a `declare global { var __ascentPgliteAdapter: unknown; … }` augmentation, or an exported `AscentGlobals` type the two files share) and reference it from both `client.ts` and `pglite-boot.ts`.

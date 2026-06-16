# Data Retention & Purge — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 2, Medium: 2, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 5

Scope files: `src/lib/db/retention.ts`, `src/app/api/cron/purge/route.ts`.
Supporting reads (to trace the delete graph and ranking inputs): `prisma/schema.prisma`,
`src/lib/db/scans-audit.ts`, `src/lib/db/scans-persist.ts`, `src/lib/public-scan-quota.ts`.
Both in-scope files are pure backend (a route handler returning JSON + a DB module) — no JSX
renders, so the ui-perfectionist lens has nothing to flag. All 5 findings are bug-hunter.

The cron auth surface is already hardened: the route fails CLOSED when `CRON_SECRET` is unset
(route.ts:18-23) and accepts only `Bearer <secret>` or `?key=<secret>` (route.ts:26). That is
correct and matches how Vercel Cron injects the bearer — no finding there.

---

## 1. RecommendationEvent rows are never deleted — every purge leaves permanent FK orphans
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: Partial delete / dangling FK orphans
- **File**: src/lib/db/retention.ts:137-142
- **Scenario**: An org sets `retentionMaxScans = 10`. A repo with 200 scans is purged down to
  10. Each pruned Recommendation had a `RecommendationEvent` timeline (status changes,
  re-assignments, due-date edits — written in `scans-recommendations.ts:104`). The purge deletes
  `ScanDimension` and `Recommendation` (lines 139-141) but never touches `RecommendationEvent`.
- **Root cause**: `pruneRepoScans` only deletes two of the three child tables of the Scan graph.
  Under `relationMode = "prisma"` (schema.prisma:22) Postgres emits NO FK cascade, so deleting a
  `Recommendation` does not remove its `RecommendationEvent` children. A repo-wide grep confirms
  `recommendationEvent.deleteMany` / `.delete` exists nowhere in `src/`. The comment at line 138
  ("Children first … no FK cascade") proves the author knew cascades don't fire, yet missed that
  `Recommendation` is itself a parent.
- **Impact**: Permanent, unbounded accumulation of orphaned `RecommendationEvent` rows pointing
  at `recommendationId`s that no longer exist. This defeats the entire purpose of the module
  (bounding storage / compliance), is invisible (no error, counts look correct), and grows fastest
  exactly on the heavily-scanned repos the policy targets. Any future join from these orphans
  resolves to nothing; the table the purge is supposed to bound silently leaks forever.
- **Fix sketch**: In the per-batch loop, before deleting recommendations, fetch the rec ids for the
  stale scans (or use `recommendation.findMany({ where:{ scanId:{ in: ids } }, select:{ id:true } })`)
  and `recommendationEvent.deleteMany({ where: { recommendationId: { in: recIds } } })` first, then
  delete recommendations, then dimensions, then the scan — grandchildren → children → parent.

## 2. Stale per-row delete loop runs outside a transaction — a timeout mid-graph corrupts scans
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Partial delete / non-atomic destructive op
- **File**: src/lib/db/retention.ts:137-142
- **Scenario**: A repo has tens of thousands of stale scans. The purge has `maxDuration = 300`
  (route.ts:14). Mid-batch, after `scanDimension.deleteMany` and `recommendation.deleteMany`
  succeed but before `scan.deleteMany` commits, the function hits the 300s wall (or the Lambda is
  killed, or an unretryable error throws). The three deletes are three independent
  auto-committed statements — there is no `$transaction` around them (contrast `scans-persist.ts:164`
  which DOES wrap its writes).
- **Root cause**: Each `deleteMany` is its own committed write inside `withRetry`. The "children
  first, then parent" ordering means an interruption leaves the parent `Scan` row alive with zero
  dimensions and zero recommendations.
- **Impact**: A surviving `Scan` with no `ScanDimension` rows is a corrupt record that still
  appears in every dashboard/trend/rollup query (they read `scans … orderBy scannedAt desc take 1`,
  e.g. `org-insights.ts`, `org-rollup.ts`) and now renders with empty dimensions / broken charts.
  Because the loop deletes oldest-first within `stale`, a re-run won't re-target these (they're past
  `skip: max` only if newer scans exist) — the corruption can persist. Destructive partial state is
  the worst failure mode for a purge job.
- **Fix sketch**: Wrap each batch's three deletes (parent + both/all children) in a single
  `prisma.$transaction([...])` so a batch is all-or-nothing, OR delete the parent `Scan` FIRST
  within a txn. Keep batches small (already `batchSize`) so each txn stays inside DSQL limits.

## 3. Scan "newest N" ranking trusts report-supplied `scannedAt` — can delete live newer scans
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: Over-deletion / wrong window boundary
- **File**: src/lib/db/retention.ts:127-132
- **Scenario**: `pruneRepoScans` decides which scans to KEEP via
  `orderBy: [{ scannedAt: "desc" }, { id: "desc" }], skip: max` — everything after the newest
  `max` by `scannedAt` is deleted. But `Scan.scannedAt` is written from `new Date(report.scannedAt)`
  (`scans-persist.ts:190`), a value carried in the scan report, NOT a DB-authoritative `now()`. If
  a runner has clock skew, a backfill/import sets a historical `scannedAt`, or a re-scan reuses an
  older commit's timestamp, then the genuinely most-recent scan can rank LOW and fall past
  `skip: max`.
- **Root cause**: Retention ranks "recency" on a field the application controls and that is not
  guaranteed monotonic or unique per repo, instead of an insertion-authoritative field (`createdAt`,
  which IS `@default(now())` at schema.prisma:298, or the row id).
- **Impact**: Over-deletion of the wrong rows — the live, current scan a user is looking at can be
  purged while a stale one is kept, because their `scannedAt` ordering was inverted relative to true
  insertion order. Silent loss of the authoritative latest scan for a repo. Highest blast radius on
  any org that backfills history or runs scanners across machines with imperfect clocks.
- **Fix sketch**: Rank by an insertion-authoritative key for retention: `orderBy: [{ createdAt:
  "desc" }, { id: "desc" }]` (keep `id` as the tiebreak). Reserve `scannedAt` for user-facing
  "as-of" display, not for deciding what to destroy.

## 4. Purge's own compliance audit entries get purged by the next run's window
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Retention boundary / self-erasing audit trail
- **File**: src/lib/db/retention.ts:225-242, 259-264
- **Scenario**: An org sets `retentionAuditDays = 7`. Each purge writes a `retention.purged`
  audit entry (line 232) describing what it deleted. Seven days later the NEXT purge run computes
  `cutoff = now - 7d` and `pruneAudit({ orgId, at: { lt: cutoff } })` (line 227) deletes that
  prior `retention.purged` entry along with everything else past the window. The orphan-scope
  entry (line 264, written with `orgId: null`) is likewise swept by the `orgId: null` orphan
  sweep (line 262) on the next run.
- **Root cause**: The `retention.purged` audit entries are stored in the very `AuditLog` table the
  same policy prunes by age, with no carve-out. The comment at line 231 ("survives this run's audit
  cutoff") is true only for the current run — it does not survive subsequent runs.
- **Impact**: For short audit windows the compliance trail of what was deleted is itself deleted,
  defeating the stated "compliance trace of what was removed" purpose (line 230). An operator
  auditing "what did the purge remove last month" finds the evidence gone on any org with
  `auditDays` shorter than the lookback.
- **Fix sketch**: Exclude the purge's own action from age-based pruning, e.g.
  `pruneAudit({ orgId, at: { lt: cutoff }, NOT: { action: PURGE_ACTION } })`, or give
  `retention.purged` (and `scan.created`) a separate, longer retention floor.

## 5. Orphan audit sweep gated on the GLOBAL default — disabled per-org policy can't bound org-less rows
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: Retention gap / unbounded growth on a delete path
- **File**: src/lib/db/retention.ts:259-262
- **Scenario**: A deployment configures retention purely per-org (each enterprise org sets its own
  `retentionAuditDays`) and leaves `RETENTION_AUDIT_DAYS` env unset, so `defaults.auditDays === 0`
  (envRetentionDefaults, line 61). The orphan sweep is guarded by `if (defaults.auditDays > 0)`
  (line 259). With the default at 0 it NEVER runs, so org-less `AuditLog` rows
  (`orgId: null` — anonymous public scans, the orphan-scope purge entries themselves) are never
  pruned.
- **Root cause**: Org-less audit rows have no per-org policy to inherit (line 257 comment), and the
  only mechanism that can prune them is tied exclusively to the GLOBAL env default — which an
  all-per-org configuration legitimately leaves at 0 ("unlimited").
- **Impact**: The `AuditLog` table grows unbounded from the public-scan path on exactly the
  configuration the module documents as supported (per-org overrides, env default = inherit/keep).
  This is the storage-cost liability the module exists to prevent (file header, lines 3-6), still
  present on a plausible config. Lower severity than the destructive bugs (it leaks rather than
  destroys), but it silently negates retention for a whole row class.
- **Fix sketch**: Give org-less audit a floor independent of the env default — e.g. a separate
  `RETENTION_ORPHAN_AUDIT_DAYS` (defaulting to a sane bound like 90d), or sweep `orgId: null`
  under `max(defaults.auditDays, ORPHAN_FLOOR)` so an all-per-org deployment still bounds them.

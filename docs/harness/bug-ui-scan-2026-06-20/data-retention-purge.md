> Total: 3 findings (0 critical, 0 high, 2 medium, 1 low)

# Data Retention & Purge — combined bug+ui scan

## 1. Unbounded stale-scan selection defeats the module's own DSQL batching design
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource-exhaustion / DSQL-safety
- **File**: src/lib/db/retention.ts:129
- **Scenario**: An org enables `maxScansPerRepo` (e.g. 10) on a repo that has accumulated a very large scan history (tens of thousands of rows — entirely plausible for a long-watched repo on a per-commit scan cadence). `pruneRepoScans` runs one `prisma.scan.findMany({ where:{repoId}, orderBy:[…], skip: max, select:{id:true} })` with **no `take`**, pulling every stale id into a single in-memory array before the (correctly) batched delete loop even starts.
- **Root cause**: The deletes were hardened into small retry-on-conflict batches to bound the DSQL OCC-conflict/memory surface (see the module header and the per-batch `$transaction`), but the *selection* that feeds those batches was not — it is a single unbounded read. The design assumption that "small batches bound the conflict surface" silently excludes the one big read that precedes them.
- **Impact**: On a large backlog the selecting `findMany` itself can hit a DSQL statement timeout or pressure serverless memory, so the purge for that repo throws — caught per-org and surfaced in `errors`, but that repo (and any later repo in the same org) never gets pruned, so the table the job exists to bound keeps growing. No data loss, but the safety job quietly stops doing its job on exactly the repos that need it most.
- **Fix sketch**: Page the selection too: loop `findMany({ where:{repoId}, orderBy:[{createdAt:"desc"},{id:"desc"}], skip: max, take: batchSize, select:{id:true} })`, deleting each page's sub-graph in its transaction, until a page returns `< batchSize`. (Keep `skip: max` constant — each iteration re-skips the kept newest `max`, and since the prior batch's rows are now deleted the window naturally advances; or skip `max` once then page by a moving cursor on `createdAt,id`.)

## 2. Compliance self-audit failure is silently ignored — purge reports success with no audit trail
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure / compliance
- **File**: src/lib/db/retention.ts:258-269 (and 292)
- **Scenario**: The per-org deletes succeed, then `recordAudit(PURGE_ACTION, …)` fails to write (transient DB error, signing path throw). `recordAudit` swallows its own error and returns `false` (see src/lib/db/scans-audit.ts:38-47); `purgeExpiredData` ignores that boolean, pushes a success `OrgPurgeResult`, and the route returns a clean 200 summary with an empty `errors` array.
- **Root cause**: The module's stated guarantee is "the purge job records its own audit entry (compliance trace of what was removed)" and "the job audits itself", but the call is fire-and-as-if-forget: the return value is never checked and a failed audit is not added to `summary.errors`. The destructive action and its compliance record are decoupled, with the record being the silently-droppable half.
- **Impact**: For an audit/compliance product, scans/recommendations/audit rows get permanently deleted with no surviving `retention.purged` trace and no signal anywhere that the trace is missing — exactly the "what was deleted and when" record a compliance review would later demand. Operators see green.
- **Fix sketch**: Check the boolean: `const ok = await recordAudit(...); if (!ok) errors.push(\`${org.slug}: retention audit write failed\`)` (and the same for the orphan-scope audit at line 292). The deletes can stand, but the lost compliance trace must surface in `errors` so the run is visibly degraded.

## 3. No internal time budget against `maxDuration=300` — a large fleet run is killed mid-purge with no summary
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: partial-failure / operability
- **File**: src/app/api/cron/purge/route.ts:14, src/lib/db/retention.ts:228
- **Scenario**: A fleet with many orgs × many repos, each paging batched deletes, runs past the 300s Vercel function limit. The platform kills the invocation partway through the org loop. Because each batch commits independently, the work done so far persists (safe, idempotent — next run continues), but the route returns a platform timeout, not the partial `PurgeSummary`, and there is no marker of how far it got.
- **Root cause**: `purgeExpiredData` has no elapsed-time guard and no resumption ordering; it assumes the whole fleet fits inside one `maxDuration` window. The per-batch commit makes interruption *safe* but not *observable* — there's no "stopped early, resume from org X" signal.
- **Impact**: On a slow/large run, retention silently makes only partial progress each day and an operator can't tell a timed-out run from a failed one; the later orgs in the iteration order are perpetually deprioritized if the run always dies before reaching them. No data loss / no over-deletion.
- **Fix sketch**: Track a `deadline = Date.now() + budgetMs` (e.g. 270s, under `maxDuration`); break the org loop when exceeded and return the partial summary with a `truncated: true` flag (or randomize/rotate org iteration order so the same tail isn't always starved). Surfacing partial completion lets the next cron tick reliably finish the remainder.

<!-- UI Perfectionist lens: this context has no retention-config UI in scope (manifest lists only retention.ts, retention.test.ts, and the cron route — all backend/data). No UI findings. -->

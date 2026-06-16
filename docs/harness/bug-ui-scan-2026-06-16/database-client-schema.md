# Database Client & Schema — bug-hunter + ui-perfectionist scan
> Total: 5 (Critical: 1, High: 2, Medium: 2, Low: 0)
> Lens split: bug-hunter 5 / ui-perfectionist 0
> Files read: 7

Files read: `src/lib/db/client.ts`, `src/lib/db/index.ts`, `prisma/schema.prisma`, `prisma/init.sql`, plus three cross-reference reads to confirm impact (`src/lib/db/init-sql.test.ts`, `src/lib/db/scans-persist.ts`, `src/lib/db/scans-read.ts`, `src/lib/db/org-rollup.ts`).

## 1. DSQL-only cold start builds a Prisma client with no datasource URL — synchronous seed client is dead until the async token refresh lands
- **Severity**: Critical
- **Lens**: bug-hunter
- **Category**: Prisma client wiring / DSQL cold start
- **File**: src/lib/db/client.ts:296-327 (specifically the seed at 314)
- **Scenario**: Production runs in pure DSQL mode the way the module's own docs describe it: `DSQL_ENDPOINT` set, IAM-token auth, and **no static `DATABASE_URL`** (there is no long-lived password to put in one). On a cold serverless invocation `getPrisma()` is called synchronously by the first query (e.g. `findScanByCommit`, `resolveOrgId`) *before* the background `refresh(cfg)` mint has completed.
- **Root cause**: The cold-start guard at line 298 is `if (!cfg && !process.env.DATABASE_URL) throw`. When `cfg` is truthy (DSQL) it is skipped even if `DATABASE_URL` is unset. Line 314 then does `newClient(process.env.DATABASE_URL)` → `newClient(undefined)` → `new PrismaClient({ log })` with **no `datasourceUrl`**. Prisma then falls back to the datasource block in `schema.prisma:19-23`, which is hard-wired to `url = env("DATABASE_URL")` with no `directUrl`/DSQL fallback. With `DATABASE_URL` unset, that client cannot resolve a connection string and throws (`PrismaClientInitializationError`) on first use.
- **Impact**: Every request that touches the DB on a freshly-thawed instance races the async mint and, if it loses (the common case — minting an IAM token does a network round-trip), 500s with "Environment variable not found: DATABASE_URL". The comment at 311-319 explicitly assumes a deploy-time `DATABASE_URL` seed token exists ("we seed from DATABASE_URL if present"), but nothing enforces it and the pure-IAM deployment the file is written for has none.
- **Fix sketch**: When `cfg && !process.env.DATABASE_URL`, make the cold path *await* a token mint before returning a usable client (or have `withDb`/`getPrisma`'s callers go through an async accessor on cold start). Minimally, build the seed client from `buildDsqlUrl(cfg, await mintDsqlToken(cfg))` rather than `undefined`, or document+validate that `DATABASE_URL` is mandatory even in DSQL mode and fail fast at boot with a clear message.

## 2. init.sql ↔ schema.prisma parity test does not check indexes, so a future migration can silently ship an unindexed bootstrap
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: schema/init.sql drift / missing-index guard
- **File**: prisma/init.sql:340-536 vs src/lib/db/init-sql.test.ts:24-52
- **Scenario**: The header of `init.sql` (lines 7-9) claims parity is *enforced* by `init-sql.test.ts`. It is not — the test only asserts `CREATE TABLE "<Model>"` exists for every model, an exact table-set match, two specific columns, and the seed. It never asserts that the `@@index`/`@@unique` declarations in `schema.prisma` have a matching `CREATE INDEX` in `init.sql`. The current files happen to be in sync (39+ index declarations ↔ 50 `CREATE INDEX`), but nothing prevents the next schema change from adding an `@@index` and forgetting the SQL.
- **Root cause**: The parity guard's scope is tables/columns only; `relationMode = "prisma"` means there are **no FK constraints and indexes are the only thing making relation lookups fast** (schema comment, lines 4-6). An index omission in the psql-bootstrapped database is invisible — every query still works, just with sequential scans.
- **Impact**: A `psql -f init.sql` bootstrap (the documented local/self-host path) can build a database missing a hot-path index — e.g. a future `Scan` or `Recommendation` index — and the org dashboard / dedup lookups degrade to full-table scans with no error. This is exactly the class of "the 2026-06 drift left … two columns behind" regression the test was written to stop, but for indexes.
- **Fix sketch**: Extend `init-sql.test.ts` to parse every `@@index([...])`/`@@unique([...])` from `schema.prisma` (Prisma's index-name convention is deterministic: `Table_col1_col2_idx` / `_key`) and assert a matching `CREATE INDEX` line in `init.sql`. Fail the suite on any missing one.

## 3. Fleet-wide org rollup filters Scan by `scannedAt` through a repo relation with no supporting index
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: missing index on hot query path
- **File**: src/lib/db/org-rollup.ts:220-227 and 256-260 (against schema `Scan` indexes at prisma/schema.prisma:304-306)
- **Scenario**: `getOrgRollup` runs `prisma.scan.findMany({ where: { repo: { orgId }, scannedAt: { gte/lte } } })` across the **entire org's scan history** (trend line at 220, baseline at 256) on every dashboard load. Under `relationMode="prisma"` the `repo: { orgId }` relation filter is executed as a separate query producing the org's repoIds, then `Scan` is filtered by `repoId IN (...) AND scannedAt <op> ...`.
- **Root cause**: `Scan` is indexed on `@@index([repoId])`, `@@index([repoId, scannedAt])`, `@@index([repoId, headSha])` — all *leading on a single repoId*. A multi-repo `repoId IN (...)` range scan over `scannedAt` cannot use the composite index efficiently for the org-wide case, and there is no index leading on `scannedAt`. For a large org (hundreds of repos × many scans) this is a wide scan on every rollup, recomputed for the trend and again for the baseline.
- **Impact**: Org dashboard latency grows with total fleet scan count, not with the window. On DSQL (remote, OCC) a slow wide read also widens the window for serialization conflicts on concurrent writes to the same rows.
- **Fix sketch**: Add `@@index([scannedAt])` (or denormalize `orgId` onto `Scan` and add `@@index([orgId, scannedAt])`, mirroring how `PlaybookApplication` denormalizes `orgId`). Then mirror the new index into `init.sql`. Denormalizing `orgId` is the stronger fix because it removes the relation-filter subquery entirely.

## 4. `findScanByScannedAt` dedup relies on exact-equality `scannedAt` matching with millisecond precision — silent duplicate Scan rows for sha-less reports
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dedup correctness / nullable-column query semantics
- **File**: src/lib/db/scans-read.ts:51-60 (used by scans-persist.ts:137-140)
- **Scenario**: For a report with no resolvable `headSha`, the persist path dedups by matching `Scan.scannedAt` exactly (`where: { repoId, scannedAt }`). The comment claims "the SAME computed report persisted more than once carries an identical timestamp." But `report.scannedAt` is converted with `new Date(report.scannedAt)` and stored as `TIMESTAMP(3)` (ms precision). If the upstream `scannedAt` is generated per-attempt (e.g. `Date.now()` at persist time rather than pinned in the report) or carries sub-ms / serialization differences, two coalesced retries will NOT match and both insert.
- **Root cause**: Equality dedup on a high-precision timestamp is fragile, and there is no unique constraint to backstop it (no `@@unique([repoId, scannedAt])` or `@@unique([repoId, headSha])` in the `Scan` model). The sha-based dedup at scans-persist.ts:127 has the same lack of a DB-level guard — it relies entirely on the app-layer `findScanByCommit` read-then-write under a *process-local* `withRepoLock`, which does not protect against a second serverless instance.
- **Impact**: Cross-instance concurrent scans (two warm Lambdas persisting the same unchanged commit) can each pass the dedup read and both insert a Scan row → duplicate scans inflate history/trends and, for metered private scans, risk a double credit debit. The lock comment at scans-persist.ts:119-122 acknowledges it is "process-local + best-effort."
- **Fix sketch**: Add a partial unique constraint to make dedup authoritative at the DB: `@@unique([repoId, headSha])` for sha-bearing scans (and treat the resulting P2002 as "deduped"), accepting that DSQL has no native partial-unique — so alternatively gate on a deterministic, content-derived scan key. At minimum, stop deduping sha-less reports on raw `scannedAt` equality and pin a stable idempotency key into the report.

## 5. `dbHealthCheck` reports `ok:false` (not "disabled") in DSQL-only mode and its non-auth failure path never self-heals a dead connection
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: dbHealthCheck correctness
- **File**: src/lib/db/client.ts:407-428 (with isDbConfigured at 285-287)
- **Scenario**: `dbHealthCheck` pings `SELECT 1` and only reconnects when `isAuthExpiryError(err)` is true. In DSQL-only mode the cold-start client may have been built with no datasource URL (finding #1), so the very first ping throws a *Prisma initialization* error, not an auth-expiry one. `isAuthExpiryError` returns false for that, so the health check returns `{ ok:false, reconnected:false }` and **never** triggers a reconnect that would mint a token and build a working client — defeating the "self-heal without a redeploy" purpose stated at lines 402-406.
- **Root cause**: The recovery branch keys solely on `isAuthExpiryError`. A genuinely dead/uninitialized client (missing URL, transient connection-refused right after a token swap) is treated as a hard failure even though a single `reconnectDb()` would fix it.
- **Impact**: A keep-warm/monitoring endpoint that is supposed to recover an expired or uninitialized DSQL client instead flatlines as unhealthy until the process is recycled — the exact 2 AM-outage scenario the module's header (lines 4-8) says it was built to prevent. Also, a healthcheck on a DSQL deployment whose seed client never initialized reports a misleading hard error rather than attempting the recovery it advertises.
- **Fix sketch**: Broaden the self-heal trigger to also reconnect on a Prisma-initialization / connection error (or simply attempt one `reconnectDb()` + re-ping on *any* first failure before declaring `ok:false`), and have `dbHealthCheck` distinguish "persistence disabled" from "configured but failing" so the monitoring endpoint can alert correctly.

> Total: 5 findings (0 critical, 2 high, 3 medium, 0 low)

# Database Client & Schema — combined bug+ui scan

## 1. DSQL cold-start seeds a possibly-expired token and synchronous reads can't self-heal it
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: dsql-token-expiry / read-path recovery
- **File**: src/lib/db/client.ts:391 (cold-start seed) + the ~140 raw `getPrisma()` call sites it feeds
- **Scenario**: A serverless instance cold-starts (or thaws) in DSQL mode. `getPrisma()` (line 391) seeds a client from the deploy-time `DATABASE_URL` IAM token, marks it `expiresAt: 0`, and kicks an async background refresh — but returns the seed client *immediately*. The deploy-time token has a ~15-min TTL, so on an instance that boots well after deploy (Vercel keeps the same `DATABASE_URL` env for the whole deployment), that seed token is already expired. The very first query — if it goes through a raw `getPrisma().<model>` read (every read module: scans-read, org-rollup, org-insights, members, plan, segments, …) rather than `withDb()` — throws an auth-expiry `28P01`/`P1010` before the background mint lands, and the raw read path has no reconnect-and-retry. The page/route 500s.
- **Root cause**: `withDb()`/`runWithReconnect` is the only path with reactive token recovery, and it is applied only to writes. The synchronous `getPrisma()` accessor (by design it can't `await` a mint) hands back a client whose seed token may be dead, and `isDbUnavailableError`/`dbReadSafe` deliberately do NOT treat an auth-expiry as "degrade to fallback" (it re-throws). So a stale seed token on a read is an uncaught 500, not a graceful no-data render.
- **Impact**: Intermittent 500s on dashboard/report reads after a cold start on DSQL, self-clearing only once the async refresh swaps the client — i.e. the classic "first request after idle fails." Worst at low traffic (instances idle past the TTL between requests).
- **Fix sketch**: Route read modules through a read-oriented wrapper that, like `withDb`, retries once via `reconnectDb()` on `isAuthExpiryError` (a `withDbRead` that on auth-expiry reconnects, on `isDbUnavailableError` degrades to a fallback). Minimally, make `getPrisma()`'s DSQL cold-start path do a blocking first mint when no live client exists (the cost is one cold request, not a 500).

## 2. PrismaClient is constructed with no connection limit → serverless connection storm against DSQL
- **Severity**: High
- **Lens**: bug-hunter
- **Category**: connection-pool / serverless scale
- **File**: src/lib/db/client.ts:307 (`newClient`) and :71 (`buildDsqlUrl`)
- **Scenario**: Under fan-out load — a fleet/org scan (`mapPool`), a cron rescan batch, or just many concurrent dashboard viewers — Vercel spins up N lambda instances. Each builds its own `PrismaClient` with Prisma's default internal pool (`num_physical_cpus * 2 + 1` connections), and `buildDsqlUrl` sets only `sslmode` — no `connection_limit`, no `pool_timeout`. N instances × default pool can blow past DSQL's per-cluster connection ceiling, at which point new connections are refused and queries fail.
- **Root cause**: The client factory targets correctness of the *token*, not the *connection budget*. The datasource URL is built without the serverless-appropriate `connection_limit=1..2` (or an external pooler / RDS Proxy-equivalent in front of DSQL). DSQL's lock-free OCC model assumes many short transactions, which only amplifies connection churn.
- **Impact**: Connection-exhaustion failures (and elevated p99) precisely when the product is doing its most valuable work (fleet scans). Hard to reproduce in dev (one local Postgres, one instance) and invisible until prod scale — the highest-risk class of bug for this codebase.
- **Fix sketch**: Append `connection_limit=2&pool_timeout=10` (tunable via env) in `buildDsqlUrl` and for the static `DATABASE_URL` seed; document/provision a connection pooler for DSQL. Add a `DB_CONNECTION_LIMIT` env knob so prod can dial it per the cluster ceiling and expected concurrency.

## 3. init.sql drift guard checks tables and indexes but not columns — a renamed/dropped column drifts silently
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: schema/init.sql drift
- **File**: src/lib/db/init-sql.test.ts:24-133 (and prisma/init.sql vs prisma/schema.prisma)
- **Scenario**: The file's own header says the 2026-06 drift "left six tables and two columns behind." The test now enforces table-level and index/unique parity generically, but column parity is asserted for only a hand-picked few (`scanCredits`, `githubLogin`, `alertWebhookUrl`, `externalId`). Add a new column to a model in `schema.prisma` (e.g. another additive-nullable on `Organization` or `Scan`) and forget to add it to `init.sql`, and every test stays green — the documented psql bootstrap then builds a table missing that column. Reads of the missing column 500 (or, as the header notes for the prior drift, read a missing credit column as "out of credits").
- **Root cause**: The parity test was hardened for tables and indexes but the column dimension — the exact dimension that caused the original incident — is still spot-checked, not enumerated. So the guard gives false confidence against the very drift it was written to catch.
- **Impact**: Silent schema/bootstrap divergence reaching anyone who provisions via `psql -f init.sql` (local Docker, self-host). Wrong data or 500s, with a green test suite.
- **Fix sketch**: Parse each model's scalar fields from `schema.prisma` and assert each appears as a `"<col>"` inside the matching `CREATE TABLE` block in `init.sql` (mapping `@map` names), the mirror of the existing generic index check. Tolerate the known JSON→JSONB and type formatting, but require column *presence* per model.

## 4. PGlite dev bootstrap gates on one table existing → schema changes are never applied to an existing data dir
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: local-dev schema drift
- **File**: src/lib/db/pglite-boot.ts:26-32
- **Scenario**: The embedded PGlite boot runs `init.sql` only when `to_regclass('public."Organization"')` is null (DB empty). Once a dev has booted once, the `Organization` table exists, so on every later boot `hasSchema` is true and `init.sql` is skipped. After the dev pulls a branch that adds a new table or column to `schema.prisma`/`init.sql`, the existing `PGLITE_DATA_DIR` is never re-bootstrapped — the new table/column simply isn't there, and the next query against it throws "relation does not exist" with no hint that the cause is a stale local DB.
- **Root cause**: The "bootstrap once" probe keys on a single sentinel table, which conflates "empty DB" with "up-to-date DB." `init.sql` uses bare `CREATE TABLE` (not `IF NOT EXISTS`), so the gate can't simply always-run; there is no migration/versioning of the embedded schema.
- **Impact**: Dev-only, but a recurring time-sink — confusing "relation/column does not exist" errors after any schema change until the dev manually wipes the PGlite dir. Erodes trust in the offline-DB story.
- **Fix sketch**: Stamp a schema fingerprint (hash of `init.sql`) into a tiny meta table/row on bootstrap; on boot, if the stored fingerprint differs, log a loud "PGlite schema is stale — delete $dir to re-bootstrap" warning (or, if `init.sql` is converted to `IF NOT EXISTS` + idempotent, re-exec it). At minimum document the wipe step in the boot log.

## 5. relationMode="prisma" emits no FKs, so a deleted org/repo silently orphans child rows on every write path except the org-id cache
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: relationMode / silent orphaning
- **File**: prisma/schema.prisma:22 (`relationMode = "prisma"`) — affects every child model (Scan, ScanDimension, Recommendation, RepoSegment, RepoContributor, RepoTeam, CreditLedger, AuditLog, …)
- **Scenario**: `relationMode="prisma"` means NO database FK constraints. The org-id resolution layer (`scans-shared.ensureOrgId`) was hardened to re-verify its cached org id every 5 min so a purged org can't keep routing writes at a dangling id. But that protection covers only the *org-id cache path*. A `repoId`/`scanId` captured at the start of a longer operation, or any write that targets a child of a row another path concurrently deletes (retention purge runs `/api/cron/purge` while a scan persists), inserts a child row pointing at a now-nonexistent parent with NO database error — a silent orphan. Reads that assume the parent exists then under-count or 500 on a later join-by-id at the Prisma layer.
- **Root cause**: With FKs disabled, referential integrity is purely an app-layer convention, and only the org-slug→id hop re-verifies. Other id caches / in-flight ids are trusted for the duration of the operation, and there is no `ON DELETE` cascade — deletes must manually fan out (the schema comments note Prisma-layer cascade is the contract, but it isn't enforced on concurrent interleavings).
- **Impact**: Orphaned `Scan`/`Recommendation`/ledger rows after a purge-vs-write race; skewed rollups, an audit/credit ledger that references vanished scans, and no constraint error to surface it. Data-integrity erosion that compounds silently.
- **Fix sketch**: For the highest-value parents (org, repo, scan), do the child write and a parent existence check inside one `withRetry`'d transaction (re-read the parent by PK in-txn before inserting children), and order the purge to delete children before parents / take a per-repo lock that the persist path also respects. Longer-term, add the cross-row invariants the purge job and persist path must agree on to a shared module so the "delete order vs insert" contract is explicit.

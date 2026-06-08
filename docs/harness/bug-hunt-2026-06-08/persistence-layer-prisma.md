# Bug Hunter — Persistence Layer (Prisma / Aurora DSQL) (ascent)

> Total: 7 findings (Critical: 2, High: 3, Medium: 2, Low: 0)
> Files read: 8
> Scope: src/lib/db/(client|index|scans), prisma/schema

## 1. The DSQL token-expiry reactive-reconnect path (`withDb`) is dead code — no query actually uses it
- **Severity**: Critical
- **Category**: functionality
- **File**: src/lib/db/client.ts:368-377 (withDb), src/lib/db/scans.ts:291, 563, 763, etc.
- **Scenario**: Deploy to Aurora DSQL. Every persistence helper calls `getPrisma()` directly (`persistScanReport` L291, `getRepositoryHistory` L563, `getScanComparison` L763, `getPublicScanGallery`, `getLatestRecommendations`, `recordAudit` L46, `getAuditLog`…). `withDb()` — the only entry point that wires `runWithReconnect` to reconnect-on-auth-expiry — is exported but called by **nothing** in `src/` (grep confirms only definitions/comments). So the "reactively reconnect on an auth-expiry error" guarantee in the module header never runs for real queries; only `dbHealthCheck` self-heals.
- **Root cause**: The self-healing reconnect was built and unit-tested in isolation but never adopted by the call sites; the header comment documents a behavior the production path does not have.
- **Impact**: crash / failed writes — an expired-token error inside `getPrisma()`-based code (which is all of it) bubbles straight up as a 500 with the scan unsaved; recovery depends entirely on the proactive background refresh firing in time (see #2/#3).
- **Fix sketch**: Route the real query helpers through `withDb((db) => …)` instead of `getPrisma()`, or make `getPrisma()` itself synchronously block on a stale-token refresh so no caller can hold an about-to-expire client.

## 2. Proactive token refresh is fire-and-forget; the caller keeps running on the stale client it already holds
- **Severity**: Critical
- **Category**: functionality
- **File**: src/lib/db/client.ts:296-322 (getPrisma), 257-279 (doRefresh/refresh)
- **Scenario**: On DSQL, `getPrisma()` returns the **current** client synchronously and only `void refresh(cfg)` in the background when the token is within its margin. A request that calls `getPrisma()` at the moment the token is already past `expiresAt` (e.g. the box was idle/frozen for >15min on a serverless instance, then thawed) gets the **old, expired-token client**, runs its query against it, and fails — the background refresh swaps in a fresh client only for the *next* call. The just-thawed lambda's first DB op after token expiry always fails.
- **Root cause**: `tokenIsStale` triggers a background mint but `getPrisma()` does not await it; the synchronous contract means the calling request never benefits from the refresh it kicked off, and there is no reactive retry on this path (see #1).
- **Impact**: failed writes / crash — first query after any idle period longer than the token TTL on a warm-but-frozen instance 500s with no data saved; especially likely on Vercel where lambdas are paused between invocations and wall-clock can jump past `expiresAt`.
- **Fix sketch**: When `tokenIsStale` AND past hard expiry, `await refresh(cfg)` before returning (only the proactive-margin window should be background); or drive every read/write through `withDb` so the auth-expiry retry actually executes.

## 3. `persistScanReport`'s long interactive transaction can outlive the IAM token mid-write
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/scans.ts:374-498 (timeout 20_000, maxWait 10_000), client.ts:281-283
- **Scenario**: The scan transaction allows `maxWait: 10s` to acquire a connection + `timeout: 20s` to run (up to 50 contributor round-trips over a remote DSQL link). `refreshMarginSeconds` default is only 120s. If `getPrisma()` is called when the token has ~100s left (inside margin, but background refresh hasn't completed) the tx can start on the *old* client and still be running when the token actually expires ~100s later. A token expiry **inside** an open transaction is not retryable by `withRetry` (it only catches serialization conflicts, not auth errors) and not recoverable by reconnect (the tx is bound to the dead connection) — the whole scan rolls back.
- **Root cause**: Token lifetime (900s) and refresh margin (120s) are not reconciled against the worst-case transaction duration; a connection borrowed near token end can outlive it.
- **Impact**: data loss (scan rolls back, surfaced as a throw the route swallows — see #6) under perfectly normal load near token boundaries.
- **Fix sketch**: Refuse to start a long tx on a client whose remaining TTL < tx timeout (force a refresh first), or shrink the transaction (batch contributor upserts via `createMany`/`skipDuplicates`) so it can't approach the token lifetime.

## 4. Serialization-conflict retry re-runs the *entire* transaction body, but the per-scan dedup read sits inside `withRepoLock` and not inside `withRetry`'s retried closure — duplicate scans on cross-instance OCC conflict
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/scans.ts:347-512
- **Scenario**: `withRepoLock(repo.id, () => withRetry(async () => { …dedup; …$transaction… }))`. The lock is **process-local** (L237-262, "cross-instance races still fall back to commit-SHA dedup"). Two instances (A on a cron lambda, B on a user request) scan the same repo at the same new commit concurrently. Both pass the dedup check (`findScanByCommit` returns null — neither scan committed yet), both enter `$transaction` and both `scan.create`. On DSQL there is no unique constraint on `(repoId, headSha)` (it's only an `@@index`, schema L220), so neither commit conflicts — **both succeed**, producing two Scan rows for the same commit. The "dedup catches an identical commit" guarantee only holds same-instance.
- **Root cause**: Dedup relies on a read-then-insert with no DB-level uniqueness; `withRepoLock` closes only the same-process window, and there is no `@@unique([repoId, headSha])` to make the loser fail (which `withRetry`/`upsertRacing` could then absorb).
- **Impact**: inconsistent rows / double usage-based billing — the very thing `deduped` was meant to prevent (a "second metered Scan row" per the doc comment) happens across instances; history/trend charts double-count the commit.
- **Fix sketch**: Add `@@unique([repoId, headSha])` (partial, where headSha not null) and route the scan insert through `upsertRacing` so a cross-instance duplicate loses with P2002 and re-reads instead of inserting.

## 5. Serverless connection-pool storm — lazy Prisma singleton + per-instance pool, no `connection_limit`, cron fans out 4× concurrent 20s transactions
- **Severity**: High
- **Category**: functionality
- **File**: src/lib/db/client.ts:250-255 (newClient), src/lib/pool.ts:37 (SCAN_CONCURRENCY=4), scans.ts:497
- **Scenario**: No `connection_limit`/`pool_timeout` is set anywhere (grep: zero hits) and `newClient` passes no pooling datasource params, so each lambda's PrismaClient opens Prisma's default pool (num_cpus*2+1). Under a traffic spike, N warm Vercel lambdas × that default = N pools all holding direct DSQL/Postgres connections; the cron rescan additionally runs `SCAN_CONCURRENCY=4` lanes, each opening a 20s-timeout transaction (`maxWait: 10_000`) — 4 long-held connections per cron instance. On plain Postgres (`max_connections` ~100) a handful of warm instances exhausts the server; new connections are refused and every persist/read 500s.
- **Root cause**: Classic serverless+Prisma+Postgres anti-pattern with no pooler (no PgBouncer/`pgbouncer=true`, no `connection_limit=1` for lambdas) and an unbounded per-instance pool multiplied across instances.
- **Impact**: connection exhaustion — cascading 500s across all DB-backed routes under load, exactly when the product is being demoed/scaled.
- **Fix sketch**: Set `connection_limit=1` (or a small cap) in the lambda datasource URL and front Postgres with a pooler; cap total cross-lane connections for the cron path.

## 6. Route swallows the persistence throw, returns 200 with the report — user believes the scan was saved when it was rolled back
- **Severity**: Medium
- **Category**: functionality
- **File**: src/app/api/scan/route.ts:89-111 (and cron/rescan, org/import, webhook callers)
- **Scenario**: `persistScanReport` is now atomic — a partial failure throws and rolls the whole scan back (scans.ts L283-285). The caller wraps it in `try { … } catch (err) { console.error("[scan] persistence failed", err); }` and then **returns the report as a normal 200** with `x-ascent-dedup: miss`. To the user the scan succeeded and the report rendered; nothing was persisted. Later "history" / permalink reads return empty (treated as "no data," not "save failed"). The legacy `failures.{audit,contributors}` warning branch is now effectively dead (the doc says failures are surfaced as a throw, not in the struct), so the only signal is a server log nobody sees.
- **Root cause**: The persistence layer correctly converts partial failure into an all-or-nothing throw, but the call sites still treat persistence as best-effort and don't propagate the failure to the response or to retry logic.
- **Impact**: silent no-op / data loss from the user's perspective — "I scanned it but the trend chart is empty."
- **Fix sketch**: On a persistence throw for a non-anonymous/tracked scan, surface a degraded indicator in the response (e.g. `x-ascent-persisted: false`) or 5xx the tracked path so the cron/UI can retry, instead of returning a clean 200.

## 7. `updateRecommendation` writes a best-effort audit row OUTSIDE the transaction — timeline and audit can disagree, and a missing-id check is a separate read (TOCTOU)
- **Severity**: Medium
- **Category**: functionality
- **File**: src/lib/db/scans.ts:1204-1265
- **Scenario**: The row update + its `RecommendationEvent` rows commit in one `$transaction` (L1252-1256, good), but `recordAudit("recommendation.updated", …)` runs **after** the tx (L1260) with no transaction and only logs on failure (recordAudit returns false but the caller ignores it). So a committed status change can have a durable timeline event yet no audit entry — the audit viewer underreports backlog activity. Separately, the existence check `findUnique` (L1212) then `update` (L1253) is a TOCTOU: a concurrent delete (retention purge) between them makes the `update` throw P2025 anyway, but the carefully-synthesized P2025 path (L1213-1219) is bypassed — fine — while a concurrent *create-after-check* is not the risk here; the real gap is the un-awaited-for-correctness audit.
- **Root cause**: Audit is intentionally "best-effort" and outside the tx, so it can't share the mutation's atomicity the way `persistScanReport`'s scan-audit does.
- **Impact**: inconsistent/orphaned rows — audit trail silently misses recommendation mutations (a compliance gap for the audit product), with only a console.error.
- **Fix sketch**: Move the `recordAudit` insert into the same `$transaction` (as `persistScanReport` already does for `scan.created`), or fail the operation when the audit write fails for audit-critical actions.

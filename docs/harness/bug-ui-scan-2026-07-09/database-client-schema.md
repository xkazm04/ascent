# Database Client & Schema — bug-hunter + ui-perfectionist scan

> Context: Database Client & Schema (group: Data & Persistence)
> Files scanned: 9
> Total: 7 findings (Critical: 0, High: 0, Medium: 6, Low: 1)

Note on the WIP: `schema.prisma` and `init.sql` both gained `OrgMemory` + `OrgDecision`.
A mechanical parity check (37 models) confirms **no table- or column-level drift** between the
two files, and the new tables use the Prisma typed client, so their `updatedAt DEFAULT
CURRENT_TIMESTAMP` in init.sql is harmless. The WIP itself is clean; the findings below are
latent issues in the surrounding client/schema machinery.

## 1. DSQL token-mint retries in a tight loop with zero backoff during an STS/cold-start outage
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: retry-storm
- **File**: src/lib/db/client.ts:489
- **Scenario**: DSQL mode, IAM/STS is throttling or down (or the signer package is unresolvable). A cold-start client is seeded `expiresAt: 0` (client.ts:489), so `tokenIsStale()` is permanently true. Under steady traffic every `getPrisma()`/`withDb` call re-kicks `refresh()`; `refresh()` clears the single-flight handle the instant a mint settles (client.ts:430-432), so the next request immediately launches another mint — back-to-back, forever, with no delay.
- **Root cause**: The single-flight collapses *concurrent* mints but adds no backoff *between* sequential failures; the stale-now seed guarantees every call attempts a refresh.
- **Impact**: A throttled token minter gets hammered continuously, prolonging its own outage and burning CPU/log volume — the classic retry storm that turns a transient IAM blip into a sustained one.
- **Fix sketch**: Record `lastRefreshFailedAt` and skip re-kicking within a small cooldown (e.g. exponential, capped at ~10s); or reuse `withRetry`'s full-jitter schedule for the background mint path.

## 2. reconnectDb (static mode) eagerly $disconnects the shared client, aborting concurrent in-flight queries
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: race-condition
- **File**: src/lib/db/client.ts:509
- **Scenario**: `/api/health` calls `dbHealthCheck()` (route.ts:37), which self-heals on ANY first-ping failure by calling `reconnectDb()`. In static/local mode reconnectDb rebuilds the client and immediately runs `void previous.$disconnect()` (client.ts:509) on the process-wide singleton — while other concurrent requests are mid-`await` on that same client instance.
- **Root cause**: Asymmetry: the DSQL rotation path defers teardown via `retireClient()` (300s grace, client.ts:401-406) precisely because "$disconnect() tears down the query engine/pool without a documented guarantee of draining in-flight work" — but reconnectDb's static branch disconnects eagerly.
- **Impact**: A single flaky monitoring ping can abort live users' queries (500s) by yanking the pool out from under them.
- **Fix sketch**: Route the static branch's old-client teardown through `retireClient(previous)` too, instead of an eager `$disconnect()`.

## 3. withDb — the documented "production DSQL entry point" — silently omits OCC serialization-conflict retry
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/client.ts:542
- **Scenario**: A developer reads withDb's docstring ("Run a database operation with token-expiry protection… The recommended entry point for production DSQL queries", client.ts:537-541), sees it explicitly names DSQL, and wraps a new write in `withDb(...)` alone. On Aurora DSQL any concurrent write can lose the OCC commit with 40001/P2034/OC### — which `runWithReconnect` (client.ts:520-535) does NOT catch (auth-expiry only).
- **Root cause**: The module splits two DSQL concerns (`withDb` = auth-expiry, `withRetry` = OCC) but the entry point's name/doc imply full DSQL coverage; callers must remember to compose BOTH (existing writers do — scans-persist.ts — but nothing enforces it).
- **Impact**: A future write through withDb alone fails on the exact conflict the module documents as expected under DSQL concurrency — dropped persists, no retry.
- **Fix sketch**: Either wrap the op in `withRetry` inside `withDb`, or amend the docstring to state loudly that OCC retry is the caller's responsibility and cross-link `withRetry`.

## 4. init.sql parity test guards tables + indexes but only 4 hardcoded columns — the very drift it exists to stop
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: schema-drift-guard-gap
- **File**: src/lib/db/init-sql.test.ts:33
- **Scenario**: A future column is added to a model in schema.prisma but forgotten in init.sql. The suite checks every table name and every index name generically, but columns only via four hardcoded assertions — `scanCredits`, `githubLogin` (init-sql.test.ts:34-35), `alertWebhookUrl`, `externalId`. Any other missing column stays green.
- **Root cause**: The test's own header says the 2026-06 drift left "six tables and **two columns** behind", yet no generic per-model column-parity loop was added (only tables + indexes got one).
- **Impact**: A `psql -f init.sql` bootstrap (and every fresh PGlite dev DB) can silently lack a column, 500-ing the feature that reads it — the exact failure class the guard was written to prevent.
- **Fix sketch**: Add a loop mirroring the index-parity test: for each model's scalar fields assert a matching `"col"` line inside that table's `CREATE TABLE` block (I ran this check ad-hoc — currently 0 drift, so it would pass today and lock parity going forward).

## 5. pglite-boot silently degrades to no-DB and can't apply new columns to an existing dev DB
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: silent-failure
- **File**: src/lib/db/pglite-boot.ts:49
- **Scenario**: (a) A column added to init.sql never reaches an existing local `.pglite` dir — the boot rewrites `CREATE TABLE` → `CREATE TABLE IF NOT EXISTS` (pglite-boot.ts:35), which skips the existing table, so the next query throws "column does not exist" with nothing pointing at the cause (acknowledged in the comment, cured only by a manual wipe or a hand-written `ALTER … ADD COLUMN IF NOT EXISTS` as done for Scan). (b) If any single statement in the exec fails, the one `catch` (pglite-boot.ts:49-51) swallows it, leaves `__ascentPgliteAdapter` unset, and the app runs as a confusing no-DB build behind a lone `console.error`.
- **Root cause**: "CREATE TABLE IF NOT EXISTS" is not column-idempotent, and whole-file `exec` has no per-statement isolation or a hard-fail signal.
- **Impact**: Local dev renders plausible-but-empty / erroring pages after a schema change, wasting debugging time on a phantom bug.
- **Fix sketch**: Diff-driven column reconciliation (or generate `ALTER TABLE … ADD COLUMN IF NOT EXISTS` for every column), and surface a boot failure louder than a swallowed console.error (e.g. set a `__ascentPgliteBootError` flag health can read).

## 6. Token rotation with a 300s retire-grace transiently doubles live connections, defeating the connection budget
- **Severity**: Medium
- **Lens**: bug-hunter
- **Category**: resource-exhaustion
- **File**: src/lib/db/client.ts:390
- **Scenario**: DSQL rotates every `ttl - margin` (default 780s), building a fresh PrismaClient each time (doRefresh, client.ts:411) and retiring the old one only after `RETIRE_CLIENT_GRACE_MS` = 300s (client.ts:390). For ~300s of every 780s cycle BOTH clients exist, each holding up to `connection_limit` connections — so per instance the live connection count is up to 2× the configured `DB_CONNECTION_LIMIT` (client.ts:80-90).
- **Root cause**: The budget knob was sized to keep N instances under DSQL's per-cluster ceiling, but the rotate-with-grace lifecycle isn't accounted for — the cap is per-client, not per-instance.
- **Impact**: Under fan-out with a tight limit, rotation windows can still breach the ceiling the budget was meant to protect, causing intermittent connection refusals right after each token refresh.
- **Fix sketch**: Document that effective per-instance cap is 2×limit during grace (halve the configured value), or drain the old pool faster once the new client is confirmed healthy, or cap the old client's pool to 1 before retiring.

## 7. DSQL cold-thaw with an expired seed token 500s direct getPrisma() callers not wrapped in withDb/dbReadSafe
- **Severity**: Low
- **Lens**: bug-hunter
- **Category**: recovery-gap
- **File**: src/lib/db/client.ts:483
- **Scenario**: A frozen serverless instance thaws past the deploy-time seed token's TTL. `getPrisma()` builds a client from the (now-expired) `DATABASE_URL` seed (client.ts:483) and kicks a background refresh, but returns the seed client synchronously. A caller that uses the raw client directly — e.g. `getPrisma().orgMemory.update(...)` (org-memory.ts:338), credits.ts, scans-shared.ts — issues its first query on the expired token before the async mint lands and gets an unhandled auth-expiry error.
- **Root cause**: Only `withDb`/`dbReadSafe` carry the reactive reconnect; the seed client can be handed out already-expired, and not every call site funnels through those wrappers.
- **Impact**: Sporadic 500s on the first query after a cold thaw for the (many) direct-getPrisma read/write paths; self-corrects once the background refresh completes.
- **Fix sketch**: Have `getPrisma()` in DSQL mode block on `refresh()` when the seed is already past expiry, or migrate the remaining direct `getPrisma().<model>` writers onto `withDb`.

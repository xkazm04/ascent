# Database Client & Schema — Bug + UI Scan
> Context: Database Client & Schema (Data & Persistence)
> Total: 5 findings (0 critical, 1 high, 3 medium, 1 low)

Files read: `src/lib/db/client.ts`, `src/lib/db/client.test.ts`, `src/lib/db/index.ts`, `src/lib/db/init-sql.test.ts`, `prisma/schema.prisma`, `prisma/init.sql`, `docs/ARCHITECTURE.md`, `src/lib/db/pglite-boot.ts`, `src/instrumentation.ts` (plus cross-refs: `.env.example`, `uat/env.md`, `scans-read.ts`, grep of `withDb`/`getPrisma` usage across `src/`). The five findings from the 2026-06-16 scan of this context are all fixed in the current code (DSQL seed fail-fast, index parity tests, `@@unique([repoId,headSha])`, `dbHealthCheck` self-heal-on-any-failure) — these are new.

## 1. DSQL auth-expiry recovery is wired only into withDb(); the entire read surface + most writes use getPrisma() directly and never reconnect
- **Lens**: bug-hunter
- **Severity**: high
- **Category**: recovery-gap / silent-failure
- **File**: src/lib/db/client.ts:212-222 (dbReadSafe), 467-516 (runWithReconnect/withDb); read sites e.g. src/lib/db/scans-read.ts:40,59
- **Value**: impact 8 · effort 5 · risk 4
- **Scenario**: Production runs Aurora DSQL (short-lived IAM tokens). The module's header advertises that it "reactively reconnects on an auth-expiry error". But `runWithReconnect` is only reachable through `withDb()`, and a grep shows `withDb(` has exactly one production caller (`scans-persist.ts`). Every read (`getOrgRollup`, `findScanByCommit`, credits, members, plan, segments, sessions, …) and almost every write call `getPrisma()` directly. If the proactive background refresh hasn't landed or is failing (cold-start before first mint, or an STS/IAM hiccup that outlasts the 120s refresh margin), the next `getPrisma().<model>` query runs with an expired token and throws an auth-expiry error. Reads wrapped in `dbReadSafe` are *not* saved — `dbReadSafe` only swallows `isDbUnavailableError`, not `isAuthExpiryError` (line 216) — so they re-throw and 500. A reconnect would have fixed it.
- **Root cause**: The reactive reconnect was bolted onto a single helper (`withDb`) rather than the shared accessor (`getPrisma`) or the read-degradation wrapper (`dbReadSafe`). The proactive refresh is treated as the primary defense; the reactive path that's meant to be the safety net covers ~1% of call sites.
- **Impact**: The "no 2 AM outage" guarantee the file is built around holds only for scan persistence. A token-mint stall near expiry, or a cold thaw, 500s dashboards and most write APIs instead of self-healing — the exact failure class this module exists to prevent.
- **Fix sketch**: Make `getPrisma()`-based access recover too: route reads through `withDb` (or give `dbReadSafe` an auth-expiry branch that calls `reconnectDb()` + retries once, mirroring `runWithReconnect`). Cleanest is to have all DB helpers obtain their client via `withDb`/an async accessor so the reconnect-once-on-auth-expiry behavior is universal, not opt-in.

## 2. Proactive token refresh $disconnect()s the previous client immediately after swap — can abort in-flight queries near every rotation
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: race-condition
- **File**: src/lib/db/client.ts:360-369 (doRefresh), triggered proactively from 405-409 (getPrisma) and 493-496 (withDb)
- **Value**: impact 6 · effort 4 · risk 4
- **Scenario**: In DSQL mode `getPrisma()` returns the cached (still-valid) client synchronously and, when the token enters its 120s refresh margin, kicks a background `refresh(cfg)`. `doRefresh` mints, builds `next`, swaps `g.__ascentPrisma`, then immediately calls `previous.$disconnect()`. Concurrent requests that called `getPrisma()` microseconds earlier hold a reference to `previous` and may be mid-`await previous.<model>.<op>()`. Prisma's `$disconnect()` tears down the query engine/pool without a documented guarantee of draining in-flight work, so those queries can fail with a connection-closed error — even though the old token was still valid.
- **Root cause**: Eager disconnect of the outgoing client at swap time, ignoring that the synchronous accessor hands the old reference to other in-flight callers. The rotation happens roughly every (TTL − margin) ≈ 13 min under sustained traffic, so the collision window recurs.
- **Impact**: Sporadic, hard-to-reproduce 500s / failed scans clustered around token rotations on DSQL — looks like a flaky DB, not a client bug.
- **Fix sketch**: Defer the disconnect of `previous` (e.g. `setTimeout` a grace period well beyond max request duration, or skip explicit disconnect and let the pool idle out / GC). Disconnecting only on a *reactive* reconnect (where the old client is already broken) is safe; the *proactive* path should retire the old client lazily.

## 3. dbReadSafe degrades operation/connection TIMEOUTS to empty fallback — a slow live DB silently renders "no data"
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/lib/db/client.ts:186-203 (isDbUnavailableError, P1002/P1008 at 192), 212-222 (dbReadSafe)
- **Value**: impact 6 · effort 3 · risk 3
- **Scenario**: `isDbUnavailableError` classifies Prisma `P1008` ("Operations timed out") and `P1002` ("server was reached but timed out") as "database unreachable". `dbReadSafe` then catches those and returns the caller's fallback (typically an empty list / null). But `P1008` fires routinely on a *live but slow* DB — a heavy org rollup query, pool saturation under a fleet scan, or DSQL latency — not only when the server is down. A timed-out dashboard read therefore resolves to an empty rollup, and the page renders "empty fleet / no history" instead of surfacing an error or retrying.
- **Root cause**: Conflating "server is gone" (recover by degrading) with "this query was too slow" (a transient that should error or retry). A timeout is not the same signal as connection-refused.
- **Impact**: Success theater on the read path: users see plausible-but-wrong empty data (zero repos, flat trends, blank audit log) under load, eroding trust and masking a real capacity/perf problem. For any balance/quota read wrapped this way, an empty fallback could also mislead.
- **Fix sketch**: Drop `P1008` (and arguably `P1002`) from `isDbUnavailableError`, or split a `isDbTimeoutError` that `dbReadSafe` re-throws (or retries with backoff) rather than silently zeroing out. Keep `P1001`/`PrismaClientInitializationError`/ECONNREFUSED as the genuine "degrade to no-DB" set.

## 4. bootPglite is all-or-nothing on the Organization table — schema additions never reach an existing local PGlite data dir
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: latent-failure / state-drift
- **File**: src/lib/db/pglite-boot.ts:24-32
- **Value**: impact 5 · effort 5 · risk 3
- **Scenario**: Local dev uses embedded PGlite, bootstrapped from `prisma/init.sql`. The boot gate probes `to_regclass('public."Organization"')` and runs the *entire* `init.sql` only when that returns null (empty DB). `init.sql` uses plain `CREATE TABLE` (no `IF NOT EXISTS`). So once a developer has any populated `.pglite/ascent`, every future `init.sql` change — a new table (e.g. a freshly added model) or column — is skipped forever. The next query against the new table/column throws "relation/column does not exist" with nothing pointing at the cause; the only cure is wiping the data dir, which no error suggests.
- **Root cause**: A single sentinel table is used as a proxy for "schema is current", but the bootstrap is not migration-aware — it's binary (virgin DB vs. not). New DDL added after first boot is structurally unreachable.
- **Impact**: Recurring local-dev breakage on every schema change; lost local data when the fix (wipe + re-seed) is finally discovered. Pure DX, but a persistent foot-gun for the whole team.
- **Fix sketch**: Make the bootstrap idempotent (regenerate `init.sql` with `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS` and run it every boot), or track an applied-version marker and exec newer statements. Minimally, detect a known-recent table too and log a loud "PGlite schema is stale — wipe PGLITE_DATA_DIR" warning.

## 5. gatePolicy is the schema's lone jsonb column, violating its own "JSON-as-TEXT, no jsonb" DSQL-safety contract
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case / portability
- **File**: prisma/schema.prisma:51 (`gatePolicy Json?`) + 8-9 (the contract); prisma/init.sql:27 (`"gatePolicy" JSONB`)
- **Value**: impact 4 · effort 3 · risk 3
- **Scenario**: The schema header states the deliberate DSQL-safe rule: "Bulky string arrays are stored as serialized JSON in text columns (no jsonb dependency)" — and indeed every other JSON payload (`strengths`, `risks`, `discrepancies`, `prStats`, `governance`, `techStackJson`, `meta`, `repos`, `tags`, `steps`, …) is a `String`/`TEXT` column. `Organization.gatePolicy` alone is a Prisma `Json?`, which `init.sql` materializes as `JSONB` — the single deviation from the stated contract. On the production target (Aurora DSQL, with a constrained type subset) a jsonb column is a portability risk the rest of the schema was specifically designed to avoid; it also means `gatePolicy` reads back as a parsed object on Postgres while every sibling JSON field is a string the app `JSON.parse`s, an inconsistent access shape.
- **Root cause**: A later-added column used Prisma's native `Json` type instead of following the established `String`-of-serialized-JSON convention; the parity test checks tables/columns/indexes but not column *types*, so the drift from the design rule went uncaught.
- **Impact**: If DSQL rejects/limits jsonb, every Organization write/read touching `gatePolicy` fails on prod while passing on local Postgres — a deploy-only failure. Even absent that, it's an unguarded violation of the schema's portability invariant.
- **Fix sketch**: Store `gatePolicy` as `String` (serialized JSON) like the other JSON fields and parse at the edge in `org-gate.ts`, restoring the no-jsonb contract; or, if jsonb on DSQL is intentionally accepted, delete the "no jsonb dependency" claim from the header so the contract matches reality. (Secondary, same file: several hot tables carry a redundant single-column index that is a leftmost prefix of a composite/unique — `Scan @@index([repoId])`, `Repository @@index([orgId])`, `CreditLedger @@index([orgId])`, `AuditLog @@index([orgId])` — pure write amplification; the `Scan` comment even says the plain index was "replaced" but it remains.)

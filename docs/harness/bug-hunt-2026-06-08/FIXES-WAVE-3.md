# Bug Hunter Fix Wave 3 — Persistence / DSQL durability

> 3 commits, 4 findings closed (2 Critical + 2 Medium) + 1 partially (recovery); 2 High deferred with cause.
> Baseline preserved: tsc 0→0 errors, eslint clean, `next build` green.
> Branch: `vibeman/bug-hunt-wave1-authz` (continued).
> **Caveat:** this is the DB layer and the deployment here is DB-less, so fixes are verified by `tsc`/`next build` only — not exercised against a live Postgres/DSQL. Fixes were chosen to be **inert in static/local-Postgres mode** so the default deployment is unaffected.

## Commits

| # | Commit | Findings | Severity | Files |
|---|---|---|---|---|
| 1 | `5d71972` | persistence #1, #2, #3 (recovery) | Critical ×2 + High | `lib/db/scans.ts` |
| 2 | `15e59d3` | persistence #6 | Medium | `api/scan/route.ts` |
| 3 | `f04a90c` | persistence #7 | Medium | `lib/db/scans.ts` |

## What was fixed

1. **DSQL token-expiry recovery for scan persistence (persistence #1 + #2 Critical, #3 recovery)** — every helper called the synchronous `getPrisma()` (cached client + fire-and-forget background refresh); the token-aware `withDb()` wrapper (awaits a stale-token refresh, reconnects + retries once on auth-expiry) was exported but **used by nothing**. On Aurora DSQL (IAM token TTL ~15min) a frozen serverless instance that thaws past expiry 500s on its first DB op with the scan unsaved. **Fix:** wrap `persistScanReport` — the hottest write (every scan / cron rescan / push webhook) — in `withDb`. On reconnect the client singleton is swapped, so the inner `getPrisma()/withRetry/$transaction` pick up the fresh client on the retried run (also recovering a token that expires *mid-transaction* — #3's data-loss impact). **`withDb` is inert in static mode** (`readDsqlConfig()` null → op runs once), so the default/local deployment is byte-for-byte unchanged; only DSQL gains the reconnect.

2. **Scan route surfaces a persistence failure (persistence #6, Medium)** — `persistScanReport` is atomic (a throw = whole scan rolled back, nothing saved), but `/api/scan` caught the throw, logged it, and returned a clean 200. The user saw a rendered report and believed it was saved; a later history/permalink read returned empty ("no data", not "save failed"). **Fix:** track the persist result and emit `x-ascent-persisted: false` when it threw — degrades (the report still renders) rather than failing, so clients/monitoring can detect and retry.

3. **Recommendation audit moved into its transaction (persistence #7, Medium)** — `updateRecommendation` committed the row + timeline events in one `$transaction`, then wrote the audit via a best-effort post-tx `recordAudit` that only logged on failure. A committed status change could end up with a timeline event but no audit row (a compliance gap). **Fix:** write the audit via `tx.auditLog.create` inside the same transaction (mirroring `persistScanReport`'s `scan.created`), so it shares the mutation's atomicity.

## Deferred (with cause) — need a live DB / infra decision

- **persistence #4 (High) — `@@unique([repoId, headSha])` + `upsertRacing`.** Cross-instance scans of the same commit can both insert (process-local `withRepoLock` + read-then-insert dedup, no DB uniqueness). The fix is a **Prisma schema migration** adding a partial unique index — which would *fail* on a table that already holds duplicate rows, and can't be runtime-verified DB-less. Doing it blind risks a broken migration on real data. **Deferred:** needs a live DB to add the constraint (after de-duping any existing rows) and exercise the `upsertRacing` loser path.
- **persistence #5 (High) — serverless connection-pool storm.** No `connection_limit`/pooler; N warm lambdas × default pool + the cron's 4 concurrent 20s transactions can exhaust Postgres. The real fix is a **pooler (PgBouncer / `pgbouncer=true`) + a tuned `connection_limit`** — a deployment/infra decision with a real tradeoff (`connection_limit=1` serializes the cron's 4 lanes). Guessing a value blind, unverifiable, could hurt cron throughput. **Deferred:** deployment-level config; recommend a pooler + `connection_limit` cap reconciled against `max_connections` and `SCAN_CONCURRENCY`.

## Partial / scope note

- The token-expiry close is **scoped to the scan-persist write path** (`persistScanReport`). Reads and secondary write helpers (`org.ts` ~28 sites, `installations.ts`, `sessions.ts`, the other `scans.ts` reads) still call `getPrisma()` directly. A token-expiry there is a **transient, recoverable 500** (the background refresh + `dbHealthCheck` self-heal the next call) with **no data loss** — distinct from the write-path data-loss criticals just closed. Migrating all 72 `getPrisma()` sites to `withDb` is a large, runtime-unverifiable refactor with nesting hazards (nested `withDb` would double-retry) — deferred as a deliberate follow-up rather than rammed through blind.

## Verification

| Check | Baseline | After Wave 3 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `eslint` (changed files) | (3 pre-existing warnings, untouched) | clean |
| `next build` | pass | pass |
| Live DB exercise | — | not possible here (DB-less) |

## Cumulative status (waves 1–3)

- **14 findings closed** in 11 fix commits (W1: 4, W2: 6, W3: 4) + persistence #3 recovery; 1 reassessed & deferred (github-app #2); **4 findings deferred with cause** (#3 prevention, #4, #5, + the broader read-path withDb migration).
- **Criticals: 6 of 9 closed** (github-app #1, org-dashboard #1, org-scanning #1, usage #1, persistence #1, persistence #2) + 1 reassessed (github-app #2). **2 criticals remain:** maturity #1 (Wave 4), llm #1 (Wave 5).
- Remaining per INDEX: Wave 4 (scoring correctness — 1 critical), Wave 5 (lifecycle/crashes — 1 critical: llm #1), Waves 6–8 (billing, cache/sync, session/UI tail).

## Patterns established (catalogue items 7–9)

7. **Build the safety net, then actually route through it.** `withDb`/`runWithReconnect`/`reconnectDb` were correct and unit-tested but adopted by zero call sites — the documented guarantee was dead code. A resilience primitive only counts where it's on the call path.
8. **A singleton-swap recovery lets you wrap without threading.** Because `reconnectDb`/`refresh` swap the global Prisma client, wrapping a function in `withDb` and letting its inner `getPrisma()` calls re-read the singleton is sufficient — no need to thread the client through every call. (And it's inert when the resilience mode is off.)
9. **Atomic-but-swallowed = silent data loss.** Making a write all-or-nothing (throw on partial failure) is only half the fix; the caller must propagate the throw (header/5xx/retry), or the user still sees "success" with nothing saved.

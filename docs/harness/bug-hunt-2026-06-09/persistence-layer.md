# Bug Hunter Scan — Persistence Layer (Prisma / Aurora DSQL) (ascent)

> Total: 7 findings (Critical: 1 | High: 3 | Medium: 2 | Low: 1)

## 1. `recommendation.updated` audit rows are written with `orgId: null` — invisible to the only audit reader, and the actor is dropped
- **Severity**: High
- **Category**: silent-noop / unreachable-write
- **File**: src/lib/db/scans-recommendations.ts:97
- **Scenario**: If a user changes a recommendation's status/assignee/due-date from the backlog, `updateRecommendation` writes an `auditLog.create({ action: "recommendation.updated", orgId: null, actorId: null })` inside the mutation transaction. Later, when a compliance/org owner opens the audit viewer, `getAuditLog(orgSlug)` runs `where: { orgId }` (scans-audit.ts:123) — which can NEVER match an `orgId: null` row.
- **Root cause**: The transaction has the recommendation id in hand but never resolves `Recommendation → Scan → Repository → Organization` (a resolver, `getRecommendationOrgSlug`, already exists two functions down) to stamp the real `orgId`. It also computes `actor` (line 60) and embeds it only in the JSON `meta`, while leaving the indexed `actorId` column null — so the "who changed it" data the backlog is sold on is unqueryable.
- **Impact**: Silent compliance gap — every backlog mutation is "audited" into a write-only black hole. The code comment claims this closes "a compliance gap for the audit product," but the chosen `orgId: null` re-opens it: the entries are durable yet permanently unreadable through the product's own viewer, and actor attribution is lost.
- **Fix sketch**: Inside the tx, resolve the owning org id from the recommendation graph (select `scan.repo.org.id` on the `current` read) and pass `orgId: <resolved>`, `actorId: actor`. Then the entry shows up in the org-scoped keyset query with attribution intact.

## 2. DSQL cold-start trusts the deploy-time IAM token for a FULL fresh TTL — an already-aged token leaves `tokenIsStale` blind and skips proactive refresh
- **Severity**: High
- **Category**: token-expiry
- **File**: src/lib/db/client.ts:315
- **Scenario**: A serverless instance cold-starts in DSQL mode. `getPrisma()` seeds a client from `process.env.DATABASE_URL` (the token minted at *deploy* time, possibly 14 minutes ago) and stamps `expiresAt = Date.now() + cfg.ttlSeconds*1000` — i.e. it asserts a brand-new 15-minute lifetime for a token that may be seconds from expiry. It then kicks a background `refresh(cfg)`. If that background mint fails (transient IAM/STS error, missing `@aws-sdk/dsql-signer`, throttle), the failure is only `console.error`-logged and `g.__ascentPrisma` keeps the stale seed client with a bogus far-future `expiresAt`.
- **Root cause**: `expiresAt` is derived from "now" rather than from the seed token's real `exp`. The freshness model assumes the seed token's age is zero.
- **Impact**: `tokenIsStale()` returns false for the next ~13 minutes even though the underlying token is already dead, so no proactive refresh fires. Direct `getPrisma()` callers (every read path: `findScanByCommit`, `getRepositoryHistory`, `resolveOrgId`, etc. — none of which go through `withDb`) hit auth-expiry errors and 500 with no reconnect, until the next stale-window check or process recycle. A `withDb`-wrapped write recovers (one reconnect), but the much larger read surface does not.
- **Fix sketch**: On cold start in DSQL mode, do not trust the seed token's TTL — set `expiresAt` to `0` (or `Date.now()`) so the very first `getPrisma()`/`withDb()` treats it as stale and refreshes before use; or `await` one mint synchronously in a bootstrap before serving. Additionally, route read helpers through a freshness-aware accessor so reads also self-heal.

## 3. A failed background token refresh pins a stale client with a far-future `expiresAt`, suppressing all further proactive refreshes
- **Severity**: High
- **Category**: token-expiry / recovery-gap
- **File**: src/lib/db/client.ts:258
- **Scenario**: In steady-state DSQL mode the token enters its refresh margin, `getPrisma()` kicks `refresh(cfg)`, and `doRefresh` throws during `mintDsqlToken` (IAM throttle, clock skew, transient STS 5xx). `refresh` clears `g.__ascentPrismaRefresh` (good) but `doRefresh` only assigns `g.__ascentPrisma` *after* a successful mint — so the existing state, with its now-imminent `expiresAt`, is left in place. Once that `expiresAt` passes, `tokenIsStale` is true again and each request re-kicks a (single-flighted) refresh, but every attempt only logs.
- **Root cause**: There is no backoff, no surfacing, and — combined with finding #2 — no guarantee `expiresAt` reflects a usable token. Read-path callers never observe the failure; they just get a client whose token is expiring/expired.
- **Impact**: Quiet degradation: proactive refresh becomes a no-op loop while the actual token expires. Writes via `withDb` still reactively reconnect (and will keep failing/retrying once per write if the mint is persistently broken), but the failure is invisible to health signals beyond a log line — the classic "silent 2 AM outage" the module's header set out to prevent.
- **Fix sketch**: On `doRefresh` failure, do not leave a misleading `expiresAt`; either keep the old state but mark it forced-stale, or record a `lastRefreshError` that `dbHealthCheck` reports as `ok:false`. Add bounded backoff so a broken signer doesn't get hammered every request.

## 4. Sha-less scans bypass dedup entirely — concurrent or repeated scans of a repo with no `headSha` insert duplicate Scan rows every time
- **Severity**: Medium
- **Category**: duplicate-rows / dedup-gap
- **File**: src/lib/db/scans-persist.ts:125
- **Scenario**: A scan whose `report.repo.headSha` is null (a source/branch with no resolvable SHA, a reconstructed snapshot, a provider that didn't report HEAD) reaches `persistScanReport`. The dedup guard is `if (headSha) { ...findScanByCommit... }`, so with `headSha === null` it is skipped. Two concurrent sha-less scans of the same repo (double-click, cron batch) — or even repeated sequential re-tests — each create a fresh Scan graph.
- **Root cause**: Deduplication is keyed solely on commit SHA; there is no fallback identity (e.g. content hash, or a short time-window "same repo same minute" guard) for the sha-less case. `withRepoLock` serializes same-instance runs but does nothing to dedup them, and is process-local so it cannot help cross-instance.
- **Impact**: Duplicate, independently-billable Scan rows for the unchanged sha-less repo (the very double-charge the dedup path exists to prevent), plus noisy/misleading history and trend points. Each duplicate also carries a full dimensions+recommendations subtree.
- **Fix sketch**: When `headSha` is null, fall back to a secondary dedup window (e.g. reuse the latest scan within N seconds for the same repoId, or dedup on a hash of the scored payload). At minimum, document and meter sha-less scans so they aren't silently double-billed.

## 5. `getRepositoryHistory` / `getScanComparison` pass `limit` straight to Prisma `take` with no clamp — a negative limit silently returns the OLDEST scans
- **Severity**: Medium
- **Category**: edge-case / ordering-corruption
- **File**: src/lib/db/scans-read.ts:104
- **Scenario**: A caller passes `opts.limit` from an unvalidated source. `getRepositoryHistory` does `const limit = opts.limit ?? 30; ... take: limit` with no bound (same in `getScanComparison`, line 296). Prisma interprets a **negative** `take` as "take from the end of the ordered set," so `take: -10` against `orderBy: { scannedAt: "desc" }` returns the 10 *oldest* scans (effectively reversed) instead of the newest. `take: 0` returns an empty history that reads as "never scanned." A huge positive limit fetches the entire scan graph unbounded.
- **Root cause**: Unlike its siblings `getPublicScanGallery` (`Math.max(1, …)`) and `getAuditLog` (`Math.min(100, Math.max(1, …))`), the history/compare reads never sanitize `limit`. The "newest-first" contract is silently violated for non-positive inputs.
- **Impact**: Wrong-direction or empty trend charts / comparison pickers presented as authoritative, plus an unbounded-fetch DoS lever for a large positive value. Currently the in-repo HTTP callers pass safe constants, so this is a latent landmine for the next caller rather than a live break — but it fails silently when tripped.
- **Fix sketch**: Clamp at the boundary: `const limit = Math.min(MAX, Math.max(1, Math.floor(opts.limit ?? 30)))` in both functions, mirroring `getAuditLog`.

## 6. The persist transaction does up to ~58 sequential round-trips, and `withRetry` re-runs the WHOLE expensive tx on every OCC conflict — a retry-storm amplifier on DSQL
- **Severity**: Medium
- **Category**: retry-amplification / partial-write-pressure
- **File**: src/lib/db/scans-persist.ts:149
- **Scenario**: Under real concurrency (cron rescan batch) on Aurora DSQL, the `$transaction` writes the scan + all dimensions + all recommendations, then loops up to 50 sequential `repoContributor.upsert` calls, then `repoTeam.deleteMany` + per-team creates, then the audit row. The larger and longer-lived the transaction, the higher its commit-time OCC conflict probability. On a 40001/P2034 conflict, the surrounding `withRetry` (default 5 attempts) re-executes the *entire* multi-second transaction from scratch.
- **Root cause**: A single interactive transaction batches ~58 statements with a 20s timeout, maximizing the read/write footprint that DSQL's optimistic concurrency must validate at commit; retries multiply that cost rather than narrowing the contended write set.
- **Impact**: Under a conflicting herd, each loser pays the full tx cost again per retry; worst case `maxAttempts × ~58 round-trips` of wasted work, raising tail latency and the chance of exhausting retries (→ a 500 with nothing saved) precisely when load is highest. Also risks bumping DSQL's per-transaction size/time limits.
- **Fix sketch**: Use `createMany` for contributors/teams instead of N sequential upserts to shrink the transaction footprint and round-trips; consider splitting the immutable scan-graph insert (the part that must be atomic) from the idempotent contributor/team upserts so a conflict retries a smaller unit. Cap effective concurrency on the cron batch path.

## 7. `withRepoLock` serializes the persist closure but `cacheDelete` side effects re-run on every `withRetry`/`withDb` retry, and the lock is dropped before they execute on the happy path only
- **Severity**: Low
- **Category**: retry-non-idempotent (benign side effect)
- **File**: src/lib/db/scans-persist.ts:280
- **Scenario**: `persistScanReport` nests `withDb( … withRetry(repo upsert) … withRepoLock(repo.id, () => withRetry(scan tx + cacheDelete)) )`. The post-commit `cacheDelete` calls sit *inside* the `withRetry` body. If the scan transaction commits but a later statement in the same body (or an auth-expiry seen by the outer `withDb`) triggers a retry, the closure — including the already-committed-path `cacheDelete` — re-runs; and on an outer `withDb` auth retry the *repo upsert* runs a second time too.
- **Root cause**: Retry wrappers re-execute closures that contain non-transactional side effects (cache invalidation, repo upsert) rather than only the atomic unit.
- **Impact**: Benign in practice — `cacheDelete` and the repo `upsert` are idempotent, so the worst case is redundant work, not corruption. Flagged because it's a fragile pattern: any future non-idempotent side effect added to these closures (e.g. a usage/billing increment, an emitted event) would be double-applied on a retry with no guard.
- **Fix sketch**: Keep retry wrappers tight around the atomic DB unit only; move post-commit side effects (cache invalidation, any future metering/eventing) outside `withRetry`/`withDb`, executed once after the transaction resolves.

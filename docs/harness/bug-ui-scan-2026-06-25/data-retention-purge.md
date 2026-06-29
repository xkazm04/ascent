# Data Retention & Purge — Bug + UI Scan
> Context: Data Retention & Purge (Data & Persistence)
> Total: 5 findings (0 critical, 0 high, 3 medium, 2 low)

This is a backend/persistence context (cron route + retention lib + tests) with no UI surface, so all findings are bug-hunter. The module is unusually well-tested and defensively written (shared withRetry, atomic sub-graph deletes, opt-in 0/0 safety, fail-closed CRON_SECRET, createdAt-ranked selection). The schema confirms Scan's only children are `ScanDimension` + `Recommendation` (+ `RecommendationEvent` grandchild) — all three are deleted, so there is no orphaned-child bug. Findings below are about run-level observability, scale/starvation, and secret handling.

## 1. Purge route returns HTTP 200 even when the run collected errors
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/app/api/cron/purge/route.ts:33-38
- **Value**: impact 6 · effort 2 · risk 2
- **Scenario**: An org's deletes apply but `recordAudit` fails, so `retention.ts` pushes `"<slug>: retention audit write failed (deletes applied, compliance trace missing)"` into `summary.errors`. The route logs `console.warn(...)` then `return NextResponse.json(summary)` — HTTP **200**. Vercel Cron and any uptime/HTTP monitor see a green run; the compliance-degraded purge is invisible unless someone reads the JSON body.
- **Root cause**: `retention.ts` deliberately surfaces audit-write failures as `errors[]` entries (its own comment, lines 265-267, says a destructive purge that loses its trace "must surface as a degraded run, not a green 200") — but the route never translates a non-empty `errors[]` into a non-2xx status. The two halves disagree on what "degraded" means at the HTTP boundary.
- **Impact**: For an audit/compliance product, destructive purges whose compliance trace was lost (or whose per-org pruning threw) report success to the only thing watching the cron — operators never get paged.
- **Fix sketch**: When `summary.errors.length > 0`, return `status: 207` (or 500) so cron alerting trips; keep the full summary in the body. Cheap, no logic change to the lib.

## 2. Tail-org starvation: unordered org iteration + 300s cap, no progress cursor
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: edge-case
- **File**: src/lib/db/retention.ts:228-235 (and route maxDuration src/app/api/cron/purge/route.ts:14)
- **Value**: impact 6 · effort 4 · risk 3
- **Scenario**: `prisma.organization.findMany({...})` has **no `orderBy`**, then orgs are pruned strictly sequentially. On a large fleet (many orgs, each with many repos × deep per-commit scan history), the run can exceed `maxDuration = 300`. Vercel kills it mid-loop. Because the org order is stable across runs and there is no "last purged" cursor, every run processes the same prefix and dies at roughly the same point — the tail of the org list is **never reached**, so those orgs' retention is never enforced and their tables grow unbounded (the exact failure this module exists to prevent), and disproportionately for the biggest fleets that need it most.
- **Root cause**: The job assumes one cron tick can always drain the whole fleet; there is no time budget, no fairness/rotation, and no resumable cursor.
- **Impact**: Silent, permanent retention failure for late-ordered orgs; storage/compliance liability accrues invisibly.
- **Fix sketch**: Order orgs by a `lastRetentionPurgeAt` (least-recently-purged first) and/or stop cleanly when a wall-clock budget (e.g. 250s) is exhausted, recording where it stopped so the next tick resumes. Even just `orderBy` on a rotating key removes the deterministic starvation.

## 3. Cron secret accepted as a `?key=` query param (log leakage) + non-constant-time compare
- **Lens**: bug-hunter
- **Severity**: medium
- **Category**: silent-failure
- **File**: src/app/api/cron/purge/route.ts:24-28
- **Value**: impact 5 · effort 3 · risk 3
- **Scenario**: Auth passes if `auth === \`Bearer ${secret}\`` **or** `key === secret`, where `key` comes from `?key=...`. Query strings are routinely captured by access logs, CDN/proxy logs, browser history, and `Referer` headers — so the secret that authorizes a **data-deletion** endpoint can leak into places the Authorization header never reaches. Separately, `!==` is not constant-time. Anyone who recovers the secret can trigger purges for every configured org.
- **Root cause**: Convenience fallback for manual triggering put a high-value secret on the most log-prone channel; equality compare wasn't hardened for a security token.
- **Impact**: Destructive-endpoint credential exposure via logs; theoretical timing oracle on the secret.
- **Fix sketch**: Drop the `key` query-param path (require the `Authorization: Bearer` header only), and compare with `crypto.timingSafeEqual` over equal-length buffers. Blast radius is bounded (retention is opt-in), which keeps this medium rather than critical.

## 4. Configured-but-nothing-expired orgs write a zero-count `retention.purged` audit entry every run
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: silent-failure
- **File**: src/lib/db/retention.ts:236-282
- **Value**: impact 3 · effort 3 · risk 2
- **Scenario**: The skip guard (line 238) only `continue`s when **both** windows are 0. An org with, say, `auditDays = 30` and `maxScansPerRepo = 0`, on a day with nothing older than 30 days, runs the (empty) audit prune and then `recordAudit(PURGE_ACTION, { scansDeleted: 0, ..., auditDeleted: 0 })`. So a daily cron writes an all-zero `retention.purged` AuditLog row for every configured org, every day, forever (themselves bounded by the same window, so re-purged later).
- **Root cause**: The "don't write a no-op audit entry" intent (line 237) is enforced only for the fully-disabled case, not for the "policy set but nothing currently expired" case.
- **Impact**: Audit-log noise / churn in an audit product; makes the trail harder to read and adds needless writes (though it doubles as a "purge ran" heartbeat, which is why it's low).
- **Fix sketch**: Only `recordAudit` when `scansDeleted + dimensionsDeleted + recommendationsDeleted + recommendationEventsDeleted + auditDeleted > 0` (mirroring the orphan sweep's `auditDeleted > 0` gate at line 304), or write the heartbeat under a distinct, exempt action.

## 5. Unbounded `repository.findMany` + strictly-sequential per-repo pruning
- **Lens**: bug-hunter
- **Severity**: low
- **Category**: edge-case
- **File**: src/lib/db/retention.ts:248-255
- **Value**: impact 3 · effort 4 · risk 3
- **Scenario**: For each org the job does one unbounded `repository.findMany({ where: { orgId }, select: { id } })` and then `await`s `pruneRepoScans` one repo at a time. The module went to lengths to page the *scan* SELECT (lines 116-123, to avoid a single huge read hitting a DSQL statement timeout / memory pressure) but left the repo list unpaged and the per-repo loop fully serial — so a fleet org watching thousands of repos pulls every repo id at once and serializes thousands of round-trips, directly compounding the runtime/timeout exposure of finding #2.
- **Root cause**: The hardening applied to scans wasn't carried to the repo enumeration; the repo loop has no batching/concurrency.
- **Impact**: Larger memory footprint and longer wall-clock per org on big fleets, feeding the starvation in #2.
- **Fix sketch**: Page the repo enumeration (cursor/`take`) like the scan SELECT, and consider a bounded-concurrency map (`src/lib/pool.ts` is already used elsewhere for fleet scans) over repos to cut wall-clock while respecting DSQL conflict limits.

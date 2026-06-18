> Total: 5 findings (1 critical, 2 high, 1 medium, 1 low)

# Test Mastery — Data Retention & Purge

This context permanently DELETES scans, dimensions, recommendations, recommendation-events and audit entries on a daily cron. The one existing test (`retention.test.ts`) covers the three pure config helpers thoroughly and adds one good orphan-cascade test — but the actual destructive surface (which rows get selected for deletion, the auth gate on the DELETE endpoint, per-org error isolation, and the opt-in "do nothing" safety) is essentially unverified. Findings are ranked by blast radius: an unauthed purge or a mis-selected delete is unrecoverable data loss.

## 1. Test the cron/purge auth gate — an unauthed DELETE endpoint has zero route tests

- **Severity**: Critical
- **Category**: coverage-gap
- **File**: src/app/api/cron/purge/route.ts:16-32 (no `route.test.ts` exists anywhere under `src/app/api/cron/`)
- **Scenario**: A refactor reorders or weakens the guard — e.g. someone restores the old `if (secret)` opt-in shape, drops the `key !== secret` branch, moves the `isDbConfigured()` check above the auth check, or returns 200 before the `Bearer` comparison. The route then deletes scan/audit data for ANY caller, or for a deploy that forgot `CRON_SECRET`. Nothing in the suite fails.
- **Root cause**: The route has no test at all. The in-file comment ("The check was opt-in (`if (secret)`)... a forgotten env var silently disabled auth on a route that DELETES data") proves this exact regression already shipped once. A boundary that has already failed in production and is the only thing standing between the public internet and a `deleteMany` must be pinned.
- **Impact**: Catastrophic, unrecoverable data loss / compliance breach — an attacker (or an unauthenticated cron probe) triggers a fleet-wide purge of scans and audit logs; or the endpoint silently disables auth on a misconfigured deploy. This is the single highest blast-radius gap in the context.
- **Fix sketch**: Add `src/app/api/cron/purge/route.test.ts` mirroring the existing `org/scan/route.test.ts` harness (mock `next/server` `NextResponse.json`, mock `@/lib/db` so `purgeExpiredData` is a spy and `isDbConfigured` is toggleable). Assert the invariants: (a) `CRON_SECRET` unset → 503 AND `purgeExpiredData` is never called; (b) wrong `Authorization` header and wrong `?key=` → 401 AND never called; (c) correct `Bearer ${secret}` → calls `purgeExpiredData` exactly once; (d) correct `?key=${secret}` → also authorizes; (e) a thrown error from `purgeExpiredData` → 500, not a 200 with partial success.

## 2. Pin the scan-selection invariant in pruneRepoScans — the test never proves the RIGHT rows are chosen

- **Severity**: High
- **Category**: success-theater
- **File**: src/lib/db/retention.ts:129-134; test at src/lib/db/retention.test.ts:124,142-163
- **Scenario**: Someone changes the selection query — drops `skip: max`, flips `orderBy` to `scannedAt` (the exact mistake the code comment warns against), or removes the `{ id: "desc" }` tiebreaker. The job then deletes the newest N scans instead of keeping them, or deletes a live newer scan ranked below a backdated/clock-skewed one. The existing test still passes because it mocks `prisma.scan.findMany` to return a hard-coded `[{id:"scan_old_1"},{id:"scan_old_2"}]` regardless of the query — it asserts the *delete order inside the transaction*, never *which scans were selected to die*.
- **Root cause**: The most safety-critical line in the module ("rank by DB-authoritative `createdAt`, NOT `scannedAt`... could otherwise DELETE a live newer scan") is asserted by a mock that ignores its own arguments. The test gives false confidence: it's green even if the selection logic is inverted.
- **Impact**: Silent deletion of the most recent scans (the ones users actually look at), corrupting trends/history and the report shown on the dashboard — the opposite of the retention guarantee, with no recovery.
- **Fix sketch**: In the fake prisma, assert `scan.findMany` was called with exactly `{ where: { repoId }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: max, select: { id: true } }`. Better, drive it with a richer fake that, given `maxScansPerRepo: 2` over 5 stable rows ordered by `createdAt`, returns the oldest 3 (post-`skip`) and assert exactly those 3 ids reach `scan.deleteMany`. Add a case where `skip >= row count` returns `[]` and asserts `$transaction` is never entered (no empty-batch delete).

## 3. Test per-org error isolation — one failing org must not abort the whole fleet purge

- **Severity**: High
- **Category**: error-branch
- **File**: src/lib/db/retention.ts:228-283 (the `for (const org of orgs)` loop and its `catch` at 280-282)
- **Scenario**: A `pruneRepoScans` or `recordAudit` call throws for one org (a poisoned row, a sustained serialization conflict that exhausts `withRetry`, a transient DSQL outage). The intended behavior is `errors.push("slug: ...")` and continue to the next org. A refactor that lets the throw escape the per-org `try`, or that `return`s early, silently stops purging every org after the first failure — the datastore grows unbounded again and the compliance window is missed, but the cron still returns a 200 summary.
- **Root cause**: The resilience contract (collect errors, keep going, surface them in `summary.errors`) is entirely untested. The existing single-org happy-path test can't catch a regression that breaks the loop's fault isolation.
- **Impact**: A single bad org quietly halts retention for the entire fleet — unbounded storage growth and a compliance gap that looks healthy (200 + non-empty `errors[]` that nobody reads). The route only `console.warn`s on errors, so this fails silently.
- **Fix sketch**: Drive `purgeExpiredData` with two enforced orgs where the first org's `pruneRepoScans` (or `recordAudit`) rejects. Assert: the second org is still processed (`results` contains it / its deletes ran), `summary.errors` contains the first org's slug, and `summary` is non-null (the run completed). Also assert a failing org writes NO `retention.purged` audit entry (the `recordAudit` is past the throw).

## 4. Cover pruneAudit's window + batch-loop termination

- **Severity**: Medium
- **Category**: edge-case
- **File**: src/lib/db/retention.ts:169-184 (audit prune loop) and the cutoff math at 252 / 289
- **Scenario**: A change to the cutoff (`at: { lt: cutoff }`), the `orderBy: { at: "asc" }`, or the loop's break conditions (`ids.length === 0` and the `< batchSize` short-circuit) deletes too much (an off-by-one on the day window dropping in-policy audit entries) or loops forever / under-deletes. None of this is exercised: the only orchestration test uses `retentionAuditDays: 0`, so `pruneAudit` is never invoked at all.
- **Root cause**: The audit-retention path (the compliance-sensitive half of the job) has zero coverage — both the per-org `{ orgId, at: { lt: cutoff } }` sweep and the org-less `{ orgId: null, ... }` orphan sweep at line 290.
- **Impact**: Either over-deletion of still-in-window audit history (a compliance/forensics loss) or unbounded audit growth — and the orphan-sweep branch (anonymous public-scan audit entries) could silently never run.
- **Fix sketch**: Fake `auditLog.findMany` to return a full `batchSize` page once then a partial page, and assert: (a) `deleteMany` is called with the returned ids and the loop terminates (no infinite loop); (b) `findMany` is called with `at: { lt: <Date ≈ now − auditDays*DAY_MS> }` (assert the cutoff is within a tolerance of `Date.now()` minus the window via fake timers); (c) with `defaults.auditDays > 0` and a per-org `auditDays`, BOTH the `{ orgId }` sweep and the `{ orgId: null }` orphan sweep fire, and the orphan sweep only records an audit entry when `auditDeleted > 0`.

## 5. Assert the opt-in "nothing configured = delete nothing, write no audit" safety at the orchestrator level

- **Severity**: Low
- **Category**: coverage-gap
- **File**: src/lib/db/retention.ts:231 (`if (policy.maxScansPerRepo <= 0 && policy.auditDays <= 0) continue;`)
- **Scenario**: The whole module's safety promise is "retention is OPT-IN; with nothing configured every window is 0 and nothing is deleted." A refactor that treats `0` as "delete all beyond 0 kept" (instead of "unlimited / skip"), or removes the `continue`, would wipe every scan on the first cron run of an existing deployment that never asked for retention. `resolveRetention`/`envRetentionDefaults` prove `0` is *computed*, but no test proves `purgeExpiredData` *acts on* a 0/0 policy by doing nothing.
- **Root cause**: The pure helpers are well-tested, but the orchestrator's enforcement of their result (the `continue` skip and the "don't write a no-op audit entry" rule) is not.
- **Impact**: A regression here silently deletes a customer's entire scan/audit history on deploy — high consequence, but low likelihood/severity here because it sits behind the well-tested pure layer; this test cheaply closes the last gap to a full safety proof.
- **Fix sketch**: With all `RETENTION_*` env unset and an org whose overrides are `null/null`, call `purgeExpiredData` and assert NO `deleteMany` (scan or audit) and NO `recordAudit` is called, `orgsProcessed === 0`, and all `*Deleted` totals are `0`. Add a counterpart: env `RETENTION_MAX_SCANS_PER_REPO=5` + org override `retentionMaxScans: 0` deletes nothing for that org (explicit-0 = unlimited wins).

# Bug-UI Fix Wave 3 — Data Integrity & Concurrency

> 3 atomic commits, 5 findings closed (1 critical, 2 high, 2 medium) + 1 critical **escalated** (DSQL cold-start).
> Baseline preserved: `tsc` 0 → 0 errors · tests 477/477 → 479/479 (+2 index-parity tests) · `prisma validate` ✓.

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|--------|-----------------|----------|-------|
| 1 | `bf0be60` fix(db/scans): authoritative same-commit dedup + head-pointer guard + deterministic carry-forward | scan-persist #1, #4, #5; db-schema #4 | Critical + High + 2×Medium | `schema.prisma`, `init.sql`, `scans-persist.ts`, `scans-read.ts` |
| 2 | `2d8c4ab` test(db): assert init.sql mirrors every schema @@index/@@unique | db-schema #2 | High | `init-sql.test.ts` |
| 3 | `9aa6e8a` fix(db/client): dbHealthCheck self-heals on any first failure | db-schema #5 | Medium | `client.ts` |

## What was fixed

1. **Concurrent same-commit double-insert (CRITICAL).** Dedup was a non-atomic read-then-insert guarded only by a process-local lock; `Scan` had no unique constraint, so two instances persisting the same commit both missed the read and both inserted — duplicate history/trends + double metered billing. Added `@@unique([repoId, headSha])` (mirrored as a UNIQUE index in `init.sql`; NULL `headSha` stays unconstrained), and `persistScanReport` now recovers a P2002 by re-reading the winner and returning `deduped: true` — the same `upsertRacing` pattern already used (and tested) for repo/org.
2. **Head pointer rolled backwards (High).** The repo upsert wrote `headSha`/`headEtag`/`lastScanAt` in its update branch unconditionally, so a delayed/replayed scan of an *older* commit rolled the head pointer back (and could tear `headSha` apart from `headEtag` → a wrong conditional re-scan). Head fields now advance via a separate recency-guarded `updateMany` (only when newer); always-safe metadata still updates unconditionally.
3. **Non-deterministic ordering (2×Medium).** The carry-forward "previous scan" lookup and the sha-less `findScanByScannedAt` dedup used `findFirst` with a tie-prone/missing `orderBy` — on equal timestamps they resolved to an arbitrary row (mis-carried tracked status, or dropped a distinct sha-less scan). Both now have deterministic `[…, id]` tiebreakers.
4. **init.sql index drift (High).** The schema-drift guard checked tables/columns but never indexes — under `relationMode="prisma"` (no FKs) a missing `CREATE INDEX` silently degrades to full scans. The test now parses every `@@index`/`@@unique` and asserts a matching `CREATE INDEX` in `init.sql`.
5. **dbHealthCheck didn't self-heal a cold client (Medium).** It only reconnected on auth-expiry; a DSQL cold-start client built before the token mints throws a Prisma *init* error, so the monitor flatlined unhealthy until process recycle. It now attempts one reconnect + re-ping on *any* first failure. (Partial mitigation for the cold-start critical below.)

## Verification

| | Before wave | After wave |
|---|---|---|
| `tsc --noEmit` errors | 0 | 0 |
| Tests | 477/477 | 479/479 |
| `prisma validate` | ✓ | ✓ |
| New tests | — | +2 (index parity, Scan unique) |

⚠️ **Migration note (commit 1):** applying `@@unique([repoId, headSha])` to an *existing* prod DB needs a one-time dedup of any pre-existing duplicate `(repoId, headSha)` rows before `prisma migrate` can create the index. `init.sql` (fresh bootstrap) is safe. The app-level P2002 handling is forward-compatible whether or not the constraint is live yet — so it can ship ahead of the migration.

## Patterns established (catalogue items 9–11)

9. **A read-then-insert dedup needs a DB unique constraint, not just a lock.** A process-local lock collapses the same-instance race but does nothing cross-instance/serverless. Back the dedup with a unique constraint and treat the loser's P2002 as "deduped" — the lock is the fast path, the constraint is the correctness backstop.
10. **Never advance a "latest" pointer unconditionally — guard it by recency.** A head/latest pointer written on every persist lets a delayed/replayed older write roll it backwards. Advance only when the new record is newer (`WHERE lastX < newX`), and move co-dependent fields (sha+etag) together so they can't tear.
11. **`findFirst` without a total `orderBy` is non-deterministic on a tie.** Any "the latest/previous one" query whose sort key isn't unique must carry a deterministic tiebreaker (`…, id desc`), or it silently picks an arbitrary row under duplicates/timestamp ties.

---

## ESCALATION — DSQL cold-start critical (database-client-schema.md #1)

**What I expected:** a contained fix like the others in this wave.

**What the codebase actually contains:**
- `getPrisma()` is **synchronous** and is called **directly in 125 places across 29 files** (not via the async `withDb`). `grep getPrisma\(\)` confirms this.
- On a DSQL-only cold start (`DSQL_ENDPOINT` set, **no** `DATABASE_URL`), `getPrisma()` seeds a client with `newClient(undefined)` → a Prisma client with no datasource URL → it throws on first use until the async IAM-token mint lands (`client.ts:314`).
- `withDb` is already safe (its `getClient` `await refresh(cfg)` on a cold instance), but the 125 direct `getPrisma()` read sites are not.

**Why this changes the plan:** the real fix is one of three architectural choices, each of which is a decision for you — I shouldn't pick it blind:

| Option | Approach | Cost | Trade-off |
|---|---|---|---|
| **A. Require a `DATABASE_URL` seed token even in DSQL mode** | Validate at boot; fail fast with a clear message | Small | Contradicts the "pure-IAM, no static secret" design the module was written for |
| **B. Route all reads through `withDb`** | Audit + wrap the 125 direct `getPrisma()` sites | Large, mechanical, higher regression risk | Keeps pure-IAM; big diff to review |
| **C. Make `getPrisma()` block on a cold mint** | An async accessor / a sync façade that throws-to-`withDb` | Medium–large | Changes the sync contract every caller relies on |

**What I shipped now (partial mitigation, no decision needed):** `dbHealthCheck` self-heals on any first failure (commit 3), so a keep-warm/monitoring ping recovers the dead cold-start client before it serves users — narrowing, but not closing, the window.

**Decision needed:** pick A / B / C (or a fourth path) and I'll implement it as a follow-up. My lean is **A** — cheapest, and a deploy-time seed token is operationally simple — but only you know whether the pure-IAM, zero-static-secret posture is a hard requirement.

---

## Deferred this wave (with rationale)

- **Webhook replay dedup is process-local + unbounded in time (github-app-webhooks #1, High).** The fix needs a *persistent, cross-instance* delivery-id store (schema + write per delivery) — same shared-store class as the deferred rate-limiter. **→ needs an infra/store decision.**
- **Org rollup wide scan (db-schema #3, High).** A perf fix (add `@@index([scannedAt])` or denormalize `orgId` onto `Scan`); correctness is fine. **→ a perf wave / migration.**
- **Pinned report shows current contributors (scan-persist #2, High).** Requires per-scan contributor history (a new `ScanContributor` child or a `scanId` on `RepoContributor`) — a schema + persist + read change larger than this wave. **→ a dedicated change with a documented contract.**
- **Sha-less dedup content-key (db-schema #4, deeper half).** The deterministic `orderBy` shipped; the authoritative fix (a stored content/idempotency key) is a follow-up.

## What remains

Remaining waves per INDEX: **W4 Destructive ops** (2 criticals: purge orphans + practice-file overwrite) · W5–W11 correctness + UX/a11y. Plus the cold-start decision (A/B/C) and the deferred items above.

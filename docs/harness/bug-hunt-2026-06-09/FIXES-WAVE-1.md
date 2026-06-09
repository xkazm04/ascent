# Bug Hunter Fix Wave 1 — Concurrency, dedup & billing integrity

> 7 fix commits (+1 test-mock follow-up, +1 lint cleanup), 7 findings closed.
> Baseline preserved: tsc 0 → 0 errors · tests 257/257 → 260/260 (+3 new coalescer tests) · eslint clean.
> Branch: `vibeman/bug-hunt-2026-06-09` (off `master`).

## Commits

| # | Commit | Findings closed | Severity | Files |
|---|---|---|---|---|
| 1 | `6725e11` | org-scan #1 + #3 | Critical + High | cron/rescan/route.ts, db/org-watch.ts, db/org.ts, db/index.ts |
| 2 | `eb7e3ac` | org-scan #2 | High | org/scan/route.ts, org/import/route.ts |
| 3 | `e340adf` | scan-pipeline #1 | High | lib/cache.ts (+cache.test.ts), scan/route.ts, scan/stream/route.ts |
| 4 | `e15e879` | persistence #4 | Medium | db/scans-read.ts, db/scans-persist.ts |
| — | `844ec14` | (test follow-up to #3) | — | scan/route.test.ts, scan/stream/route.test.ts |
| 5 | `86a16b8` | persistence #6 | Medium | db/scans-persist.ts |
| 6 | `ab8a535` | gh-app #5 | Medium | app/webhook/route.ts |
| — | `3d75ea9` | (lint cleanup) | — | cache.test.ts |

## What was fixed (grouped by sub-pattern)

### Claim-before-work (atomic ownership before an expensive/billable step)
1. **Cron rescan run-level lock** (`6725e11`, Critical). `listDueRescans` selected on `nextScanAt <= now()` and the schedule advanced only *after* each scan, so two overlapping cron runs both saw the same repos as due and double-scanned + double-debited them. Added `claimRescan()` — a conditional `updateMany` that advances `nextScanAt` only while the repo is still due, so the DB-serialized first writer wins and the loser's claim matches 0 rows. Cross-instance safe (the existing `withRepoLock` is process-local only). Same change also refunds the reserved credit when an autoscan dedupes to an unchanged commit (`persisted.deduped`), not just when it degrades to mock.
2. **Reserve credit before scanning** (`eb7e3ac`, High). Bulk scan/import sliced the batch to a point-in-time entitlement read, then scanned first and best-effort-debited afterwards (failure swallowed) — so two concurrent batches both spent the same balance. Moved the atomic `consumeScanCredit` (conditional `WHERE scanCredits > 0`) *before* the scan; a failed reservation now skips the repo instead of scanning it free; refund on mock/throw keeps billing identical.

### De-duplication of redundant work
3. **In-flight scan coalescing** (`e340adf`, High). The cache filled only *after* `scanRepository` finished, so concurrent requests for the same uncached commit each paid a full ingest + LLM. Added `coalesceScan(key, factory, signal)`: first caller computes, later callers join the same promise. Abort is **refcounted** — the shared scan is cancelled only when the *last* interested caller disconnects — so coalescing doesn't weaken the abort-on-disconnect optimization. 3 unit tests lock the contract.
4. **Sha-less scan dedup** (`e15e879`, Medium). `persistScanReport` only deduped when `headSha` was set; a sha-less report fell through to an unconditional insert. The same computed report persisted twice (coalesced followers, double-submit, retried lane) now dedups on the report's own `scannedAt`; a genuinely new re-score (later timestamp) is unaffected.

### Transaction blast-radius reduction
5. **Batch contributor/team writes** (`86a16b8`, Medium). The persist tx did ~58 sequential round-trips (a 50-iteration contributor upsert loop + per-team create loop), and `withRetry` re-runs the *whole* tx on every DSQL OCC conflict. Replaced with `deleteMany` + `createMany` (RepoContributor is a documented latest-scan snapshot, so this also stops stale contributors accumulating and inflating org aggregates). ~58 → ~12 round-trips.

### Redelivery integrity
6. **Release webhook dedup slot on deferred failure** (`ab8a535`, Medium). A delivery was marked seen at the top of the handler (replay protection) before the deferred `after()` scan ran; a transient failure left it "seen" forever, so a redelivery was silently dropped. Added `forgetDelivery(id)`, called only in the deferred work's *failure* path (not the legitimate early-return skips), so a redelivery can retry while replay protection during the in-flight window is preserved.

## Verification table

| Gate | Baseline (B2) | After Wave 1 |
|---|---|---|
| `tsc --noEmit` | 0 errors | 0 errors |
| `vitest run` | 257 passed / 257 | 260 passed / 260 (+3 new) |
| `eslint` (changed files) | 0 errors | 0 errors, 0 warnings |

## Cumulative status (across all waves so far)

| Wave | Theme | Findings closed |
|---|---|---|
| 1 | Concurrency, dedup & billing integrity | 7 (1 Critical, 3 High, 3 Medium) |

Remaining: 63 of 70 findings open. Next-highest-priority waves carry the other 2 Criticals: **Wave 2** (Auth/webhook/session — gh-app #1 forged `installation.deleted`) and **Wave 3** (Resilient rendering — org-dash #1 missing error boundary).

## Patterns established (catalogue items 1–4)

1. **Claim-before-work over advance-after-work** — when a scheduler/queue selects "due" items and only advances the cursor *after* processing, two overlapping runners double-process. Make the cursor-advance an atomic conditional update *before* the work and treat "0 rows updated" as "someone else claimed it." Cross-instance safe; a process-local lock is not.
2. **Reserve-then-refund over best-effort-debit-after** — for metered work, debit atomically *before* the expensive step (conditional decrement that can't go negative) and refund if the work produced nothing billable. A post-hoc, error-swallowed debit lets concurrent callers over-spend a shared balance.
3. **Refcounted coalescing** — to share one in-flight computation across callers without losing per-caller cancellation, refcount the waiters and abort the shared work only when the *last* one leaves. Naive coalescing that binds the shared work to one caller's abort signal lets a drive-by disconnect kill work others still want.
4. **Snapshot tables: replace, don't accumulate** — a table documented as "latest snapshot per parent" must be wholesale-replaced (deleteMany + createMany, guarded against an empty source) each write, not upserted row-by-row. Per-row upserts both leak stale rows (inflating aggregates) and balloon the transaction's retry cost.

## What remains

Open themes per the INDEX: Auth/webhook/session integrity (Wave 2), Resilient rendering & empty-data UX (Wave 3), LLM provider resilience (Wave 4), Scoring/maturity math (Wave 5), SSE lifecycle & cache staleness (Wave 6), Public-surface input validation (Wave 7), Persistence & DSQL token lifecycle (Wave 8).

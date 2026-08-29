// The PublicScanQuota bucket's read-decide-write repository — the data-layer home for the ONE
// $transaction that used to live above the layer in src/lib/public-scan-quota.ts (Wave-3 residual;
// spec: docs/specs/2026-08-30-public-scan-quota-repository.md). The policy (window math, limits,
// fail-open, bucket derivation) stays in src/lib/public-scan-quota.ts; THIS module owns the
// mechanics every quota mutation shares: the transaction boundary, the serialization-conflict
// retry, and the DSQL-vs-Postgres isolation selection — the driver variance that must not leak
// upward (layering-rules: the query machinery and its driver knowledge live inside the layer).

import { Prisma } from "@prisma/client";
import { readDsqlConfig, withDb, withRetry } from "@/lib/db/client";

/**
 * Isolation for the quota's read-modify-write transactions. Vanilla Postgres defaults to READ
 * COMMITTED, where two concurrent consumers both read the same window and the last upsert silently
 * wins (lost update — no error is ever raised, so withRetry never fires); SERIALIZABLE makes one of
 * the racers abort with a 40001 that withRetry retries. Aurora DSQL runs snapshot OCC natively and
 * does not accept explicit isolation levels — its commit-time write-write conflict on the shared
 * row already aborts the loser with a retryable OC### error, so pass no option there.
 */
function quotaTxOptions(): { isolationLevel: Prisma.TransactionIsolationLevel } | undefined {
  return readDsqlConfig()
    ? undefined
    : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
}

/** What a quota decision tells the store to do, plus the caller's own verdict to carry out. */
export interface QuotaWindowDecision<T> {
  /** The serialized hits JSON to persist for this bucket — or undefined to leave the row untouched
   *  (a denied consume, a refund with nothing to remove). */
  hits?: string;
  /** The caller's result, returned unchanged from {@link transactPublicScanQuota}. */
  result: T;
}

/**
 * Retryable read-decide-write on ONE PublicScanQuota bucket: inside a single interactive
 * transaction (isolation per {@link quotaTxOptions}), read the bucket's stored hits, hand the raw
 * value to `decide`, and — when `decide` returns a window — upsert it back on the same transaction.
 * Run as separate auto-committed statements, neither Postgres nor DSQL would ever raise a conflict
 * and two parallel callers could overrun the gate; inside the boundary, the loser aborts with a
 * serialization verdict that withRetry replays (transactions-and-units-of-work: the unit of work
 * is a retryable closure — the WHOLE closure re-runs, reads included).
 *
 * `decide` MUST therefore be pure (no side effects, no fresh idempotency keys): a retried attempt
 * calls it again against a fresh read, and anything else it did would happen once per attempt.
 * Callers mint attempt-stable values (e.g. the consume's chargedAt timestamp) BEFORE calling in.
 *
 * Throws on store failure — the fail-open policy is the caller's, not the layer's.
 */
export async function transactPublicScanQuota<T>(
  ipHash: string,
  label: string,
  decide: (priorHits: string | null) => QuotaWindowDecision<T>,
): Promise<T> {
  return withDb((db) =>
    withRetry(
      () =>
        db.$transaction(async (tx) => {
          const row = await tx.publicScanQuota.findUnique({ where: { ipHash } });
          const { hits, result } = decide(row?.hits ?? null);
          if (hits !== undefined) {
            await tx.publicScanQuota.upsert({
              where: { ipHash },
              create: { ipHash, hits },
              update: { hits },
            });
          }
          return result;
        }, quotaTxOptions()),
      { label },
    ),
  );
}

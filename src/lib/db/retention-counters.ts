// The purge's per-org counters, declared ONCE. The result row, the `retention.purged` audit meta,
// the "did anything happen" gate and the run rollup all derive from PURGE_COUNTER_KEYS, so a new
// counter is one entry here instead of an edit to every hand-written list in purgeExpiredData.
// No database access.

import type { OrgPurgeResult, PurgeSummary, RetentionPolicy } from "./retention-policy";

/** Every numeric counter an {@link OrgPurgeResult} carries, in the order the audit meta lists them. */
export const PURGE_COUNTER_KEYS = [
  "scansDeleted",
  "dimensionsDeleted",
  "recommendationsDeleted",
  "recommendationEventsDeleted",
  "auditDeleted",
  "outcomesDeleted",
  "usageEventsDeleted",
  "conformanceReportsDeleted",
  "conformanceFindingsDeleted",
  "memoryCitationsDeleted",
  "controlObservationsDeleted",
  "digestsWritten",
  "scansCompacted",
  "digestsDeleted",
] as const;

export type PurgeCounterKey = (typeof PURGE_COUNTER_KEYS)[number];
export type PurgeCounters = Record<PurgeCounterKey, number>;

// Compile-time: the list is exactly the numeric keys of OrgPurgeResult (digestsWouldWrite is
// `number | null`, so it is not one), and every one of them is rolled up in PurgeSummary.
type NumericKeys<T> = { [K in keyof T]-?: T[K] extends number ? K : never }[keyof T];
type AssertTrue<T extends true> = T;
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
export type PurgeCounterKeysAreOrgResultKeys = AssertTrue<Same<PurgeCounterKey, NumericKeys<OrgPurgeResult>>>;
export type PurgeCounterKeysAreRolledUp = AssertTrue<PurgeCounterKey extends keyof PurgeSummary ? true : false>;

/** Counters that record what SURVIVED (a fold), not what died: they never open the audit gate. */
const NOT_DELETIONS: ReadonlySet<PurgeCounterKey> = new Set<PurgeCounterKey>(["digestsWritten", "scansCompacted"]);

export function zeroCounters(): PurgeCounters {
  return Object.fromEntries(PURGE_COUNTER_KEYS.map((k) => [k, 0])) as PurgeCounters;
}

/** An all-zero result row. Zeros here are a fact about a sweep's scope, never an unmeasured value. */
export function zeroOrgResult(
  orgSlug: string,
  policy: RetentionPolicy,
  digestsWouldWrite: number | null = null,
): OrgPurgeResult {
  return { orgSlug, policy, ...zeroCounters(), digestsWouldWrite };
}

/** Rows deleted. Digests ageing out count (a destructive act with no trace is what the gate is
 *  for); `digestsWritten` / `scansCompacted` do not - a fold only happens beside counted deletes. */
export function sumDeleted(c: PurgeCounters): number {
  return PURGE_COUNTER_KEYS.reduce((n, k) => (NOT_DELETIONS.has(k) ? n : n + c[k]), 0);
}

/** The `retention.purged` audit meta: every counter, then the policy that produced them. */
export function auditMeta(
  c: PurgeCounters,
  policy: Pick<RetentionPolicy, "maxScansPerRepo" | "auditDays">,
): PurgeCounters & { policy: { maxScansPerRepo: number; auditDays: number } } {
  const counters = Object.fromEntries(PURGE_COUNTER_KEYS.map((k) => [k, c[k]])) as PurgeCounters;
  return { ...counters, policy: { maxScansPerRepo: policy.maxScansPerRepo, auditDays: policy.auditDays } };
}

/** Fleet totals over the per-org rows. */
export function rollupCounters(results: readonly PurgeCounters[]): PurgeCounters {
  const out = zeroCounters();
  for (const r of results) for (const k of PURGE_COUNTER_KEYS) out[k] += r[k];
  return out;
}

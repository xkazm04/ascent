# Public-scan-quota: the escaped `$transaction` gets a data-layer home

_Wave-3 residual (`ai-registry/librarian/impact/2026-08-29-architecture-round.md`, "Residuals
discovered in execution"). Registry techniques:
`software-engineering/data-access/layering-rules` (one module owns the query language; the raw
client does not leak past the layer) and
`software-engineering/data-access/transactions-and-units-of-work` (the unit of work is a
retryable closure; the invariant's owner owns the boundary; composability via an explicit
callback, not an ambient handle)._

## Current state

`src/lib/public-scan-quota.ts` is the ONE module outside `src/lib/db/` that runs a raw
`db.$transaction` (twice — consume and refund), importing `readDsqlConfig` from
`@/lib/db/client` to select per-driver isolation (`quotaTxOptions`: SERIALIZABLE on vanilla
Postgres, no option on Aurora DSQL, whose snapshot OCC rejects explicit levels). It is
grandfathered in `eslint.config.mjs`'s `no-restricted-imports` ratchet with a
`TODO(layering-rules)` naming exactly this fix.

Both call sites are the same shape: a read-decide-write on the `PublicScanQuota` row keyed by
`ipHash` — read `hits`, run pure window logic (`decideQuota` / `removeHit`), write the new
window back — wrapped in `withDb(withRetry($transaction(..., quotaTxOptions())))`. The
DSQL-vs-Postgres isolation variance is quota-store knowledge living above the layer.

## Target shape

New repository module `src/lib/db/scan-quota.ts` (inside the layer, so the raw client import is
legal) owning the transaction, the retry, and the isolation selection:

```ts
export interface QuotaWindowDecision<T> {
  /** Serialized hits JSON to persist, or undefined to leave the row untouched. */
  hits?: string;
  result: T;
}

/** Retryable read-decide-write on one PublicScanQuota bucket. `decide` MUST be pure —
 *  a serialization abort re-runs it against a fresh read. */
export async function transactPublicScanQuota<T>(
  ipHash: string,
  label: string,
  decide: (priorHits: string | null) => QuotaWindowDecision<T>,
): Promise<T>
```

- The function is `withDb(withRetry($transaction(...)))`: inside the tx it reads the row, hands
  the raw stored `hits` (or `null`) to `decide`, and — when `decide` returns a window — upserts
  it back on the same tx. `quotaTxOptions()` (moved here verbatim, with its doc comment) selects
  the isolation per driver; the variance now lives inside the layer.
- This is the technique's "pass the scope explicitly" composability form turned inside-out for a
  single-aggregate invariant: the *repository* owns the boundary (the invariant — "the window I
  wrote is the window I read, atomically" — is internal to one bucket operation), and the caller
  supplies only the pure decision. The retry wraps the whole closure, so the aborted attempt's
  read is redone; `decide` purity is the contract that makes that safe (documented on the
  parameter). Idempotency keys (consume's `chargedAt = now`) are minted by the caller once,
  outside the retry, as today.
- Exported from the `@/lib/db` barrel.

`src/lib/public-scan-quota.ts` migrates:

- `consumePublicScanQuota`: `transactPublicScanQuota(ipHash, "public-scan-quota", raw => ...)`
  with the existing `decideQuota` logic; denied → no `hits` (no write), allowed → the new window.
  Fail-open try/catch, `isDbConfigured`/kill-switch/unidentifiable gates, and the post-tx
  `recordQuotaEvent` fire-and-forget all stay in the caller unchanged.
- `refundPublicScanQuota`: same wrapper with `"public-scan-quota-refund"`; empty/absent prior →
  no write, else the `removeHit` window. (The write becomes an upsert instead of an update — it
  only ever runs when a row was read, so behavior is identical.)
- The `Prisma` and `readDsqlConfig` imports, `quotaTxOptions`, and the `TODO(layering-rules)`
  block are deleted from this module; it no longer imports `@/lib/db/client` at all.
- `peekPublicScanQuota` / `purgeStalePublicScanQuota` are untouched (they go through the barrel's
  `withDb`, which is a deliberate export — widening the ratchet to `withDb` is a different item).

`eslint.config.mjs`: remove `src/lib/public-scan-quota.ts` (and its TODO comment) from the
grandfather list — the ratchet tightens.

## Out of scope

- The remaining grandfathered `@/lib/db/client` importers.
- Restricting barrel `withDb` usage outside the layer (peek/purge keep their current shape).
- Any behavior change to limits, fail-open policy, hashing, or the wire.

## Acceptance checks

- New `src/lib/db/scan-quota.test.ts`: (1) Postgres ⇒ `{ isolationLevel: Serializable }` reaches
  `$transaction`, DSQL ⇒ no options (the suite currently pinning this via consume moves down to
  this seam); (2) `decide` receives the stored raw hits; (3) a returned window is upserted on the
  same tx; (4) `hits: undefined` writes nothing; (5) the retry label is passed through.
- `src/lib/public-scan-quota.test.ts`'s consume/refund integration suites keep running through
  the REAL `transactPublicScanQuota` (via `vi.importActual`) against the in-memory fake store, so
  the end-to-end consume-then-refund window behavior stays pinned across the new seam.
- `npx tsc --noEmit` clean; both vitest files green; `npx eslint src/lib/public-scan-quota.ts`
  clean with the grandfather entry removed.

// Bounded-concurrency fan-out. The fleet scan paths (org/scan, org/import, cron/rescan) were each
// a strictly-serial `for ... await scanRepository(...)`, so a 40-repo run serialized into minutes of
// wall-clock dominated by network/LLM latency and risked the 300s function ceiling. mapPool runs at
// most `concurrency` operations in flight at once: wall-clock becomes ~ceil(n/lanes) × slowest, not
// the sum, while still capping pressure on GitHub and the LLM provider.

/**
 * Run `fn` over `items` with at most `concurrency` in flight, preserving result order.
 *
 * `fn` OWNS its errors — the fleet callers wrap each item's work in try/catch and emit a per-repo
 * event — so a thrown `fn` rejects the whole pool. Pass a never-throwing `fn` for fan-out where one
 * bad item must not abort the rest (the pattern every caller here uses).
 */
export async function mapPool<T, R>(
  items: readonly T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const n = items.length;
  const results = new Array<R>(n);
  if (n === 0) return results;
  const lanes = Math.max(1, Math.min(concurrency, n));
  let cursor = 0;
  async function worker(): Promise<void> {
    // JS is single-threaded, so `cursor++` between awaits is race-free — each lane claims the next
    // index and runs it to completion before claiming another.
    while (cursor < n) {
      const i = cursor++;
      results[i] = await fn(items[i]!, i); // safe: `i < n` (= items.length) guards the loop
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return results;
}

/** Default fleet-scan concurrency — bounded so a big watchlist doesn't hammer GitHub / the LLM. */
export const SCAN_CONCURRENCY = 4;

/**
 * Concurrency for the CONTROL PROBE lane (moonshot #10). Higher than SCAN_CONCURRENCY because a
 * probe is a different animal: ~3 REST calls and under two seconds, with no LLM provider behind it
 * and no credit at stake. The bound that matters here is GitHub's rate limit, not model throughput.
 */
export const PROBE_CONCURRENCY = 8;

// ── Deadline-aware fan-out ────────────────────────────────────────────────────────────────────────
// A fleet run does ALL of its work inside one invocation bounded by `maxDuration`. When the platform
// hits that ceiling it PROCESS-kills the function: no throw, no `finally`, no final SSE/JSON frame —
// so a run that scanned (and durably persisted) most of a fleet surfaces to the user as a generic
// transport failure. mapPoolUntilDeadline makes that boundary explicit: lanes stop CLAIMING NEW work
// once the remaining budget can no longer fit another item, leaving the caller enough time to emit an
// honest "ran out of time, N of M done, here's the remainder" frame.

/**
 * Wall-clock margin held back at the end of a deadline-bounded run so the caller can still finish its
 * epilogue (rollup write + the final frame) after the last lane drains. Deliberately generous: the
 * alternative to over-reserving is the silent process kill this whole mechanism exists to avoid.
 */
export const FLEET_FINALIZE_RESERVE_MS = 15_000;

/** The instant a fan-out must stop issuing new work, given the invocation start and its `maxDuration`. */
export function fleetDeadlineAt(invokedAt: number, maxDurationSec: number): number {
  return invokedAt + Math.max(0, maxDurationSec * 1000 - FLEET_FINALIZE_RESERVE_MS);
}

export interface DeadlinePoolResult<T> {
  /** Items no lane ever issued `fn` for, because the budget ran out. Empty on a complete run. */
  remaining: T[];
  /** Items `fn` was actually invoked for (completed or in-flight-then-completed). */
  attempted: number;
  /** True iff at least one item was left unissued by the deadline guard. */
  truncated: boolean;
}

/**
 * {@link mapPool} with a wall-clock deadline: identical lane/claim mechanics, but before a lane claims
 * the NEXT item it checks whether the slowest item OBSERVED SO FAR would still fit before `deadlineAt`.
 * If not, the lane stops; in-flight items always run to completion (never abandoned mid-scan — they may
 * already have debited a credit and started real inference).
 *
 * The estimate is measured, not guessed: `fn`'s own elapsed wall time per item, taking the WORST
 * observation as the projection (conservative — a fleet's slow repo is the one that overruns). Two
 * consequences are deliberate:
 *   • Nothing is ever truncated before at least one item has been attempted AND completed — with no
 *     observation there is no estimate, so the guard cannot fire.
 *   • A small/fast fleet is never stopped early: the guard only fires when the projection genuinely
 *     doesn't fit, and a run that issues every item reports `truncated: false`.
 *
 * `fn` OWNS its errors, exactly as in {@link mapPool} — a throw rejects the whole pool.
 */
export async function mapPoolUntilDeadline<T>(
  items: readonly T[],
  concurrency: number,
  deadlineAt: number,
  fn: (item: T, index: number) => Promise<void>,
  now: () => number = Date.now,
): Promise<DeadlinePoolResult<T>> {
  const n = items.length;
  if (n === 0) return { remaining: [], attempted: 0, truncated: false };
  const lanes = Math.max(1, Math.min(concurrency, n));
  let cursor = 0;
  let attempted = 0;
  let worstMs = 0; // slowest per-item wall time observed so far — the projection for the next item
  let observed = false; // no observation ⇒ no estimate ⇒ the guard cannot fire
  async function worker(): Promise<void> {
    while (cursor < n) {
      // Read the shared observation BEFORE claiming: `cursor` is only advanced for work we commit to.
      if (observed && now() + worstMs > deadlineAt) return;
      const i = cursor++;
      attempted += 1;
      const startedAt = now();
      try {
        await fn(items[i]!, i); // safe: `i < n` (= items.length) guards the loop
      } finally {
        const elapsed = now() - startedAt;
        if (elapsed > worstMs) worstMs = elapsed;
        observed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  // `cursor` is monotonic and only advanced by a lane that committed to the item, so everything from
  // `cursor` on was never issued — the exact remainder a continuation run should pick up.
  const remaining = items.slice(cursor);
  return { remaining, attempted, truncated: remaining.length > 0 };
}

// ── Deadline-aware DRAIN (supplier-driven) ────────────────────────────────────────────────────────
// mapPoolUntilDeadline walks an ARRAY the caller already has. A durable queue has no such array: the
// work is claimed one row at a time, and a claim can lose to another instance's worker, so the lane
// count is only knowable by asking. drainUntilDeadline is the same lane/deadline mechanics over a
// SUPPLIER — `supply()` returns the next claimed item or null when the queue is empty — which is why
// the two coexist rather than one wrapping the other.

export interface DrainPoolResult {
  /** Items `fn` was invoked for. */
  attempted: number;
  /**
   * True iff a lane stopped on the wall-clock BUDGET rather than on an empty supplier.
   *
   * Read it as "we stopped early", NOT as "N items were left behind": a supplier-driven drain cannot
   * know what is still queued without claiming it, and claiming a row it will not run would be worse
   * than not knowing. The honest remainder is a `queueDepth()` read by the caller after the drain —
   * which is also the only number that stays true when another instance is draining the same lane.
   */
  truncated: boolean;
}

/**
 * Claim-and-run until the queue is empty or the wall-clock budget is gone.
 *
 * Same measured projection as {@link mapPoolUntilDeadline}: the WORST per-item wall time observed so
 * far is the estimate for the next one, nothing can be truncated before at least one item completed
 * (with no observation there is no estimate), and in-flight items always run to completion — a probe
 * mid-write or a scan mid-inference is never abandoned.
 *
 * `supply` must be safe to call concurrently from every lane; the DB claim is what serializes it.
 * `fn` OWNS its errors, exactly as in {@link mapPool}.
 */
export async function drainUntilDeadline<T>(
  supply: () => Promise<T | null>,
  concurrency: number,
  deadlineAt: number,
  fn: (item: T) => Promise<void>,
  now: () => number = Date.now,
): Promise<DrainPoolResult> {
  const lanes = Math.max(1, concurrency);
  let attempted = 0;
  let worstMs = 0;
  let observed = false;
  let truncated = false;
  async function worker(): Promise<void> {
    for (;;) {
      if (observed && now() + worstMs > deadlineAt) {
        // Deliberately set BEFORE returning and never cleared: one lane running out of budget means
        // the drain stopped for time, which is exactly what the caller must report.
        truncated = true;
        return;
      }
      const item = await supply();
      if (item === null) return; // the queue is empty — not a truncation
      attempted += 1;
      const startedAt = now();
      try {
        await fn(item);
      } finally {
        const elapsed = now() - startedAt;
        if (elapsed > worstMs) worstMs = elapsed;
        observed = true;
      }
    }
  }
  await Promise.all(Array.from({ length: lanes }, () => worker()));
  return { attempted, truncated };
}

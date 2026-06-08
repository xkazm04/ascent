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

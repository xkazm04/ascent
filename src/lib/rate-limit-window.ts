// In-memory sliding windows and their bounded reaper. Request policy lives in rate-limit.ts.

const windows = new Map<string, number[]>();

// ---------------------------------------------------------------------------------------------
// THE REAPER: a declared cadence, a bounded sweep, and a metric.
//
// The old reclaim was `if (windows.size > 10_000) { for (const [k, v] of windows) ... }` on the
// ADMIT path. That has no cadence and no bound: once the map crosses the threshold, EVERY admitted
// request pays a full O(n) scan of a >10,000-entry map, and it only leaves that state once the scan
// drops the size back under the mark. A distributed source of unique keys (one per spoof-resistant
// IP is still one per real IP) therefore converts the limiter's own memory pressure into per-request
// latency exactly while it is under attack — it bounded the common case and amplified the hostile
// one.
//
// Replaced by an incremental sweep with three properties the old one lacked:
//   1. CADENCE — at most one sweep per SWEEP_INTERVAL_MS (shortened to SWEEP_INTERVAL_PRESSURE_MS
//      once the map is over KEY_PRESSURE_MARK), not once per request.
//   2. BOUND — each sweep inspects at most SWEEP_BUDGET entries (SWEEP_BUDGET_PRESSURE under
//      pressure) and RESUMES where the last one stopped via a live Map iterator, so a full pass over
//      any map size is amortised across sweeps and no single request ever pays O(n).
//   3. METRIC — `rateLimiterStats()` reports key count, peak, sweeps, entries scanned, evictions and
//      completed passes, so "the limiter is holding N keys and reclaiming M/s" is observable instead
//      of inferred from a memory graph.
//
// EVICTION SAFETY (the trap): dropping a key whose window still holds in-window hits RESETS that
// key's window, which is a way for an attacker to exceed the limit by forcing evictions. So the
// reaper only ever removes FULLY-AGED keys — those whose NEWEST hit is older than the widest window
// this process has actually charged (`maxWindowMs`, learned from real calls rather than assumed).
// A fully-aged key can only re-grant a full allowance, so removing it is state-free. The trade-off
// accepted: under sustained pressure the map can exceed KEY_PRESSURE_MARK, because over-retention
// (bounded memory growth, visible in `keys`/`peakKeys`) is the safe failure and under-counting is
// not. Never "evict the oldest to make room".
// ---------------------------------------------------------------------------------------------

/** Sweep no more often than this while the map is small — one every 10s reclaims a 60s window's
 *  worth of dead keys many times over without putting the reaper on the hot path. */
const SWEEP_INTERVAL_MS = 10_000;
/** Under pressure, sweep up to once a second: still a cadence, just a faster one. */
const SWEEP_INTERVAL_PRESSURE_MS = 1_000;
/** Entries inspected per sweep (each is one array-tail comparison). Bounds the per-request cost. */
const SWEEP_BUDGET = 256;
/** Larger budget once over KEY_PRESSURE_MARK — 4,096 × 1/s clears a 100k-key map in ~25s. */
const SWEEP_BUDGET_PRESSURE = 4_096;
/** The size at which the reaper switches to its pressure cadence/budget. Same 10,000 the old
 *  threshold used, but it now selects a *rate*, not "scan everything, every request". */
const KEY_PRESSURE_MARK = 10_000;

let lastSweepAt = 0;
/** Live iterator into `windows`, kept ACROSS sweeps so each one resumes instead of re-scanning the
 *  front of the map (a fresh iterator each tick would starve everything past SWEEP_BUDGET forever,
 *  because a surviving hot key holds its insertion position). Map iterators tolerate concurrent
 *  delete/insert, which is exactly what the limiter does between ticks. */
let sweepCursor: Iterator<[string, number[]]> | null = null;
/** Widest window any caller has actually charged. Eviction uses this rather than the current call's
 *  windowMs, because one key's window says nothing about another's; learning it keeps the reaper
 *  correct if a config with a longer window is added later (it retains longer — never shorter). */
let maxWindowMs = 0;

const stats = {
  sweeps: 0,
  scanned: 0,
  evicted: 0,
  /** Completed full passes over the map — the unit in which "everything dead has been reclaimed". */
  passes: 0,
  lastSweepAt: 0,
  peakKeys: 0,
};

/** Observable limiter state (item: the reaper needs a metric, not just a threshold). */
export function rateLimiterStats(): {
  keys: number;
  peakKeys: number;
  sweeps: number;
  scanned: number;
  evicted: number;
  passes: number;
  lastSweepAt: number;
  underPressure: boolean;
} {
  return {
    keys: windows.size,
    peakKeys: stats.peakKeys,
    sweeps: stats.sweeps,
    scanned: stats.scanned,
    evicted: stats.evicted,
    passes: stats.passes,
    lastSweepAt: stats.lastSweepAt,
    underPressure: windows.size > KEY_PRESSURE_MARK,
  };
}

/** One bounded, resumable reaper tick. Only fully-aged keys are removed (see EVICTION SAFETY). */
function sweep(now: number): void {
  lastSweepAt = now;
  stats.sweeps += 1;
  stats.lastSweepAt = now;
  const budget = windows.size > KEY_PRESSURE_MARK ? SWEEP_BUDGET_PRESSURE : SWEEP_BUDGET;
  const deadBefore = now - maxWindowMs;
  sweepCursor ??= windows.entries();
  for (let i = 0; i < budget; i += 1) {
    const next = sweepCursor.next();
    if (next.done) {
      sweepCursor = null;
      stats.passes += 1;
      break;
    }
    stats.scanned += 1;
    const [key, hits] = next.value;
    const newest = hits[hits.length - 1];
    if (newest == null || newest <= deadBefore) {
      windows.delete(key);
      stats.evicted += 1;
    }
  }
}

/** Cadence gate for the reaper; called once per charged request, sweeps far less often than that. */
function maybeSweep(now: number): void {
  if (windows.size > stats.peakKeys) stats.peakKeys = windows.size;
  const interval = windows.size > KEY_PRESSURE_MARK ? SWEEP_INTERVAL_PRESSURE_MS : SWEEP_INTERVAL_MS;
  if (now - lastSweepAt >= interval) sweep(now);
}

/** Test seam: drop all limiter state and counters (module-global by design; see the header). */
export function __resetRateLimiterState(): void {
  windows.clear();
  sweepCursor = null;
  lastSweepAt = 0;
  maxWindowMs = 0;
  stats.sweeps = 0;
  stats.scanned = 0;
  stats.evicted = 0;
  stats.passes = 0;
  stats.lastSweepAt = 0;
  stats.peakKeys = 0;
}

/**
 * Would a hit on `key` be admitted within `limit`/`windowMs`? Records NOTHING — it only trims the
 * aged-out entries it had to compute anyway.
 *
 * QUOTA #3: the check and the record are separate steps because a request can still be refused by a
 * LATER gate (the global ceiling, or the fail-closed "store unreachable" branch). A slot must be
 * spent only by a request that was actually SERVED, so callers check every gate first and record the
 * per-IP hit only on the admit path. See `rateLimitRequest`.
 */
export function checkWindow(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  if (windowMs > maxWindowMs) maxWindowMs = windowMs;
  maybeSweep(now);
  const recent = (windows.get(key) ?? []).filter((t) => t > cutoff);
  // SELF-PERPETUATION FIX: check the cap BEFORE recording. The old code pushed `now` UNCONDITIONALLY
  // and only then compared length, so every REJECTED request still entered the window and pushed
  // recent[0] forward. Once the ceiling tripped, ongoing under-per-IP traffic kept re-charging the
  // window with zero-cost rejected attempts, so a ~1s spike became a sustained full-window lockout
  // that never drained while legit traffic stayed ≥ limit/window. Now a rejected request is NOT
  // recorded: the window only ever holds ADMITTED requests, so it drains to real load and recovers on
  // schedule (the (limit+1)-th admitted request still trips, exactly as before — admit iff the count
  // BEFORE this hit is < limit, i.e. the post-push count would be ≤ limit).
  if (recent.length >= limit) {
    // Over cap → reject without recording. Persist the trimmed window (aged-out entries dropped, none
    // added). Sliding window: a slot frees when the OLDEST in-window hit ages out at recent[0] +
    // windowMs, not a fixed full-window wait — reporting windowMs unconditionally tells a caller whose
    // oldest hit expires in 2s to back off 60s (~30× too long). recent[0] exists whenever limit ≥ 1
    // (a real config); fall back to a 1s floor for the degenerate limit 0. Mirrors public-scan-quota.
    windows.set(key, recent);
    const oldest = recent[0];
    const retryAfterSec = oldest != null ? Math.max(1, Math.ceil((oldest + windowMs - now) / 1000)) : 1;
    return { ok: false, retryAfterSec };
  }
  // Persist the trimmed window (nothing added). An entry that trimmed to empty is dropped rather than
  // left as an empty array, so a check that ends in a refusal elsewhere leaves no residue for the
  // reaper to walk.
  if (recent.length) windows.set(key, recent);
  else windows.delete(key);
  return { ok: true, retryAfterSec: 0 };
}

/** Record one ADMITTED hit for `key`. Re-reads the window rather than reusing the array a preceding
 *  `checkWindow` trimmed, because the shared path awaits a network hop in between. */
export function recordHit(key: string, windowMs: number): void {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (windows.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  windows.set(key, recent);
}

/** Check `key` against `limit`/`windowMs` and record the hit iff it is admitted. The one-step form,
 *  used for the GLOBAL window (nothing can refuse after it). */
export function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const r = checkWindow(key, limit, windowMs);
  if (r.ok) recordHit(key, windowMs);
  return r;
}


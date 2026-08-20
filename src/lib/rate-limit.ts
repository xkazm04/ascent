// Sliding-window rate limiter for the public, unauthenticated funnel (/api/scan, /api/scan/stream,
// /api/org/import). Each entry is a per-key timestamp window.
//
// TWO HALVES, TWO SCOPES:
//   - PER-IP burst — always in-process (module-global Map below). A burst arrives over seconds and
//     is normally pinned to one instance; a per-instance burst cap is a real cap, and keeping it
//     local keeps the hot path synchronous and infrastructure-free.
//   - GLOBAL spend ceiling — the budget on paid-inference endpoints. In-process, its true value is
//     (instances × limit), which RISES with autoscaling — i.e. loosens exactly when abuse peaks. It
//     can therefore be backed by a SHARED store (see rate-limit-store.ts, `ASCENT_RATE_LIMIT_STORE`)
//     so every instance charges one budget. Because that store is a network hop, the shared path is
//     async: use `rateLimitRequestShared()`. `rateLimitRequest()` keeps the old synchronous
//     in-process behavior verbatim for callers that have not adopted it.
//
// STORE UNREACHABLE → FAIL CLOSED (default). Configuring a shared store is an explicit statement
// that the fleet needs ONE hard ceiling; silently degrading to in-memory on an outage restores the
// exact (instances × limit) hole the operator paid to close, on endpoints that spend real inference
// money per request. A rejected free scan is recoverable in a minute; a denial-of-wallet is not.
// Operators who prefer availability can set ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN=1 to degrade to the
// in-memory ceiling instead. Note the per-IP burst cap is in-memory and keeps working either way,
// so failing open is a bounded (not unlimited) degradation.
// (The badge route also uses this shared limiter via BADGE_RATE_LIMIT.)

import { sharedWindowStore, SHARED_STORE_BREAKER_MS } from "@/lib/rate-limit-store";

/**
 * TRUST MODEL (quotas-rate-limiting 07-16 #1): how many proxies between the client and this app are
 * trusted to append honest forwarding headers. The default (1) encodes the platform assumption this
 * module was built on — EXACTLY ONE well-behaved proxy (Vercel's edge) that strips/sets `x-real-ip`
 * and appends the real client to `x-forwarded-for`. On other deploy shapes that assumption breaks in
 * two opposite ways, so make it explicit via ASCENT_TRUSTED_PROXY_HOPS:
 *   - `0` — NO proxy is trusted (e.g. a self-hosted node behind a proxy that forwards client headers
 *     VERBATIM, where an attacker can mint a fresh `x-real-ip` per request and bypass every per-IP
 *     limit AND the 30-day quota). All forwarding headers are ignored; every anonymous caller shares
 *     one burst bucket (fail closed) and the monthly quota treats the caller as unidentifiable
 *     (fail open — see public-scan-quota's bucketContext) instead of trusting spoofable input.
 *   - `1` (default) — platform mode: `x-real-ip` first, then the RIGHT-most XFF hop.
 *   - `N >= 2` — an N-hop trusted chain (e.g. CDN → LB → app): the client is the Nth-from-the-right
 *     XFF entry (the right-most N−1 are the trusted proxies' own addresses — bucketing on those would
 *     collapse thousands of real users into a handful of edge IPs and lock the whole anonymous funnel
 *     out of the 30-day quota). `x-real-ip` is NOT trusted here: it was set by an intermediate hop and
 *     names the wrong peer. A chain shorter than N yields "unknown" (fail closed / unidentifiable).
 */
function trustedProxyHops(): number {
  const raw = process.env.ASCENT_TRUSTED_PROXY_HOPS?.trim();
  if (!raw) return 1;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : 1;
}

/**
 * Best-effort client IP under the configured trust model (see trustedProxyHops). The LEFT-most
 * X-Forwarded-For entry is client-supplied (spoofable to a fresh bucket per request), so only the
 * hop appended by the innermost TRUSTED proxy is used; unidentifiable callers fall back to a single
 * shared "unknown" bucket so they are limited COLLECTIVELY (fail closed), never per spoofed value.
 */
export function clientIp(req: Request): string {
  const trusted = trustedProxyHops();
  if (trusted === 0) return "unknown"; // no trusted proxy — every forwarding header is attacker-writable
  if (trusted === 1) {
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    const idx = hops.length - trusted; // Nth from the right = appended by the outermost trusted proxy
    if (idx >= 0 && hops.length) return hops[idx]!;
  }
  return "unknown";
}

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

/** Record a hit for `key` and report whether it is now over `limit` within `windowMs`. */
function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
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
  recent.push(now);
  windows.set(key, recent);
  return { ok: true, retryAfterSec: 0 };
}

/**
 * How the numbers in a `RateLimitConfig` were arrived at. Declared per entry and REQUIRED, so a new
 * limit cannot be added without answering the question.
 *
 * - `"derived"` — the ceiling is COMPUTED from a stated client cadence, and the comment above the
 *   entry shows the multiplication. A reader can re-run the arithmetic when the client changes
 *   (`INGEST_RATE_LIMIT` in src/lib/integrations/ingest-guard.ts is the reference example: export
 *   interval → pushes/minute/machine → seats behind one egress IP → per-IP floor).
 * - `"inherited"` — the number was chosen, matched to a previous bespoke limit, or carried forward.
 *   The comment above it may show what cadence the value CLEARS (a headroom check), but that is not
 *   the same as the value having been derived, and it must not be dressed up as one.
 *
 * Why this exists: an operator tuning limits under load has to know which numbers are load-bearing
 * and which are inherited, or they tune the wrong one first. Reverse-engineering a plausible
 * derivation from an existing number is the failure mode this label prevents — it would entrench an
 * arbitrary value under the appearance of arithmetic. Promoting `"inherited"` to `"derived"` is
 * therefore a real change: it means someone measured the client and rewrote the number.
 */
export type LimitBasis = "derived" | "inherited";

export interface RateLimitConfig {
  /** Namespace so different endpoints don't share a budget (e.g. "scan", "org-import"). */
  name: string;
  /** Max requests per IP per window. */
  perIp: number;
  /**
   * Max requests across ALL callers per window — the spend ceiling. Per-instance via
   * `rateLimitRequest`, fleet-wide via `rateLimitRequestShared` with a shared store configured.
   */
  global: number;
  /** Window length in ms. */
  windowMs: number;
  /** Whether `perIp`/`global` were computed from a client cadence or merely inherited. See LimitBasis. */
  basis: LimitBasis;
}

/**
 * Which layer refused. A caller that is told only "429" cannot separate the two cases that need
 * OPPOSITE responses: `"ip"` is fixed by slowing down, `"global"` is not fixable by the caller at
 * all (someone else is spending the shared budget) and retrying harder just walks into a wall.
 * `"unavailable"` is neither — no limit was evaluated (see `evaluated`).
 */
export type RateLimitScope = "ip" | "global" | "unavailable";

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  /** Which window refused; absent when `ok`. */
  scope?: RateLimitScope;
  /** Limiter namespace that refused (e.g. "scan"), so a caller behind several gates knows which one. */
  limiter?: string;
  /**
   * The ceiling that refused and the window it applies to — populated ONLY for `scope: "ip"`, i.e.
   * the caller's OWN budget, which it can already measure by counting its own requests. The GLOBAL
   * ceiling is deliberately NOT echoed: publishing it (or the remaining headroom) tells an attacker
   * exactly how much traffic it takes to exhaust the instance budget and how close they are. Global
   * refusals are named coarsely, by scope only.
   */
  limit?: number;
  windowSec?: number;
  /**
   * False when the refusal was NOT the result of evaluating a limit — today only the fail-closed
   * path when the shared store is unreachable. Such a refusal has no honest retry-after to give:
   * nothing was counted, so no window is draining. See `rateLimitRequestShared`.
   */
  evaluated?: boolean;
}

/**
 * Check (and record) a request against both a per-IP and a global window. Trips when EITHER is
 * exceeded.
 *
 * QUOTA #1: a request that is over its PER-IP cap must NOT consume the shared global budget. Charge
 * the per-IP window first; if it's over cap, reject WITHOUT touching the global window. Only when
 * per-IP passes do we charge the global window — its overshoot is real shared load, not one IP's
 * rejected flood. This keeps one abuser (contained by its own per-IP cap) from becoming the lever to
 * DoS everyone via the shared pool.
 *
 * QUOTA #2 (self-perpetuation): hit() now checks the cap BEFORE recording, so a request rejected by
 * EITHER window is never written into that window. A brief spike that fills the global ceiling
 * therefore drains on schedule instead of being kept saturated by the very requests it rejects — a
 * 1s overload no longer escalates into a sustained instance-wide 429 lockout under normal follow-on
 * traffic. (A per-IP-rejected request still never reaches the global window, per QUOTA #1.)
 */
export function rateLimitRequest(req: Request, cfg: RateLimitConfig): RateLimitResult {
  const ip = clientIp(req);
  const p = hit(`${cfg.name}:ip:${ip}`, cfg.perIp, cfg.windowMs);
  if (!p.ok) return perIpRefusal(cfg, p.retryAfterSec);
  const g = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
  if (g.ok) return { ok: true, retryAfterSec: 0 };
  return globalRefusal(cfg, g.retryAfterSec);
}

/** A refusal by the caller's OWN budget: fully named, because the caller can act on it. */
function perIpRefusal(cfg: RateLimitConfig, retryAfterSec: number): RateLimitResult {
  return {
    ok: false,
    retryAfterSec,
    scope: "ip",
    limiter: cfg.name,
    limit: cfg.perIp,
    windowSec: Math.max(1, Math.round(cfg.windowMs / 1000)),
    evaluated: true,
  };
}

/** A refusal by the SHARED budget: named coarsely on purpose — no limit, no remaining (see
 *  RateLimitResult.limit). The caller still learns the one fact that changes its behaviour: this is
 *  not your traffic, so slowing down may not clear it. */
function globalRefusal(cfg: RateLimitConfig, retryAfterSec: number): RateLimitResult {
  return { ok: false, retryAfterSec, scope: "global", limiter: cfg.name, evaluated: true };
}

function sharedFailOpen(): boolean {
  const raw = process.env.ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/**
 * Cross-instance variant of `rateLimitRequest`: per-IP burst is charged in-process exactly as
 * before (synchronously, no network), and the GLOBAL ceiling is charged against the shared store
 * when one is configured — so a fleet of N instances shares ONE budget instead of N.
 *
 * QUOTA #1 still holds: a request already over its per-IP cap is rejected WITHOUT touching the
 * global window (or the store), so one abuser can't spend everyone's budget on its own rejections.
 *
 * With no store configured (the default, and every test/dev run) this is byte-for-byte the
 * in-memory behavior of `rateLimitRequest`, just wrapped in a resolved promise.
 *
 * When the store IS configured but unreachable, the result is a 429 (fail closed) unless
 * ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN is set, in which case the in-memory ceiling takes over. See
 * the file header for the reasoning.
 */
export async function rateLimitRequestShared(req: Request, cfg: RateLimitConfig): Promise<RateLimitResult> {
  const ip = clientIp(req);
  const p = hit(`${cfg.name}:ip:${ip}`, cfg.perIp, cfg.windowMs);
  if (!p.ok) return perIpRefusal(cfg, p.retryAfterSec);

  const store = sharedWindowStore();
  if (!store) {
    const g = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
    return g.ok ? { ok: true, retryAfterSec: 0 } : globalRefusal(cfg, g.retryAfterSec);
  }

  const g = await store.hit(`ascent:rl:${cfg.name}:__global__`, cfg.global, cfg.windowMs);
  if (g) return g.ok ? { ok: true, retryAfterSec: 0 } : globalRefusal(cfg, g.retryAfterSec);

  if (sharedFailOpen()) {
    const local = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
    return local.ok ? { ok: true, retryAfterSec: 0 } : globalRefusal(cfg, local.retryAfterSec);
  }
  // Fail closed — and say so honestly. NO LIMIT WAS EVALUATED here: the store never answered, so
  // nothing was counted and no window is draining. The old code returned one full window (60s),
  // which is the shape of a real drain estimate and reads to a client as "the budget is full for a
  // minute" — a refusal dressed up as a measurement. The only quantity that is actually known is
  // when the limiter can next produce a real answer: the driver's breaker re-probes the store after
  // SHARED_STORE_BREAKER_MS, so that is what we advertise, with `evaluated: false` and
  // `scope: "unavailable"` so the caller can tell an outage from its own overuse. Trade-off: a
  // shorter Retry-After means clients come back sooner during a store outage; that is bounded by
  // the per-IP burst cap, which is in-memory and still enforced.
  return {
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil(SHARED_STORE_BREAKER_MS / 1000)),
    scope: "unavailable",
    limiter: cfg.name,
    evaluated: false,
  };
}

/**
 * Shared 429 JSON response builder (G8-29): every quota/rate-limit gate in this codebase returns the
 * same status + content-type, so that construction is single-sourced here. The BODY and any headers
 * beyond content-type are NOT flattened to a common shape — the per-minute rate limiter and the
 * monthly public-scan quota (src/lib/public-scan-quota.ts's monthlyQuotaExceeded) are genuinely
 * different responses: the monthly gate's body carries `code`/`remaining`/`resetAt`/`scope` for the
 * client meter to parse, and its headers add `x-ascent-quota-*` fields the rate limiter has no
 * equivalent for. Callers supply their own body and headers; this only fixes the status + content-type.
 */
export function tooManyResponse(body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 429,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

/**
 * A ready-made 429 JSON Response.
 *
 * A REFUSAL MUST NAME ITSELF. The old body was prose plus `retry-after` and nothing else, so a
 * caller could not tell "you exceeded YOUR per-IP budget" (fix: slow down) from "the shared budget
 * for this endpoint is exhausted by someone else" (not fixable by the caller — retrying is walking
 * into a wall) from "the limiter could not run at all" (nothing was counted). A CI integration got
 * an unactionable failure in all three cases. Pass the whole `RateLimitResult` and the body/headers
 * name the limit, the window and the layer that refused — the same shape the monthly quota gate
 * already returns next door (public-scan-quota's `monthlyQuotaExceeded`: code/scope/retry + headers).
 *
 * WHAT IS DELIBERATELY WITHHELD: the global ceiling's value and its remaining headroom. Echoing them
 * would hand an attacker the exact size of the instance budget and a live "how close am I" meter, so
 * a global refusal is named coarsely — by scope only. The per-IP ceiling is safe to state: the caller
 * can count its own requests anyway.
 *
 * The `number` overload is the legacy call shape (still used by route handlers that pass
 * `rl.retryAfterSec`). It keeps the old prose exactly, so those routes are unchanged until they are
 * switched to pass the result object.
 */
export function tooManyRequests(result: number | RateLimitResult): Response {
  if (typeof result === "number") {
    return tooManyResponse(
      { error: "Rate limit exceeded. Please slow down and try again shortly.", code: "rate_limited" },
      { "retry-after": String(result) },
    );
  }

  const retryAfter = String(result.retryAfterSec);
  const limiter = result.limiter ?? "request";

  if (result.scope === "unavailable") {
    // Not a limit refusal: the shared limiter store never answered, so this request was refused
    // conservatively (fail closed) without any budget being consumed or exceeded. Saying so keeps
    // an operator from hunting for the caller's "overuse" during someone else's outage.
    return tooManyResponse(
      {
        error:
          "Rate limit could not be evaluated: the shared limiter is temporarily unreachable, so this request was refused conservatively. No budget of yours was exceeded — retry shortly.",
        code: "rate_limit_unavailable",
        scope: "unavailable",
        limiter,
        evaluated: false,
        retryAfterSec: result.retryAfterSec,
      },
      { "retry-after": retryAfter, "x-ascent-ratelimit-scope": "unavailable" },
    );
  }

  if (result.scope === "global") {
    return tooManyResponse(
      {
        error:
          `Rate limit exceeded: the service-wide budget for '${limiter}' is currently exhausted. This is not caused by your traffic alone, so slowing down may not clear it — retry after the stated delay.`,
        code: "rate_limited",
        scope: "global",
        limiter,
        retryAfterSec: result.retryAfterSec,
      },
      { "retry-after": retryAfter, "x-ascent-ratelimit-scope": "global" },
    );
  }

  const limit = result.limit;
  const windowSec = result.windowSec;
  const named =
    limit != null && windowSec != null
      ? `your budget of ${limit} request${limit === 1 ? "" : "s"} per ${windowSec}s for '${limiter}'`
      : `your budget for '${limiter}'`;
  return tooManyResponse(
    {
      error: `Rate limit exceeded: you have used ${named}. Slow down and retry after the stated delay.`,
      code: "rate_limited",
      scope: "ip",
      limiter,
      ...(limit != null ? { limit } : {}),
      ...(windowSec != null ? { windowSec } : {}),
      retryAfterSec: result.retryAfterSec,
    },
    {
      "retry-after": retryAfter,
      "x-ascent-ratelimit-scope": "ip",
      ...(limit != null ? { "x-ascent-ratelimit-limit": String(limit) } : {}),
      ...(windowSec != null ? { "x-ascent-ratelimit-window": String(windowSec) } : {}),
    },
  );
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// EVERY BUDGET BELOW IS `basis: "inherited"`. Each was chosen from a cost/abuse argument, not
// computed from a measured client cadence, and none may be promoted to "derived" without someone
// actually measuring the client and rewriting the number (see LimitBasis). What the comments DO now
// carry is the recomputation aid: the call pattern each number CLEARS, so a future reader whose
// client changed can check whether the floor still fits instead of re-arguing the limit from
// scratch. The one genuinely derived limit in the codebase is INGEST_RATE_LIMIT
// (src/lib/integrations/ingest-guard.ts) — the reference shape for what "derived" means here.

// A single uncached scan = a GitHub ingest + an LLM completion (real $), so per-IP is generous for
// a human but caps a script, and `global` is the per-instance spend ceiling. Env-overridable.
// CLEARS: a human driving the public funnel by hand starts at most a few scans a minute (a scan
// takes ~10-30s to read), so 20/min/IP leaves ~an order of magnitude of headroom over manual use
// while cutting a script off within seconds. The 120/min global is 6 IPs at full per-IP burst.
// NOT DERIVED: neither number came from a measured cadence — 20 and 120 were picked as "generous for
// a human, cheap enough to lose". Tune `global` first; it is the money ceiling.
export const SCAN_RATE_LIMIT: RateLimitConfig = {
  name: "scan",
  perIp: envInt("RATE_LIMIT_SCAN_PER_IP", 20),
  global: envInt("RATE_LIMIT_SCAN_GLOBAL", 120),
  windowMs: 60_000,
  basis: "inherited",
};

// The /report cache-only "peek" probe (cheap hydration before a live scan) is light PER request, but it
// still spends one GitHub head request against the operator PAT for a never-before-seen repo plus 1-2 DB
// reads, then returns 204 — so an anonymous client looping distinct repo URLs is a no-cost amplification
// lever on the shared GitHub budget. Throttle it on its OWN generous budget (well above the full-scan cap
// so real hydration never trips) and WITHOUT consuming the monthly free-scan quota. Env-overridable.
// CLEARS: one peek per report view. 60/min/IP is 3x the full-scan per-IP cap it front-runs, so the
// hydrate-then-scan path can never trip peek before scan.
// NOT DERIVED: 60/600 is a round multiple of the scan budget, not a measured report-view rate.
export const PEEK_RATE_LIMIT: RateLimitConfig = {
  name: "scan-peek",
  perIp: envInt("RATE_LIMIT_PEEK_PER_IP", 60),
  global: envInt("RATE_LIMIT_PEEK_GLOBAL", 600),
  windowMs: 60_000,
  basis: "inherited",
};

// GET /api/quota was the ONE public endpoint with no limiter: each anonymous request runs auth
// resolution (getViewer) plus a per-request DB read with `no-store` (no CDN absorption), and the
// client meter re-fires it on every focus/visibility/pageshow — so a trivial loop turned the free
// funnel's cheapest endpoint into a DB-read amplifier (Aurora DSQL bills per request). Same
// "read-only is not free" rationale as PEEK above; generous so tab-switch storms never trip for a
// human, and the meter tolerates a 429 (keeps its last state). Env-overridable.
// CLEARS: the meter fires once per focus/visibility/pageshow, so 60/min/IP tolerates a tab switch
// every second for a full minute — past any human, and exceeding it costs the user nothing.
// NOT DERIVED: no focus-event rate was ever measured; 60/600 was copied from PEEK above.
export const QUOTA_PEEK_RATE_LIMIT: RateLimitConfig = {
  name: "quota-peek",
  perIp: envInt("RATE_LIMIT_QUOTA_PEEK_PER_IP", 60),
  global: envInt("RATE_LIMIT_QUOTA_PEEK_GLOBAL", 600),
  windowMs: 60_000,
  basis: "inherited",
};

// Org import bulk-scans up to 100 repos per call — far more expensive, so limit it harder.
// CLEARS: an operator imports an org once and then waits for the batch; 3/min/IP allows the first
// call plus two corrections (wrong org, wrong filter). Note what the per-IP cap really admits at
// 100 repos/call: up to 300 repo scans per minute from ONE IP — which is why the global is only 5x it.
// NOT DERIVED: 3 and 15 are judgement calls about operator behaviour, not a measured import rate.
export const ORG_IMPORT_RATE_LIMIT: RateLimitConfig = {
  name: "org-import",
  perIp: envInt("RATE_LIMIT_ORG_IMPORT_PER_IP", 3),
  global: envInt("RATE_LIMIT_ORG_IMPORT_GLOBAL", 15),
  windowMs: 60_000,
  basis: "inherited",
};

// The CI gate endpoint runs a FULL GitHub repo ingest + a head-resolve against the operator PAT on
// EVERY request — even in its default (mock) mode, which only swaps the LLM provider, not the network
// I/O. So an unauthenticated flood of the default path is the same denial-of-wallet vector as the
// real-LLM path. The ?mock=0 path keeps the stricter SCAN_RATE_LIMIT. Env-overridable.
// CLEARS: real CI calls this ~once per PR event, so 60/min/IP clears an org pushing up to 60
// gate-triggering PR events per minute through ONE egress IP (1 call/event x 60 events/min) —
// ~3,600/hour, against the tens-to-low-hundreds per DAY a large mono-org actually produces.
// THE MULTIPLICATION THAT BREAKS IT: if a CI action starts POLLING the gate instead of calling it
// once per event, redo this — at one poll per 10s per open PR (6/min/PR), 60/min/IP is exhausted by
// 10 concurrent PRs behind one egress IP, which is an ordinary Monday, not an attack.
// NOT DERIVED: the ~1-call-per-PR-event cadence is real, but 60 was not computed from it — it is the
// same round 60/600 used by PEEK and BADGE.
export const GATE_RATE_LIMIT: RateLimitConfig = {
  name: "gate",
  perIp: envInt("RATE_LIMIT_GATE_PER_IP", 60),
  global: envInt("RATE_LIMIT_GATE_GLOBAL", 600),
  windowMs: 60_000,
  basis: "inherited",
};

// The Custom-plan enquiry form (POST /api/plan-enquiry) is unauthenticated, writes a DB row, and sends
// mail through the operator's provider on every accepted call — so an unthrottled loop is both a spam
// cannon aimed at one inbox and a way to burn a metered send quota (Resend's free tier is a few thousand
// a month). Env-overridable.
// CLEARS: a human submits this once, plus at most a couple of corrections after a typo — 1 + 2 = 3,
// which is where the per-IP number comes from. The global ceiling bounds a distributed flood the
// per-IP cap can't see: 30/min is ~43k mails/day worst case against a send quota of a few thousand a
// month, so it is a backstop that still needs the provider's own quota behind it, not a budget.
// NOT DERIVED as a whole: the per-IP 3 does follow from the stated human cadence, but the global 30
// is a round number, not (offices x 3). Promote this entry only when BOTH halves are computed.
export const CONTACT_RATE_LIMIT: RateLimitConfig = {
  name: "contact",
  perIp: envInt("RATE_LIMIT_CONTACT_PER_IP", 3),
  global: envInt("RATE_LIMIT_CONTACT_GLOBAL", 30),
  windowMs: 60_000,
  basis: "inherited",
};

// The public README badge is hammered by crawlers/READMEs; the limit gates only the EXPENSIVE
// cache-miss scan (a cheap static badge is still returned). Env-overridable.
// INHERITED, AND THE CLEAREST CASE OF IT: nobody computed this budget. The 60/min/IP was "matched to
// the badge route's previous bespoke 60/min/IP" when the route adopted the shared limiter, and the
// 600 global was filled in to match its neighbours — yet it sits in the same list, in the same shape,
// and so reads with the same authority as a limit somebody argued for. That is precisely what the
// `basis` field is for: an operator tuning under load can see this one is inherited and may be moved
// with far less argument than a derived ceiling.
// A REAL derivation would start from badge impressions per minute on a busy README times the
// cache-miss rate; neither has been measured, so do NOT write one — see LimitBasis.
export const BADGE_RATE_LIMIT: RateLimitConfig = {
  name: "badge",
  perIp: envInt("RATE_LIMIT_BADGE_PER_IP", 60),
  global: envInt("RATE_LIMIT_BADGE_GLOBAL", 600),
  windowMs: 60_000,
  basis: "inherited",
};

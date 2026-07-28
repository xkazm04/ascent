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

import { sharedWindowStore } from "@/lib/rate-limit-store";

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

/** Record a hit for `key` and report whether it is now over `limit` within `windowMs`. */
function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
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
  // Opportunistic cleanup so the map can't grow unbounded across many keys.
  if (windows.size > 10_000) {
    for (const [k, v] of windows) if (v.every((t) => t <= cutoff)) windows.delete(k);
  }
  return { ok: true, retryAfterSec: 0 };
}

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
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
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
  if (!p.ok) return { ok: false, retryAfterSec: p.retryAfterSec };
  const g = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
  if (g.ok) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: g.retryAfterSec };
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
  if (!p.ok) return { ok: false, retryAfterSec: p.retryAfterSec };

  const store = sharedWindowStore();
  if (!store) {
    const g = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
    return g.ok ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: g.retryAfterSec };
  }

  const g = await store.hit(`ascent:rl:${cfg.name}:__global__`, cfg.global, cfg.windowMs);
  if (g) return g.ok ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: g.retryAfterSec };

  if (sharedFailOpen()) {
    const local = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
    return local.ok ? { ok: true, retryAfterSec: 0 } : { ok: false, retryAfterSec: local.retryAfterSec };
  }
  // Fail closed. Retry-After is one window: the store's state is unknown, so there is no honest
  // shorter estimate, and the breaker in the driver retries the store within a few seconds anyway.
  return { ok: false, retryAfterSec: Math.max(1, Math.ceil(cfg.windowMs / 1000)) };
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

/** A ready-made 429 JSON Response with a Retry-After header. */
export function tooManyRequests(retryAfterSec: number): Response {
  return tooManyResponse(
    { error: "Rate limit exceeded — please slow down and try again shortly." },
    { "retry-after": String(retryAfterSec) },
  );
}

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

// A single uncached scan = a GitHub ingest + an LLM completion (real $), so per-IP is generous for
// a human but caps a script, and `global` is the per-instance spend ceiling. Env-overridable.
export const SCAN_RATE_LIMIT: RateLimitConfig = {
  name: "scan",
  perIp: envInt("RATE_LIMIT_SCAN_PER_IP", 20),
  global: envInt("RATE_LIMIT_SCAN_GLOBAL", 120),
  windowMs: 60_000,
};

// The /report cache-only "peek" probe (cheap hydration before a live scan) is light PER request, but it
// still spends one GitHub head request against the operator PAT for a never-before-seen repo plus 1-2 DB
// reads, then returns 204 — so an anonymous client looping distinct repo URLs is a no-cost amplification
// lever on the shared GitHub budget. Throttle it on its OWN generous budget (well above the full-scan cap
// so real hydration never trips) and WITHOUT consuming the monthly free-scan quota. Env-overridable.
export const PEEK_RATE_LIMIT: RateLimitConfig = {
  name: "scan-peek",
  perIp: envInt("RATE_LIMIT_PEEK_PER_IP", 60),
  global: envInt("RATE_LIMIT_PEEK_GLOBAL", 600),
  windowMs: 60_000,
};

// GET /api/quota was the ONE public endpoint with no limiter: each anonymous request runs auth
// resolution (getViewer) plus a per-request DB read with `no-store` (no CDN absorption), and the
// client meter re-fires it on every focus/visibility/pageshow — so a trivial loop turned the free
// funnel's cheapest endpoint into a DB-read amplifier (Aurora DSQL bills per request). Same
// "read-only is not free" rationale as PEEK above; generous so tab-switch storms never trip for a
// human, and the meter tolerates a 429 (keeps its last state). Env-overridable.
export const QUOTA_PEEK_RATE_LIMIT: RateLimitConfig = {
  name: "quota-peek",
  perIp: envInt("RATE_LIMIT_QUOTA_PEEK_PER_IP", 60),
  global: envInt("RATE_LIMIT_QUOTA_PEEK_GLOBAL", 600),
  windowMs: 60_000,
};

// Org import bulk-scans up to 100 repos per call — far more expensive, so limit it harder.
export const ORG_IMPORT_RATE_LIMIT: RateLimitConfig = {
  name: "org-import",
  perIp: envInt("RATE_LIMIT_ORG_IMPORT_PER_IP", 3),
  global: envInt("RATE_LIMIT_ORG_IMPORT_GLOBAL", 15),
  windowMs: 60_000,
};

// The CI gate endpoint runs a FULL GitHub repo ingest + a head-resolve against the operator PAT on
// EVERY request — even in its default (mock) mode, which only swaps the LLM provider, not the network
// I/O. So an unauthenticated flood of the default path is the same denial-of-wallet vector as the
// real-LLM path. Real CI calls this ~once per PR event, so this budget is generous per-IP (a busy
// mono-org behind one egress IP) with a per-instance global ceiling; the ?mock=0 path keeps the
// stricter SCAN_RATE_LIMIT. Env-overridable.
export const GATE_RATE_LIMIT: RateLimitConfig = {
  name: "gate",
  perIp: envInt("RATE_LIMIT_GATE_PER_IP", 60),
  global: envInt("RATE_LIMIT_GATE_GLOBAL", 600),
  windowMs: 60_000,
};

// The public README badge is hammered by crawlers/READMEs; the limit gates only the EXPENSIVE
// cache-miss scan (a cheap static badge is still returned). Generous per-IP for a busy README, with a
// per-instance global ceiling. Matches the badge route's previous bespoke 60/min/IP. Env-overridable.
export const BADGE_RATE_LIMIT: RateLimitConfig = {
  name: "badge",
  perIp: envInt("RATE_LIMIT_BADGE_PER_IP", 60),
  global: envInt("RATE_LIMIT_BADGE_GLOBAL", 600),
  windowMs: 60_000,
};

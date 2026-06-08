// Shared in-memory sliding-window rate limiter for the public, unauthenticated funnel
// (/api/scan, /api/scan/stream, /api/org/import). Each entry is a per-key timestamp window.
//
// SCOPE / LIMITATION: state is a module-global Map, so it is PER SERVER INSTANCE. On a
// multi-instance / serverless deployment each instance keeps its own window, so the effective
// global limit is (instances × limit). This is a cost-control BACKSTOP against a single abusive
// client hammering an expensive LLM scan, not a precise distributed quota — for a hard
// cross-instance limit, back it with Redis/Upstash (see docs/PRODUCTION_READINESS.md, Wave 2).
// (The badge route ships its own copy of this pattern; this module generalizes it for the
//  scan/import endpoints that previously had NO limiter at all.)

/**
 * Best-effort client IP. The LEFT-most X-Forwarded-For entry is client-supplied (spoofable to a
 * fresh bucket per request), so trust the platform's real-client header first, then the RIGHT-most
 * (trusted-proxy-appended) XFF hop, and finally fall back to a single shared bucket so
 * unidentifiable callers are limited COLLECTIVELY (fail closed), never per spoofed value.
 */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const hops = fwd.split(",").map((s) => s.trim()).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
  }
  return "unknown";
}

const windows = new Map<string, number[]>();

/** Record a hit for `key` and report whether it is now over `limit` within `windowMs`. */
function hit(key: string, limit: number, windowMs: number): { ok: boolean; retryAfterSec: number } {
  const now = Date.now();
  const cutoff = now - windowMs;
  const recent = (windows.get(key) ?? []).filter((t) => t > cutoff);
  recent.push(now);
  windows.set(key, recent);
  // Opportunistic cleanup so the map can't grow unbounded across many keys.
  if (windows.size > 10_000) {
    for (const [k, v] of windows) if (v.every((t) => t <= cutoff)) windows.delete(k);
  }
  const ok = recent.length <= limit;
  return { ok, retryAfterSec: ok ? 0 : Math.ceil(windowMs / 1000) };
}

export interface RateLimitConfig {
  /** Namespace so different endpoints don't share a budget (e.g. "scan", "org-import"). */
  name: string;
  /** Max requests per IP per window. */
  perIp: number;
  /** Max requests across ALL callers per window (a per-instance spend ceiling). */
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
 * exceeded. Counts the request in both windows so the numbers stay honest.
 */
export function rateLimitRequest(req: Request, cfg: RateLimitConfig): RateLimitResult {
  const ip = clientIp(req);
  const g = hit(`${cfg.name}:__global__`, cfg.global, cfg.windowMs);
  const p = hit(`${cfg.name}:ip:${ip}`, cfg.perIp, cfg.windowMs);
  if (g.ok && p.ok) return { ok: true, retryAfterSec: 0 };
  return { ok: false, retryAfterSec: Math.max(g.retryAfterSec, p.retryAfterSec) };
}

/** A ready-made 429 JSON Response with a Retry-After header. */
export function tooManyRequests(retryAfterSec: number): Response {
  return new Response(
    JSON.stringify({ error: "Rate limit exceeded — please slow down and try again shortly." }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(retryAfterSec),
      },
    },
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

// Org import bulk-scans up to 100 repos per call — far more expensive, so limit it harder.
export const ORG_IMPORT_RATE_LIMIT: RateLimitConfig = {
  name: "org-import",
  perIp: envInt("RATE_LIMIT_ORG_IMPORT_PER_IP", 3),
  global: envInt("RATE_LIMIT_ORG_IMPORT_GLOBAL", 15),
  windowMs: 60_000,
};

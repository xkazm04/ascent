// The ONE limiter charge pipeline. `rateLimitRequest`, `rateLimitKeyed` and `rateLimitRequestShared`
// (rate-limit.ts) are thin wrappers over it, so the QUOTA rules have a single implementation instead of
// one for the sync doors and an inline copy for the shared one.
//
// THE FLOW (limiter topology: consume atomically across layers - reserve, charge, commit or release):
//   1. reserve the caller's slot (synchronously, in-process). Over cap -> refuse "ip"; nothing reserved,
//      the global window is never touched (QUOTA #1).
//   2. charge the global ceiling: the in-memory window, or the shared store when one is configured.
//   3. admitted -> the reservation stands as the served request's hit.
//      global refused, or store unreachable -> RELEASE the reservation (QUOTA #3) and refuse.
//
// WHY RESERVE BEFORE THE AWAIT. The old shared path CHECKED the per-IP window, awaited the store, and
// only then recorded the hit. Every same-IP request arriving during that network hop saw the pre-burst
// count, so a script firing its requests in parallel passed the per-IP cap wholesale and could spend
// the fleet's global budget on its own, which is the exact lever QUOTA #1 exists to remove. Taking the
// slot first makes the cap hold however many requests are in flight.
//
// EVERY REFUSAL IS COUNTED HERE, once, on its own series (refusal contract), named by its predicate:
//   - ("rate_limit", "<limiter>")         the caller's own budget refused
//   - ("rate_limit", "<limiter>:global")  the shared budget refused (not the caller's traffic alone)
//   - ("rate_limit_unavailable", "<limiter>")  the shared store never answered: NO limit was evaluated,
//     nothing was counted, so it is an outage, not abuse, and stays off the /usage abuse panel.
// Routes must not add their own count next to a limiter call: it would double-count
// (rate-limit-charge.sites.test.ts bans it).

import { sharedWindowStore, SHARED_STORE_BREAKER_MS } from "@/lib/rate-limit-store";
import { hit, releaseHit, reserveHit } from "@/lib/rate-limit-window";
import { recordQuotaEvent } from "@/lib/db/quota-events";
import type { RateLimitConfig, RateLimitResult } from "@/lib/rate-limit";

const ADMIT: RateLimitResult = { ok: true, retryAfterSec: 0 };

/** Fire-and-forget refusal tally. `recordQuotaEvent` swallows its own store errors; the catch covers a
 *  rejected promise so a telemetry failure can never change a limiter verdict. */
function countRefusal(cfg: RateLimitConfig, r: RateLimitResult): RateLimitResult {
  if (r.scope === "unavailable") {
    void recordQuotaEvent("rate_limit_unavailable", cfg.name).catch(() => {});
  } else {
    const series = r.scope === "global" ? `${cfg.name}:global` : cfg.name;
    void recordQuotaEvent("rate_limit", series).catch(() => {});
  }
  return r;
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

/** A refusal by the SHARED budget: named coarsely on purpose - no limit, no remaining (see
 *  RateLimitResult.limit). The caller still learns the one fact that changes its behaviour: this is
 *  not your traffic, so slowing down may not clear it. */
function globalRefusal(cfg: RateLimitConfig, retryAfterSec: number): RateLimitResult {
  return { ok: false, retryAfterSec, scope: "global", limiter: cfg.name, evaluated: true };
}

/**
 * Fail closed, and say so honestly. NO LIMIT WAS EVALUATED: the store never answered, so nothing was
 * counted and no window is draining. A full window (60s) would be the shape of a real drain estimate and
 * read as "the budget is full for a minute", a refusal dressed up as a measurement. The only quantity
 * actually known is when the limiter can next produce a real answer: the driver's breaker re-probes the
 * store after SHARED_STORE_BREAKER_MS, so that is what is advertised, with `evaluated: false` and
 * `scope: "unavailable"` so the caller can tell an outage from its own overuse. Trade-off: a shorter
 * Retry-After brings clients back sooner during an outage; that is bounded by the per-IP burst cap,
 * which is in-memory and still enforced. The caller's reservation is released (QUOTA #3), so
 * `evaluated: false` ("no budget of yours was exceeded") is literally true.
 */
function unavailableRefusal(cfg: RateLimitConfig): RateLimitResult {
  return {
    ok: false,
    retryAfterSec: Math.max(1, Math.ceil(SHARED_STORE_BREAKER_MS / 1000)),
    scope: "unavailable",
    limiter: cfg.name,
    evaluated: false,
  };
}

function sharedFailOpen(): boolean {
  const raw = process.env.ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

/** In-memory global ceiling key: per-instance. */
const localGlobalKey = (cfg: RateLimitConfig) => `${cfg.name}:__global__`;

/** Steps 2-3 against the in-memory global window: commit the reservation or release it. */
function settleLocal(callerKey: string, token: number, cfg: RateLimitConfig): RateLimitResult {
  const g = hit(localGlobalKey(cfg), cfg.global, cfg.windowMs);
  if (g.ok) return ADMIT;
  releaseHit(callerKey, token); // served nothing -> charge nothing per-caller (QUOTA #3)
  return countRefusal(cfg, globalRefusal(cfg, g.retryAfterSec));
}

/** The synchronous pipeline: per-caller reservation + in-memory global ceiling. `callerKey` is already
 *  namespaced by the entry point (`<limiter>:ip:<addr>` or `<limiter>:key:<id>`). */
export function chargeSync(callerKey: string, cfg: RateLimitConfig): RateLimitResult {
  const r = reserveHit(callerKey, cfg.perIp, cfg.windowMs);
  if (!r.ok) return countRefusal(cfg, perIpRefusal(cfg, r.retryAfterSec));
  return settleLocal(callerKey, r.token, cfg);
}

/**
 * The same pipeline with the global ceiling charged against the SHARED store when one is configured.
 * The reservation happens before the first await, so the per-caller cap holds under concurrency. With
 * no store configured there is no await at all and this is exactly `chargeSync`.
 *
 * Store unreachable: fail closed (the default) unless ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN is set, in
 * which case the in-memory ceiling takes over. See the rate-limit.ts header for the reasoning.
 */
export async function chargeShared(callerKey: string, cfg: RateLimitConfig): Promise<RateLimitResult> {
  const r = reserveHit(callerKey, cfg.perIp, cfg.windowMs);
  if (!r.ok) return countRefusal(cfg, perIpRefusal(cfg, r.retryAfterSec));

  const store = sharedWindowStore();
  if (!store) return settleLocal(callerKey, r.token, cfg);

  const g = await store.hit(`ascent:rl:${cfg.name}:__global__`, cfg.global, cfg.windowMs);
  if (g) {
    if (g.ok) return ADMIT;
    releaseHit(callerKey, r.token);
    return countRefusal(cfg, globalRefusal(cfg, g.retryAfterSec));
  }
  // Degraded but SERVED when the in-memory ceiling admits, so the reservation stands exactly as on the
  // healthy path.
  if (sharedFailOpen()) return settleLocal(callerKey, r.token, cfg);
  releaseHit(callerKey, r.token);
  return countRefusal(cfg, unavailableRefusal(cfg));
}

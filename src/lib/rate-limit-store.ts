// Shared (cross-instance) sliding-window store for the GLOBAL half of the rate limiter.
//
// WHY: `rate-limit.ts` keeps its windows in a module-global Map — per PROCESS. Per-IP burst
// windows are fine that way (an abusive client is usually pinned to one instance for the length of
// a burst, and a per-instance burst cap is still a real cap). The GLOBAL window is not: it is the
// spend ceiling on paid-inference endpoints (/api/scan, /api/scan/stream, /api/org/import), and on
// a horizontally-scaled deployment the effective ceiling becomes `instances × limit` — it RISES
// with autoscaling, i.e. exactly when abuse is at its worst. This module gives that half a store
// every instance shares.
//
// NO NEW DEPENDENCY: nothing Redis/Upstash/KV-shaped is in package.json, and adding a client for
// five commands is not worth the supply-chain and bundle cost. The Upstash driver below is a thin
// `fetch` against its REST `/pipeline` endpoint — the same wire protocol its SDK speaks.
//
// DEFAULT IS IN-MEMORY: with no store configured, `sharedWindowStore()` returns null and the
// limiter uses its existing in-process window verbatim. Local dev and tests need no infrastructure.

/** Outcome of charging one hit against a shared window. */
export interface SharedWindowHit {
  /** True when this hit was admitted (and recorded). */
  ok: boolean;
  /** Seconds until the oldest in-window hit ages out (only meaningful when `ok` is false). */
  retryAfterSec: number;
}

/**
 * A shared sliding-window counter. Implementations MUST behave like the in-memory `hit()` in
 * `rate-limit.ts`: check the cap BEFORE recording, so a rejected request never re-charges the
 * window (otherwise a brief spike becomes a self-perpetuating lockout).
 *
 * `hit()` resolves to `null` when the store is UNREACHABLE — the caller decides what an
 * unreachable store means (see ASCENT_RATE_LIMIT_SHARED_FAIL_OPEN in `rate-limit.ts`). It must
 * never throw and never hang: a limiter that blocks is worse than one that is wrong.
 */
export interface SharedWindowStore {
  readonly kind: string;
  hit(key: string, limit: number, windowMs: number): Promise<SharedWindowHit | null>;
}

/** Hard ceiling on how long a limiter check may wait on the store before giving up. */
const STORE_TIMEOUT_MS = 1_500;

/**
 * After a failure, stop probing for this long. Without it, an outage costs every request a full
 * STORE_TIMEOUT_MS wait and the pile-up of in-flight checks becomes its own outage. Kept SHORT
 * because under the default (fail-closed) policy an open breaker rejects traffic — a few seconds of
 * over-rejection is the price of not stalling, and recovery is automatic.
 */
const BREAKER_MS = 3_000;

function upstashConfig(): { url: string; token: string } | null {
  const url = process.env.UPSTASH_REDIS_REST_URL?.trim();
  const token = process.env.UPSTASH_REDIS_REST_TOKEN?.trim();
  if (!url || !token) return null;
  return { url: url.replace(/\/+$/, ""), token };
}

type PipelineReply = { result?: unknown; error?: string };

/**
 * Upstash Redis over its REST `/pipeline` endpoint. The window is a sorted set keyed by the
 * limiter key, scored by timestamp — the same sliding shape as the in-memory version.
 *
 * ONE blocking round trip on the admit path: trim aged-out members, add this hit, read the size
 * and the oldest member. Adding BEFORE reading the size is what makes the count atomic against
 * concurrent instances (a read-then-write pair would race and admit over the cap). When the
 * post-add count is over the cap the hit is un-recorded with a fire-and-forget ZREM, restoring the
 * "only admitted requests are in the window" invariant; the compensating delete is not awaited
 * because the caller already has its answer and a lost ZREM only makes the window drain one slot
 * later.
 */
export function createUpstashStore(url: string, token: string): SharedWindowStore {
  let breakerUntil = 0;

  async function pipeline(commands: (string | number)[][], signal?: AbortSignal): Promise<PipelineReply[]> {
    const res = await fetch(`${url}/pipeline`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(commands),
      cache: "no-store",
      signal,
    });
    if (!res.ok) throw new Error(`upstash ${res.status}`);
    const json = (await res.json()) as PipelineReply[];
    if (!Array.isArray(json)) throw new Error("upstash: malformed pipeline reply");
    return json;
  }

  return {
    kind: "upstash",
    async hit(key, limit, windowMs) {
      if (Date.now() < breakerUntil) return null; // open breaker — don't pay the timeout again
      const now = Date.now();
      const cutoff = now - windowMs;
      const member = `${now}-${Math.random().toString(36).slice(2, 10)}`;
      try {
        const replies = await pipeline(
          [
            ["ZREMRANGEBYSCORE", key, "0", String(cutoff)],
            ["ZADD", key, String(now), member],
            ["ZCARD", key],
            ["ZRANGE", key, "0", "0", "WITHSCORES"],
            ["PEXPIRE", key, String(windowMs + 1_000)],
          ],
          AbortSignal.timeout(STORE_TIMEOUT_MS),
        );
        const failed = replies.find((r) => r?.error);
        if (failed) throw new Error(failed.error);
        const count = Number(replies[2]?.result);
        if (!Number.isFinite(count)) throw new Error("upstash: non-numeric ZCARD");
        // Admit iff the count BEFORE this hit was under the cap, i.e. the post-add count is ≤ limit.
        if (count <= limit) return { ok: true, retryAfterSec: 0 };
        void pipeline([["ZREM", key, member]]).catch(() => {}); // un-record the rejected hit
        const oldestRaw = (replies[3]?.result as unknown[] | undefined)?.[1];
        const oldest = Number(oldestRaw);
        const retryAfterSec = Number.isFinite(oldest)
          ? Math.max(1, Math.ceil((oldest + windowMs - now) / 1000))
          : Math.max(1, Math.ceil(windowMs / 1000));
        return { ok: false, retryAfterSec };
      } catch {
        breakerUntil = Date.now() + BREAKER_MS;
        return null; // UNREACHABLE — policy lives with the caller, not here
      }
    },
  };
}

let cached: SharedWindowStore | null | undefined;
let override: SharedWindowStore | null | undefined;

/**
 * The configured shared store, or null for the in-memory default.
 *
 * `ASCENT_RATE_LIMIT_STORE` selects the driver: `memory` (default, = null) or `upstash`. `upstash`
 * additionally needs `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`; if either is missing the
 * flag is treated as unset (in-memory) rather than failing every request at boot — a misconfigured
 * env var must not take the public funnel down, and the in-memory backstop still applies.
 */
export function sharedWindowStore(): SharedWindowStore | null {
  if (override !== undefined) return override;
  if (cached !== undefined) return cached;
  const kind = process.env.ASCENT_RATE_LIMIT_STORE?.trim().toLowerCase();
  if (kind === "upstash") {
    const cfg = upstashConfig();
    cached = cfg ? createUpstashStore(cfg.url, cfg.token) : null;
  } else {
    cached = null;
  }
  return cached;
}

/** Test seam: force a store (or `null` for in-memory); pass `undefined` to restore env resolution. */
export function __setSharedWindowStore(store: SharedWindowStore | null | undefined): void {
  override = store;
  cached = undefined;
}

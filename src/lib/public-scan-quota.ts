// Soft WEEKLY quota for anonymous public scans — a persistent, per-IP allowance on top of the
// per-minute in-memory burst limiter (src/lib/rate-limit.ts). A single public scan = a GitHub
// ingest + an LLM completion (real $), and the public funnel is free + no-signup, so without a
// longer-horizon cap a casual user (or a cheap script) can graze indefinitely. This caps that at N
// scans per rolling 7-day window per client IP.
//
// DESIGN / LIMITATIONS (intentional, soft gate):
//   - Persistent + cross-instance (Prisma), because a week-long window CANNOT live in the
//     per-instance, restart-volatile in-memory limiter — there it would reset on every cold start.
//   - The IP is stored as a SALTED SHA-256 HASH, never the raw value (no PII at rest).
//   - Knowingly attackable: an attacker can rotate IPs to mint fresh buckets, and CGNAT/shared NAT
//     makes many users share one bucket. That's accepted — this is a friction/cost nudge, not a
//     security control. The burst limiter remains the per-request abuse backstop.
//   - FAILS OPEN: enforced only when persistence is configured, and any store error lets the scan
//     proceed (a quota hiccup must never take down the free funnel).
//
// Applies to ANONYMOUS PUBLIC scans only (orgSlug === "public", no installation token, non-mock) —
// private/org scans are metered by prepaid credits (src/lib/entitlement.ts) and skip this entirely.

import { createHash } from "node:crypto";
import { clientIp } from "@/lib/rate-limit";
import { isDbConfigured, withDb, withRetry } from "@/lib/db";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Max free public scans per IP per rolling 7-day window. Env-overridable; default 3. */
export function publicScanWeeklyLimit(): number {
  const n = Number(process.env.PUBLIC_SCAN_WEEKLY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

/** Kill switch — set PUBLIC_SCAN_QUOTA_DISABLED=1 to turn the weekly gate off (dev / incident). */
export function publicScanQuotaDisabled(): boolean {
  const v = process.env.PUBLIC_SCAN_QUOTA_DISABLED;
  return v === "1" || v === "true";
}

/**
 * Salted SHA-256 of the client IP, hex. The salt (PUBLIC_SCAN_QUOTA_SALT) makes the stored hashes
 * non-reversible without it; a fixed fallback keeps the gate working out of the box (it's a soft
 * gate, not a secret), but production should set a real salt so buckets aren't predictable.
 */
export function hashIp(ip: string): string {
  const salt = process.env.PUBLIC_SCAN_QUOTA_SALT?.trim() || "ascent-public-scan-quota";
  return createHash("sha256").update(`${salt}:${ip}`).digest("hex");
}

/** Parse the stored JSON number[] of hit timestamps, tolerating null/garbage as an empty window. */
export function parseHits(raw: string | null | undefined): number[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((t): t is number => typeof t === "number" && Number.isFinite(t)) : [];
  } catch {
    return [];
  }
}

export interface QuotaDecision {
  allowed: boolean;
  /** Free scans left in the window AFTER counting this one (0 when denied). */
  remaining: number;
  /** Epoch-ms when the next slot frees (oldest in-window hit ages past the week); null if unknown. */
  resetAt: number | null;
  /** The trimmed window to persist — includes `now` when allowed, unchanged when denied. */
  hits: number[];
}

/**
 * Pure rolling-window decision: given prior hit timestamps, decide whether a new scan at `now` is
 * allowed under `limit`. Trims hits older than 7 days. Exported (and unit-tested) independently of
 * the DB so the window math is verifiable without a database.
 */
export function decideQuota(prior: number[], now: number, limit: number): QuotaDecision {
  const cutoff = now - WEEK_MS;
  const recent = prior.filter((t) => t > cutoff).sort((a, b) => a - b);
  if (recent.length >= limit) {
    // Denied: the oldest in-window hit must age past the week before a slot frees.
    return { allowed: false, remaining: 0, resetAt: recent[0]! + WEEK_MS, hits: recent };
  }
  const hits = [...recent, now];
  // The window resets (back to a full allowance) when the OLDEST current hit ages out.
  const resetAt = hits[0]! + WEEK_MS;
  return { allowed: true, remaining: Math.max(0, limit - hits.length), resetAt, hits };
}

export interface QuotaResult {
  /** False when the gate isn't active (DB unconfigured / disabled / store error) — caller proceeds. */
  enforced: boolean;
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
  resetAt: number | null;
}

function retryAfterSec(resetAt: number | null, now: number): number {
  if (!resetAt) return Math.ceil(WEEK_MS / 1000);
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/**
 * Check the weekly quota for the request's client IP and, when allowed, CONSUME one slot (record the
 * hit). Read-modify-write under withRetry so concurrent scans from the same IP serialize cleanly on
 * DSQL's optimistic concurrency. Returns `enforced: false` (allow) when persistence is unconfigured,
 * the gate is disabled, or the store errors — the free funnel never fails because the quota store did.
 */
export async function consumePublicScanQuota(req: Request): Promise<QuotaResult> {
  const limit = publicScanWeeklyLimit();
  if (!isDbConfigured() || publicScanQuotaDisabled()) {
    return { enforced: false, allowed: true, remaining: limit, retryAfterSec: 0, resetAt: null };
  }

  const ipHash = hashIp(clientIp(req));
  const now = Date.now();
  try {
    return await withDb((db) =>
      withRetry(
        async () => {
          const row = await db.publicScanQuota.findUnique({ where: { ipHash } });
          const decision = decideQuota(parseHits(row?.hits), now, limit);
          if (!decision.allowed) {
            return {
              enforced: true,
              allowed: false,
              remaining: 0,
              retryAfterSec: retryAfterSec(decision.resetAt, now),
              resetAt: decision.resetAt,
            };
          }
          const hits = JSON.stringify(decision.hits);
          await db.publicScanQuota.upsert({
            where: { ipHash },
            create: { ipHash, hits },
            update: { hits },
          });
          return {
            enforced: true,
            allowed: true,
            remaining: decision.remaining,
            retryAfterSec: 0,
            resetAt: decision.resetAt,
          };
        },
        { label: "public-scan-quota" },
      ),
    );
  } catch (err) {
    // Soft gate: a quota-store failure must not block a scan the user is entitled to. Fail OPEN.
    console.error("[public-scan-quota] check failed; failing open", err);
    return { enforced: false, allowed: true, remaining: limit, retryAfterSec: 0, resetAt: null };
  }
}

/** A ready-made 429 JSON Response for a tripped weekly quota, with Retry-After + quota headers. */
export function weeklyQuotaExceeded(result: QuotaResult): Response {
  return new Response(
    JSON.stringify({
      error:
        "You've used all your free public scans for this week. Please try again once the weekly window resets.",
      code: "weekly_quota",
      remaining: 0,
      resetAt: result.resetAt,
    }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(result.retryAfterSec),
        "x-ascent-quota-remaining": "0",
        ...(result.resetAt ? { "x-ascent-quota-reset": String(result.resetAt) } : {}),
      },
    },
  );
}

/**
 * Delete PublicScanQuota rows whose entire window has aged out (no hit newer than 7 days) — they can
 * only re-grant a full allowance, so they carry no state. Called by the retention purge job so the
 * table can't grow unbounded across the IP space. Best-effort; returns the count removed (0 when
 * persistence is disabled). Batched delete via the row's updatedAt (bumped on every write).
 */
export async function purgeStalePublicScanQuota(now: number = Date.now()): Promise<number> {
  if (!isDbConfigured()) return 0;
  const cutoff = new Date(now - WEEK_MS);
  return withDb(async (db) => {
    const res = await withRetry(
      () => db.publicScanQuota.deleteMany({ where: { updatedAt: { lt: cutoff } } }),
      { label: "public-scan-quota-purge" },
    );
    return res.count;
  });
}

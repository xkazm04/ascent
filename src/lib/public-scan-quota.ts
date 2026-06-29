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
import { Prisma } from "@prisma/client";
import { clientIp } from "@/lib/rate-limit";
import { envBool } from "@/lib/env";
import { isDbConfigured, withDb, withRetry } from "@/lib/db";
import { readDsqlConfig } from "@/lib/db/client";
import { recordQuotaEvent } from "@/lib/db/quota-events";

/**
 * Isolation for the quota's read-modify-write transactions. Vanilla Postgres defaults to READ
 * COMMITTED, where two concurrent consumers both read the same window and the last upsert silently
 * wins (lost update — no error is ever raised, so withRetry never fires); SERIALIZABLE makes one of
 * the racers abort with a 40001 that withRetry retries. Aurora DSQL runs snapshot OCC natively and
 * does not accept explicit isolation levels — its commit-time write-write conflict on the shared
 * row already aborts the loser with a retryable OC### error, so pass no option there.
 */
function quotaTxOptions(): { isolationLevel: Prisma.TransactionIsolationLevel } | undefined {
  return readDsqlConfig()
    ? undefined
    : { isolationLevel: Prisma.TransactionIsolationLevel.Serializable };
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Max free public scans per ANONYMOUS IP per rolling 7-day window. Env-overridable; default 3. */
export function publicScanWeeklyLimit(): number {
  const n = Number(process.env.PUBLIC_SCAN_WEEKLY_LIMIT);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 3;
}

/**
 * Elevated weekly allowance for a SIGNED-IN viewer — the reward for authenticating. Keyed per-user
 * (IP-independent) rather than per-IP, so a signed-in user gets their own bucket. Env-overridable;
 * default 20. Clamped to be no lower than the anonymous limit (signing in must never grant *less*).
 */
export function signedInScanWeeklyLimit(): number {
  const n = Number(process.env.PUBLIC_SCAN_WEEKLY_LIMIT_SIGNED_IN);
  const elevated = Number.isFinite(n) && n > 0 ? Math.floor(n) : 20;
  return Math.max(elevated, publicScanWeeklyLimit());
}

/** Kill switch — set PUBLIC_SCAN_QUOTA_DISABLED=1 to turn the weekly gate off (dev / incident). */
export function publicScanQuotaDisabled(): boolean {
  return envBool("PUBLIC_SCAN_QUOTA_DISABLED");
}

/**
 * Salted SHA-256 of a bucket key, hex. The salt (PUBLIC_SCAN_QUOTA_SALT) makes the stored hashes
 * non-reversible without it; a fixed fallback keeps the gate working out of the box (it's a soft
 * gate, not a secret), but production should set a real salt so buckets aren't predictable. The key
 * carries a namespace prefix ("ip:" / "u:") so an IP bucket and a user bucket can never collide.
 */
export function hashKey(value: string): string {
  const salt = process.env.PUBLIC_SCAN_QUOTA_SALT?.trim() || "ascent-public-scan-quota";
  return createHash("sha256").update(`${salt}:${value}`).digest("hex");
}

/** Anonymous bucket key for a client IP. */
export function hashIp(ip: string): string {
  return hashKey(`ip:${ip}`);
}

/**
 * Resolve the quota bucket for this request+identity — the SINGLE place that derives the bucket key.
 * Consume, peek, and refund must all compute the IDENTICAL `ipHash` (a refund against a different key
 * than the consume would leak a slot), so they all route through here: signed-in viewers bucket
 * per-USER (`u:` namespace, IP-independent) at the elevated limit, anonymous callers bucket per-IP
 * (`ip:` namespace). The two namespaces keep the key spaces disjoint.
 */
function bucketContext(
  req: Request,
  identity: QuotaIdentity,
): { signedIn: boolean; ipHash: string; scope: "anon" | "user"; identifiable: boolean } {
  const signedIn = Boolean(identity.viewerId);
  if (signedIn) {
    return { signedIn, ipHash: hashKey(`u:${identity.viewerId}`), scope: "user", identifiable: true };
  }
  // An anonymous caller whose client IP can't be resolved (clientIp -> "unknown": no x-real-ip /
  // x-forwarded-for, e.g. a mis-set reverse proxy or direct origin) would otherwise hash into ONE
  // shared bucket with every other unidentifiable visitor. The per-minute burst limiter treats that
  // shared fallback as fail-CLOSED (correct for a short window), but for this 7-day low-N quota the
  // same shared bucket would lock the ENTIRE public funnel for a week after N scans. Flag it so the
  // weekly gate fails OPEN instead of charging a collective bucket (the burst limiter stays the backstop).
  const ip = clientIp(req);
  return { signedIn, ipHash: hashIp(ip), scope: "anon", identifiable: ip !== "unknown" };
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
 * Pure rolling-window read, WITHOUT consuming a slot: trim hits older than 7 days, sort ascending,
 * and derive the non-consuming `{ remaining, resetAt }` plus the trimmed `recent` window. The single
 * source for the window trim + `resetAt` arithmetic that `decideQuota` (consuming) and
 * `peekPublicScanQuota` (read-only) both build on.
 */
export function windowState(
  prior: number[],
  now: number,
  limit: number,
): { recent: number[]; remaining: number; resetAt: number | null } {
  const cutoff = now - WEEK_MS;
  const recent = prior.filter((t) => t > cutoff).sort((a, b) => a - b);
  const remaining = Math.max(0, limit - recent.length);
  // The window resets (a slot frees) when the OLDEST in-window hit ages out; null when empty.
  const resetAt = recent.length ? recent[0]! + WEEK_MS : null;
  return { recent, remaining, resetAt };
}

/**
 * Pure rolling-window decision: given prior hit timestamps, decide whether a new scan at `now` is
 * allowed under `limit`. Trims hits older than 7 days. Exported (and unit-tested) independently of
 * the DB so the window math is verifiable without a database.
 */
export function decideQuota(prior: number[], now: number, limit: number): QuotaDecision {
  const { recent } = windowState(prior, now, limit);
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
  /** True when this scan was counted against a SIGNED-IN viewer's (elevated, per-user) allowance. */
  signedIn: boolean;
  /** The exact hit timestamp this call recorded (when allowed + enforced), else null. Pass it back to
   *  refundPublicScanQuota so a refund removes THE slot this request charged — not merely "the newest"
   *  in the bucket, which two concurrent refunds on a shared/coalesced scan would each peel off a
   *  different sibling's slot (double-refund → quota under-count → free-scan bypass). */
  chargedAt: number | null;
}

/** Who the scan is attributed to. A signed-in viewer id buckets per-user at the elevated limit; */
/** absent, it falls back to the per-IP anonymous bucket and limit. */
export interface QuotaIdentity {
  viewerId?: string | null;
}

function retryAfterSec(resetAt: number | null, now: number): number {
  if (!resetAt) return Math.ceil(WEEK_MS / 1000);
  return Math.max(1, Math.ceil((resetAt - now) / 1000));
}

/**
 * Check the weekly quota for the request's client IP and, when allowed, CONSUME one slot (record the
 * hit). The read-decide-write runs inside ONE interactive transaction (see quotaTxOptions) so two
 * concurrent consumers of the same bucket genuinely conflict — one aborts with a serialization error
 * that withRetry retries against the updated window. (As separate statements each auto-committed,
 * neither Postgres nor DSQL would ever raise a conflict and parallel clients could overrun the gate.)
 * Returns `enforced: false` (allow) when persistence is unconfigured, the gate is disabled, or the
 * store errors — the free funnel never fails because the quota store did.
 */
export async function consumePublicScanQuota(
  req: Request,
  identity: QuotaIdentity = {},
): Promise<QuotaResult> {
  const { signedIn, ipHash, identifiable } = bucketContext(req, identity);
  const limit = signedIn ? signedInScanWeeklyLimit() : publicScanWeeklyLimit();
  // Fail OPEN when the gate isn't active OR the anonymous caller has no resolvable IP (see bucketContext):
  // charging a shared "unknown" bucket would lock the whole public funnel on a benign proxy misconfig.
  if (!isDbConfigured() || publicScanQuotaDisabled() || !identifiable) {
    return { enforced: false, allowed: true, remaining: limit, retryAfterSec: 0, resetAt: null, signedIn, chargedAt: null };
  }

  const now = Date.now();
  try {
    const result = await withDb((db) =>
      withRetry(
        () =>
          db.$transaction(async (tx) => {
            const row = await tx.publicScanQuota.findUnique({ where: { ipHash } });
            const decision = decideQuota(parseHits(row?.hits), now, limit);
            if (!decision.allowed) {
              return {
                enforced: true,
                allowed: false,
                remaining: 0,
                retryAfterSec: retryAfterSec(decision.resetAt, now),
                resetAt: decision.resetAt,
                signedIn,
                chargedAt: null,
              };
            }
            const hits = JSON.stringify(decision.hits);
            await tx.publicScanQuota.upsert({
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
              signedIn,
              chargedAt: now,
            };
          }, quotaTxOptions()),
        { label: "public-scan-quota" },
      ),
    );
    // QUOTA-6: count an enforced denial (fire-and-forget, after the tx — never inside it).
    if (result.enforced && !result.allowed) {
      void recordQuotaEvent("quota_deny", signedIn ? "user" : "anon").catch(() => {});
    }
    return result;
  } catch (err) {
    // Soft gate: a quota-store failure must not block a scan the user is entitled to. Fail OPEN.
    console.error("[public-scan-quota] check failed; failing open", err);
    return { enforced: false, allowed: true, remaining: limit, retryAfterSec: 0, resetAt: null, signedIn, chargedAt: null };
  }
}

export interface QuotaPeek {
  /** False when the gate isn't active (DB unconfigured / disabled / store error). */
  enforced: boolean;
  /** Scans left in the current window WITHOUT consuming one. */
  remaining: number;
  limit: number;
  resetAt: number | null;
  scope: "anon" | "user";
}

/**
 * Read-only quota check — how many free scans are left for this caller, WITHOUT consuming a slot
 * (the read-only sibling of consumePublicScanQuota). Powers a "scans left this week" meter shown
 * BEFORE the user commits to a scan. Fails open (returns the full limit) when persistence is
 * unconfigured / disabled / errors, exactly like consume.
 */
export async function peekPublicScanQuota(req: Request, identity: QuotaIdentity = {}): Promise<QuotaPeek> {
  const { signedIn, ipHash, scope, identifiable } = bucketContext(req, identity);
  const limit = signedIn ? signedInScanWeeklyLimit() : publicScanWeeklyLimit();
  // Fail open (report the full allowance) when the gate is inactive OR the anonymous caller has no
  // resolvable IP — consume fails open for the same caller, so the meter must match (see bucketContext).
  if (!isDbConfigured() || publicScanQuotaDisabled() || !identifiable) {
    return { enforced: false, remaining: limit, limit, resetAt: null, scope };
  }
  const now = Date.now();
  try {
    return await withDb(async (db) => {
      const row = await db.publicScanQuota.findUnique({ where: { ipHash } });
      const { remaining, resetAt } = windowState(parseHits(row?.hits), now, limit);
      return { enforced: true, remaining, limit, resetAt, scope };
    });
  } catch (err) {
    console.error("[public-scan-quota] peek failed; reporting full allowance", err);
    return { enforced: false, remaining: limit, limit, resetAt: null, scope };
  }
}

/**
 * Pure: drop the single NEWEST hit from a window — the one `consumePublicScanQuota` just appended.
 * Exported (and unit-tested) independently of the DB, like `decideQuota`. Removes exactly one entry
 * even when timestamps collide (two consumes in the same millisecond).
 */
export function removeNewestHit(hits: number[]): number[] {
  if (hits.length === 0) return hits;
  const newest = Math.max(...hits);
  const idx = hits.indexOf(newest);
  return [...hits.slice(0, idx), ...hits.slice(idx + 1)];
}

/**
 * Pure: drop the SINGLE hit equal to `ts` — the exact timestamp `consumePublicScanQuota` recorded for
 * this request. Idempotent: if `ts` isn't present (already refunded, or aged out), the window is
 * returned unchanged. This is the value-keyed refund that fixes the double-refund race — two refunds
 * against the same bucket each remove only their OWN charge, never a sibling's still-live slot.
 */
export function removeHit(hits: number[], ts: number): number[] {
  const idx = hits.indexOf(ts);
  if (idx === -1) return hits;
  return [...hits.slice(0, idx), ...hits.slice(idx + 1)];
}

/**
 * REFUND the slot a just-allowed `consumePublicScanQuota` recorded — the free tier meters on
 * commit, not attempt (the same policy as credit metering: a dedup or degrade-to-mock run is
 * free). Called when the scan delivered nothing chargeable: an invalid/404 repo, an upstream
 * failure, a client abort, an in-stream cache hit, or an LLM degrade-to-mock. Recomputes the
 * bucket key exactly as consume does, drops the newest hit, and writes the window back.
 * Best-effort and FAIL-OPEN like the rest of this module: a refund hiccup just leaves one slot
 * consumed (soft gate); it never fails the response. Quota headers emitted at consume time may
 * overstate usage by the one refunded slot — acceptable staleness for a soft gate.
 *
 * Pass `chargedAt` (the `QuotaResult.chargedAt` from the matching consume) so the refund removes the
 * EXACT slot this request charged. Without it the refund falls back to "drop the newest hit", which two
 * concurrent refunds on a shared/coalesced scan use to each peel off a different sibling's slot —
 * removing more slots than were consumed and bypassing the weekly budget (CRITICAL race).
 */
export async function refundPublicScanQuota(
  req: Request,
  identity: QuotaIdentity = {},
  chargedAt?: number | null,
): Promise<void> {
  if (!isDbConfigured() || publicScanQuotaDisabled()) return;
  const { ipHash, identifiable } = bucketContext(req, identity);
  // An unidentifiable anonymous caller failed OPEN at consume time (no slot was charged), so there is
  // nothing to refund — and operating on the shared "unknown" bucket could peel a slot off another path.
  if (!identifiable) return;
  try {
    await withDb((db) =>
      withRetry(
        // Same one-transaction read-modify-write as consume (see quotaTxOptions): a refund racing
        // a concurrent consume must not silently drop the consume's freshly-recorded hit.
        () =>
          db.$transaction(async (tx) => {
            const row = await tx.publicScanQuota.findUnique({ where: { ipHash } });
            const prior = parseHits(row?.hits);
            if (!row || prior.length === 0) return;
            // Value-keyed when we know the exact charged timestamp (idempotent if already absent);
            // legacy "drop newest" only when a caller didn't thread it through.
            const next = typeof chargedAt === "number" ? removeHit(prior, chargedAt) : removeNewestHit(prior);
            await tx.publicScanQuota.update({
              where: { ipHash },
              data: { hits: JSON.stringify(next) },
            });
          }, quotaTxOptions()),
        { label: "public-scan-quota-refund" },
      ),
    );
  } catch (err) {
    // Soft gate: losing a refund only costs the caller one slot — never fail the response over it.
    console.error("[public-scan-quota] refund failed; slot stays consumed", err);
  }
}

/** A ready-made 429 JSON Response for a tripped weekly quota, with Retry-After + quota headers. */
export function weeklyQuotaExceeded(result: QuotaResult): Response {
  const scope = result.signedIn ? "user" : "anon";
  // Anonymous callers can lift the limit by signing in (per-user elevated bucket); signed-in
  // callers have already used their elevated allowance, so the message just points at the reset.
  const error = result.signedIn
    ? "You've used all your free public scans for this week. Please try again once the weekly window resets."
    : "You've used all your free public scans for this week. Sign in for a higher weekly limit, or try again once the window resets.";
  return new Response(
    JSON.stringify({ error, code: "weekly_quota", remaining: 0, resetAt: result.resetAt, scope }),
    {
      status: 429,
      headers: {
        "content-type": "application/json; charset=utf-8",
        "retry-after": String(result.retryAfterSec),
        "x-ascent-quota-remaining": "0",
        "x-ascent-quota-scope": scope,
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

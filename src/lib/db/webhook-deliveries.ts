// Cross-instance webhook delivery dedup (github-app-installation-webhooks #3). The webhook route's
// in-process replay Map (src/app/api/app/webhook/route.ts) only collapses SAME-instance replays — every
// serverless instance starts with an empty Map, so a captured, still-validly-signed delivery re-sent to a
// DIFFERENT instance is not deduped and re-triggers scans/gates. This backs the Map with a shared claim
// keyed on the X-GitHub-Delivery id: the FIRST caller across all instances to claim an id processes it;
// later callers see it already claimed and skip. On a deferred-processing failure the claim is RELEASED so
// a GitHub redelivery can retry. Accessed via raw SQL so it needs no generated-client model accessor.
// No-op / fail-open safe without a DB. See the `WebhookDelivery` model in prisma/schema.prisma.

import { getPrisma, isDbConfigured } from "@/lib/db/client";

/** Default claim lifetime — mirrors the route's in-memory DELIVERY_TTL_MS. */
const DEFAULT_TTL_MS = 10 * 60_000;

/**
 * Atomically claim a webhook delivery id across instances. Returns true when THIS call claimed it (a fresh
 * id, or one whose prior claim had already expired), false when it was already claimed by a still-valid row
 * (a duplicate/replay). Fails OPEN (returns true) without a DB or on a transient DB error: the in-memory
 * Map still catches same-instance replays and the HMAC still gates authenticity, and failing closed would
 * drop legitimate deliveries during a DB blip.
 */
export async function claimWebhookDelivery(id: string, ttlMs: number = DEFAULT_TTL_MS): Promise<boolean> {
  if (!isDbConfigured()) return true;
  try {
    const prisma = getPrisma();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlMs);
    // INSERT, or TAKE OVER an EXPIRED claim. A fresh id inserts (1 row); a conflicting id whose claim is
    // still valid hits ON CONFLICT but the conditional DO UPDATE's WHERE is false → 0 rows (a duplicate);
    // an EXPIRED claim is taken over with a refreshed horizon → 1 row. So affectedRows > 0 == "claimed".
    const affected = await prisma.$executeRaw`
      INSERT INTO "WebhookDelivery" ("id", "expiresAt", "createdAt")
      VALUES (${id}, ${expiresAt}, ${now})
      ON CONFLICT ("id") DO UPDATE
        SET "expiresAt" = EXCLUDED."expiresAt", "createdAt" = EXCLUDED."createdAt"
        WHERE "WebhookDelivery"."expiresAt" <= ${now}
    `;
    // Best-effort opportunistic sweep so the table can't grow unbounded without a cron (cheap + indexed on
    // expiresAt). Fire-and-forget on a small fraction of claims; a failure here never blocks the claim.
    if (Math.random() < 0.02) {
      void prisma.$executeRaw`DELETE FROM "WebhookDelivery" WHERE "expiresAt" <= ${now}`.catch(() => {});
    }
    return affected > 0;
  } catch (err) {
    console.warn("[webhook] delivery claim failed; allowing (fail-open)", err instanceof Error ? err.message : err);
    return true;
  }
}

/**
 * Release a previously-claimed delivery id so a GitHub redelivery can retry — called when the deferred
 * processing fails after the claim was taken. Best-effort; no-op without a DB.
 */
export async function releaseWebhookDelivery(id: string): Promise<void> {
  if (!isDbConfigured()) return;
  try {
    await getPrisma().$executeRaw`DELETE FROM "WebhookDelivery" WHERE "id" = ${id}`;
  } catch (err) {
    console.warn("[webhook] delivery release failed", err instanceof Error ? err.message : err);
  }
}

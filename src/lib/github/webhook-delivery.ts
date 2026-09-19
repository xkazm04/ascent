// Webhook delivery replay-defense + abort-and-retry helpers for the GitHub App webhook route
// (src/app/api/app/webhook/route.ts). Extracted out of the route so the Map/TTL/eviction policy
// and the repeated "swallow a deferred-work failure, but release the delivery" shape each get
// their own home and test coverage.
//
// Replay defense. GitHub stamps each delivery with a unique X-GitHub-Delivery id. A captured,
// still-valid signed request can be re-sent (the HMAC still verifies) to re-trigger scans/gates;
// remember recently-seen ids (bounded, in-memory) and skip duplicates. This Map is only a fast
// FIRST-LEVEL filter — it is PROCESS-LOCAL, so on a horizontally-scaled / serverless deploy every
// instance starts empty and a replay routed elsewhere slips past it. The AUTHORITATIVE cross-instance
// check is claimWebhookDelivery (a shared DB-backed claim, github-app-installation-webhooks #3); this
// cache just saves a DB round-trip on same-instance replays. Recorded only AFTER signature
// verification so junk can't fill the map.
//
// NOTE (not fixed here): this cache is process-local and unbounded across instances — a separate
// backlog item tracks swapping the backing store for something shared. Keeping the cache and its
// release paths behind this module's three functions (deliveryAlreadySeen / forgetLocalDelivery /
// forgetDelivery) is what makes that future swap a one-file change.

import { releaseWebhookDelivery } from "@/lib/db";

const DELIVERY_TTL_MS = 10 * 60_000;
const DELIVERY_MAX = 2000;
const seenDeliveries = new Map<string, number>(); // delivery id -> expiry

/**
 * Record `id` as seen and report whether it was ALREADY seen (i.e. this call is a replay).
 * Bounded to DELIVERY_MAX entries: once over the cap, expired entries are swept first, then the
 * oldest remaining entries are evicted oldest-first so memory stays bounded under a sustained
 * flood.
 */
export function deliveryAlreadySeen(id: string): boolean {
  const now = Date.now();
  const exp = seenDeliveries.get(id);
  if (exp && exp > now) return true;
  seenDeliveries.set(id, now + DELIVERY_TTL_MS);
  if (seenDeliveries.size > DELIVERY_MAX) {
    for (const [k, v] of seenDeliveries) if (v <= now) seenDeliveries.delete(k);
    while (seenDeliveries.size > DELIVERY_MAX) {
      const oldest = seenDeliveries.keys().next().value;
      if (oldest === undefined) break;
      seenDeliveries.delete(oldest);
    }
  }
  return false;
}

/**
 * Roll back an OPTIMISTIC `deliveryAlreadySeen` record without touching the DB claim. Used when
 * the DB claim call itself throws (a blip, not a verdict) — deliveryAlreadySeen() already recorded
 * the id in the in-memory Map before the DB call was attempted, so on a throw that record must be
 * undone or this instance would short-circuit a later, legitimate redelivery as `duplicate: true`
 * for a delivery that was never actually claimed nor processed.
 */
export function forgetLocalDelivery(id: string): void {
  seenDeliveries.delete(id);
}

/**
 * Release a delivery id from BOTH the in-memory seen-set AND the shared DB claim so a redelivery can be
 * retried. The route claims a delivery at the top (replay protection) BEFORE the deferred after() work
 * runs; if that work then fails transiently (DB blip, token mint failure), the delivery would stay
 * "claimed" and a GitHub/manual redelivery of the same id — to ANY instance — would be silently deduped,
 * dropping the work forever. Calling this in the deferred work's failure path frees the slot so the retry
 * actually runs. The DB release is best-effort (it self-heals at the TTL even if it fails).
 */
export async function forgetDelivery(id: string): Promise<void> {
  seenDeliveries.delete(id);
  await releaseWebhookDelivery(id);
}

/**
 * Shared "swallow this deferred-work failure/abort, but release the delivery so a redelivery can
 * retry" step that recurred, identically shaped, at every abort/failure site in the webhook route
 * (see forgetDelivery's doc comment above for why the release matters — a claim must mean
 * "successfully processed", never merely "we decided not to act this time"). `log`, when given,
 * runs first so each call site keeps its own exact console message and log level; this only
 * unifies the "then release the claim" half, not what gets logged or whether logging happens.
 */
export async function abandonDelivery(deliveryId: string | undefined, log?: () => void): Promise<void> {
  log?.();
  if (deliveryId) await forgetDelivery(deliveryId);
}

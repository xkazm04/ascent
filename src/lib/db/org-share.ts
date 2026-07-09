// Per-link revocation state for live war-room share tokens (live-war-room #1). A live-share token is a
// stateless HMAC capability whose only carried identity is a random `jti` (src/lib/live-share.ts); this is
// the authoritative store that says "this specific jti is dead" — the per-link kill switch the stateless
// token lacked, so a single leaked/forwarded link can be killed WITHOUT rotating the global signing secret
// (which defaults to AUTH_SECRET and would sign out every user), and without a schema change (prisma/ is
// fixed for this work).
//
// It piggybacks the existing SessionRevocation version-bump store (src/lib/db/sessions.ts) under a
// namespaced key: a monotonic version >= 1 means "revoked". SessionRevocation is the RIGHT host because it
// is a permanent revocation ledger — NOT swept by the retention purge (unlike AuditLog, where a purged
// revocation row would silently un-revoke a link) — keyed by an arbitrary string @id, and a
// `live-share:<jti>` key can never collide with a real GitHub login (logins contain no colon). Revocation
// is a version BUMP, so revoking one jti never touches any session or any other link.
//
// Enforced on READ by the shared page (/live/shared/[token]). The owner-gated revoke ENDPOINT that would
// call revokeLiveShareLink() is the natural next step but is out of this change's scope — the primitive
// lives here so it can be wired without another crypto/design pass.

import { getSessionVersion, bumpSessionVersion } from "@/lib/db/sessions";

// Namespace prefix keeps share revocations disjoint from session revocations in the shared store. The
// colon guarantees no collision with a GitHub login (logins are alphanumeric + hyphen only).
const shareKey = (jti: string) => `live-share:${jti}`;

/**
 * Has this specific share link (identified by its `jti`) been revoked? False when the DB isn't configured
 * (no revocation authority — the stateless, TTL-only behavior, exactly as before). O(1) primary-key lookup.
 */
export async function isLiveShareRevoked(jti: string): Promise<boolean> {
  if (!jti) return false;
  return (await getSessionVersion(shareKey(jti))) > 0;
}

/**
 * Kill a single share link by its `jti` — idempotent, and touches NEITHER the global secret NOR any
 * session. No-op when the DB isn't configured (stateless mode has no revocation authority).
 */
export async function revokeLiveShareLink(jti: string): Promise<void> {
  if (!jti) return;
  await bumpSessionVersion(shareKey(jti));
}

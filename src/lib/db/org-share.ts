// Per-link revocation state for the org's SHARE LINKS — the live war-room token (live-war-room #1) and
// the executive briefing token (expiring-share-links #13) — plus the read side that lists which briefing
// grants an org has issued.
//
// Both link kinds are stateless HMAC capabilities whose only carried identity is a random `jti`
// (src/lib/live-share.ts, src/lib/briefing-share.ts); this is the authoritative store that says "this
// specific jti is dead" — the per-link kill switch the stateless token lacked, so a single
// leaked/forwarded link can be killed WITHOUT rotating the global signing secret (which defaults to
// AUTH_SECRET and would sign out every user), and without a schema change (prisma/ is fixed for this work).
//
// It piggybacks the existing SessionRevocation version-bump store (src/lib/db/sessions.ts) under a
// namespaced key: a monotonic version >= 1 means "revoked". SessionRevocation is the RIGHT host because it
// is a permanent revocation ledger — NOT swept by the retention purge (unlike AuditLog, where a purged
// revocation row would silently un-revoke a link) — keyed by an arbitrary string @id, and a
// `<namespace>:<jti>` key can never collide with a real GitHub login (logins contain no colon). Revocation
// is a version BUMP, so revoking one jti never touches any session or any other link.
//
// ONE MECHANISM, TWO NAMESPACES (expiring-share-links, consolidation). The briefing side used to do its
// own lookup inline on the shared page (`getSessionVersion(briefingShareRevocationKey(jti)) > 0`) while
// this module held the identical mechanism hardcoded to the `live-share:` prefix. Two copies of a
// revocation check is how one surface starts honouring revocations the other ignores — e.g. one gains a
// fail-closed catch or a "version >= N" rule and the other silently doesn't. `isShareLinkRevoked` below is
// now the single lookup; the namespace is a parameter, and the two exported wrappers only bind it.

import { getSessionVersion, bumpSessionVersion } from "@/lib/db/sessions";
import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getAuditLog } from "@/lib/db/scans-audit";
// The briefing namespace has exactly ONE definition, and it lives in the pure token module because the
// shared page needs it without importing the db layer. Importing it here (db -> pure lib, never the
// reverse) keeps the string from being retyped, which is the failure the consolidation is guarding.
import { briefingShareRevocationKey } from "@/lib/briefing-share";

/** Namespace prefix for live war-room links. The colon guarantees no collision with a GitHub login
 *  (logins are alphanumeric + hyphen only), which is what makes sharing the store safe. */
const liveShareRevocationKey = (jti: string) => `live-share:${jti}`;

/**
 * The single revocation lookup, namespace-aware: has the grant behind this already-namespaced key been
 * revoked?
 *
 * FAILS CLOSED BY CONSTRUCTION. An unreachable ledger means "treat as revoked", not "treat as valid" —
 * the whole point of the ledger is that a leaked link stops working, so a DB hiccup must not resurrect
 * one. Callers previously had to remember `.catch(() => true)` at each call site; that is exactly the
 * kind of rule that gets copied to one surface and forgotten on the next, so it is enforced here.
 *
 * The DB-NOT-CONFIGURED case is deliberately NOT a failure: there is no revocation authority in that
 * deployment at all (getSessionVersion returns 0), so the link keeps its stateless, TTL-only behavior,
 * exactly as before. Distinguishing "no authority exists" from "the authority is unreachable" is the
 * whole difference between a supported mode and an outage.
 */
async function isShareLinkRevoked(key: string): Promise<boolean> {
  try {
    return (await getSessionVersion(key)) > 0;
  } catch {
    return true;
  }
}

/**
 * Has this specific live war-room share link (identified by its `jti`) been revoked? False when the DB
 * isn't configured (no revocation authority — the stateless, TTL-only behavior, exactly as before).
 * O(1) primary-key lookup. Fails closed on a lookup error.
 */
export async function isLiveShareRevoked(jti: string): Promise<boolean> {
  if (!jti) return false;
  return isShareLinkRevoked(liveShareRevocationKey(jti));
}

/**
 * Has this specific briefing share link been revoked? Same mechanism, different namespace — see
 * {@link isShareLinkRevoked}. The shared page (/share/briefing/[token]) enforces this on read; a legacy
 * token carrying no `jti` has no handle at all and stays governed by its TTL + `mintedBy` binding.
 */
export async function isBriefingShareRevoked(jti: string): Promise<boolean> {
  if (!jti) return false;
  return isShareLinkRevoked(briefingShareRevocationKey(jti));
}

/**
 * Kill a single share link by its `jti` — idempotent, and touches NEITHER the global secret NOR any
 * session. No-op when the DB isn't configured (stateless mode has no revocation authority).
 */
export async function revokeLiveShareLink(jti: string): Promise<void> {
  if (!jti) return;
  await bumpSessionVersion(liveShareRevocationKey(jti));
}

/**
 * Kill a single briefing share link by its `jti`. Unlike the pre-existing lever (demote the minter,
 * which killed every link they had ever issued), this ends exactly one grant. Throws on a write failure
 * so the revoke ENDPOINT can report the truth — an owner told "revoked" over a failed write would stop
 * chasing a link that is still live, which is worse than an error they can retry.
 */
export async function revokeBriefingShareLink(jti: string): Promise<void> {
  if (!jti) return;
  await bumpSessionVersion(briefingShareRevocationKey(jti));
}

/**
 * Batched revocation lookup for the grant list: which of these briefing jtis are dead? One IN-query
 * instead of N primary-key round-trips, because the list view asks about every grant on the page at once.
 *
 * Fails closed as a SET: an unreachable ledger returns every jti as revoked, matching
 * {@link isShareLinkRevoked}. A list that renders "active" over an unreadable ledger would invite an
 * owner to conclude a link they already killed is still live (or, worse, that the kill never landed).
 */
export async function revokedBriefingShareJtis(jtis: string[]): Promise<Set<string>> {
  const unique = [...new Set(jtis.filter(Boolean))];
  if (unique.length === 0 || !isDbConfigured()) return new Set();
  // bumpSessionVersion lowercases its key before writing, so the read must lowercase too or a
  // mixed-case jti would miss its own revocation row and read back as ACTIVE.
  const keyToJti = new Map(unique.map((jti) => [briefingShareRevocationKey(jti).toLowerCase(), jti]));
  try {
    const rows = await getPrisma().sessionRevocation.findMany({
      where: { login: { in: [...keyToJti.keys()] }, version: { gt: 0 } },
      select: { login: true },
    });
    return new Set(rows.map((r) => keyToJti.get(r.login)).filter((x): x is string => x != null));
  } catch {
    return new Set(unique);
  }
}

/** One issued briefing share grant, reconstructed from the audit trail + the revocation ledger. */
export interface BriefingShareGrant {
  /** The grant's identity — the handle a revoke call names. Opaque, not a credential (the token is). */
  jti: string;
  /** When the link was minted (ISO). */
  mintedAt: string;
  /** GitHub login of the minting owner, or null when the deployment doesn't bind one (see mintedBy). */
  mintedBy: string | null;
  /** Absolute expiry carried by the token (ISO), or null on a mint row that recorded none. */
  expiresAt: string | null;
  /** The frozen window the recipient sees: `start: null` = all-time. Null when the row recorded none. */
  window: { start: string | null; end: string } | null;
  /** Per-client segment scope carried by the link, or null for the whole org. */
  segment: string | null;
  /** Tech-stack group key carried by the link, or null for the whole fleet. */
  stack: string | null;
  /** Killed via the revoke endpoint. Fail-closed: an unreadable ledger reports every grant revoked. */
  revoked: boolean;
  /** Past its TTL, so already inert without any revocation. */
  expired: boolean;
  /** How many `briefing.share.opened` rows exist for this grant within the scanned window. */
  opens: number;
  /** The most recent open (ISO), or null if it was never opened. */
  lastOpenedAt: string | null;
}

/** Read one string field out of an audit row's meta, tolerating the legacy/absent case. */
function metaString(meta: Record<string, unknown>, key: string): string | null {
  const v = meta[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

/**
 * List the briefing share grants an org has issued, newest first.
 *
 * This is a READ over rows that already exist, not a new store. The mint route records
 * `briefing.share.minted` with the grant's jti, expiry, frozen window and scope, so everything an owner
 * needs to answer "which links exist, and should this one still?" is in the audit trail already; adding a
 * second store would mean a second thing to keep in sync, to retain, and to erase.
 *
 * The consequence to state plainly: the list is bounded by AUDIT RETENTION, while revocation is
 * permanent. A grant whose mint row has aged out disappears from this list even though its token may
 * still verify — so the list is the owner's inventory, never the enforcement point. Enforcement is the
 * ledger check on the shared page, which does not depend on this read at all. (This is also why the
 * revoke endpoint does not require a grant to appear here.)
 */
export async function listBriefingShareGrants(orgSlug: string, opts: { limit?: number } = {}): Promise<BriefingShareGrant[]> {
  if (!isDbConfigured()) return [];
  // 100 is getAuditLog's own ceiling. An org that has issued more briefing links than that in its
  // retention window is far outside the "a few board links per quarter" shape this serves; the newest
  // 100 are the ones an owner can still act on.
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const minted = await getAuditLog(orgSlug, { action: "briefing.share.minted", limit });
  if (!minted || minted.entries.length === 0) return [];

  // Opens are a separate action, so they need their own read. Ask for more rows than there are grants:
  // one link opened repeatedly by a board would otherwise crowd every other link's opens off the page.
  const opened = await getAuditLog(orgSlug, { action: "briefing.share.opened", limit: 100 }).catch(() => null);
  const openCount = new Map<string, { n: number; last: string }>();
  for (const row of opened?.entries ?? []) {
    const jti = metaString(row.meta, "jti");
    if (!jti) continue;
    const prev = openCount.get(jti);
    // getAuditLog returns newest-first, so the FIRST row seen for a jti is its most recent open.
    openCount.set(jti, { n: (prev?.n ?? 0) + 1, last: prev?.last ?? row.at });
  }

  const rows = minted.entries
    .map((row) => ({ row, jti: metaString(row.meta, "jti") }))
    .filter((x): x is { row: (typeof minted.entries)[number]; jti: string } => x.jti != null);
  const revoked = await revokedBriefingShareJtis(rows.map((x) => x.jti));
  const now = Date.now();

  return rows.map(({ row, jti }) => {
    const rawExpiry = row.meta.expiresAt;
    const expiresAt = typeof rawExpiry === "number" && Number.isFinite(rawExpiry) ? new Date(rawExpiry) : null;
    const win = row.meta.window as { winStart?: unknown; winEnd?: unknown } | undefined;
    const winEnd = win && typeof win.winEnd === "string" ? win.winEnd : null;
    const opens = openCount.get(jti);
    return {
      jti,
      mintedAt: row.at,
      // The audit row's actorId IS the minting owner (the mint route passes `mintedBy` as actorId).
      mintedBy: row.actorId,
      expiresAt: expiresAt ? expiresAt.toISOString() : null,
      window: winEnd ? { start: typeof win?.winStart === "string" ? win.winStart : null, end: winEnd } : null,
      segment: metaString(row.meta, "segment"),
      stack: metaString(row.meta, "stack"),
      revoked: revoked.has(jti),
      // A mint row with no recorded expiry cannot be called expired — saying "expired" about a link that
      // may still open is the one answer an owner must never be given, because they would stop revoking it.
      expired: expiresAt != null && expiresAt.getTime() <= now,
      opens: opens?.n ?? 0,
      lastOpenedAt: opens?.last ?? null,
    };
  });
}

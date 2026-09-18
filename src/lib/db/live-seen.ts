// THE LIVE LEDGER'S "SINCE YOU LAST LOOKED" ANCHOR — `Membership.liveSeenAt` (spark theater-upgrade,
// 2026-09-18). The `alertsSeenAt` pattern (members.ts `getAlertsWatermark` / `markAlertsSeen`), one
// surface over: read state is per-USER-per-ORG, which is exactly the Membership row's grain.
//
// A PRESENCE anchor, not a consumption watermark: the ledger stamps it only after it has been VISIBLE
// for a few continuous seconds (`useSeenStamp`), so a tab opened in a background window never zeroes
// the briefing. The read is snapshotted server-side at render (`loadLedger`) and every delta of that
// render is derived from the snapshot — the stamp that lands a few seconds later can never erase the
// briefing it was stamped over.
//
// Both functions are SELF-SCOPED: the login is the caller's own, resolved by the route from the
// session, never a parameter a browser supplies.

import { getPrisma, isDbConfigured } from "@/lib/db/client";
import { getOrgId } from "@/lib/db/org-rollup";

const normalizeLogin = (login: string): string => login.trim().toLowerCase();

async function membershipKey(orgSlug: string, login: string): Promise<{ orgId: string; userId: string } | null> {
  const gh = normalizeLogin(login);
  if (!gh) return null;
  const user = await getPrisma().user.findUnique({ where: { githubLogin: gh }, select: { id: true } });
  if (!user) return null;
  const orgId = await getOrgId(orgSlug);
  return orgId ? { orgId, userId: user.id } : null;
}

/**
 * The viewer's anchor in `orgSlug`. `null` = there is no membership row to read (auth off, a
 * non-member, no database) — the caller renders the bounded fallback window and SAYS so. `seenAt: null`
 * = a member who has never looked. A failed read throws; the loader turns that into "could not derive".
 */
export async function getLiveSeenAt(orgSlug: string, login: string): Promise<{ seenAt: string | null } | null> {
  if (!isDbConfigured()) return null;
  const key = await membershipKey(orgSlug, login);
  if (!key) return null;
  const m = await getPrisma().membership.findUnique({
    where: { orgId_userId: { orgId: key.orgId, userId: key.userId } },
    select: { liveSeenAt: true },
  });
  if (!m) return null;
  return { seenAt: m.liveSeenAt ? m.liveSeenAt.toISOString() : null };
}

/** Advance the viewer's own anchor to `at`. False when there is no membership to stamp. Unconditional
 *  and single-write, for the reason `markAlertsSeen` gives: two open tabs cannot race a read-modify-write. */
export async function markLiveSeen(orgSlug: string, login: string, at: Date = new Date()): Promise<boolean> {
  if (!isDbConfigured()) return false;
  const key = await membershipKey(orgSlug, login);
  if (!key) return false;
  const updated = await getPrisma().membership.updateMany({
    where: { orgId: key.orgId, userId: key.userId },
    data: { liveSeenAt: at },
  });
  return updated.count > 0;
}

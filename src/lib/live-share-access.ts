// THE ONE VERIFICATION a kiosk link passes before anything is served for it — the shared page
// (/live/shared/[token]) and the theater's pulse route (/api/live/pulse) both call this, so a link can
// never be honoured by one and refused by the other.
//
// Extracted verbatim from the shared page (spark theater-upgrade, 2026-09-18), in the same order:
//   1. `verifyLiveShareToken` — signature, domain (`aud`) and EXPIRY, enforced on every read;
//   2. no database → nothing to serve;
//   3. per-link revocation (`isLiveShareRevoked(jti)`) and owner binding (a link minted by an owner is
//      honoured only while that login still holds owner access). Both fail CLOSED — a lookup error
//      reads as revoked rather than serving private data on a blip.
// Server-only: it reads the db. `live-share.ts` stays pure so its crypto can be tested without one.

import { verifyLiveShareToken, type LiveShareClaims } from "@/lib/live-share";
import { isDbConfigured } from "@/lib/db";
import { isLiveShareRevoked } from "@/lib/db/org-share";
import { getMembershipRole, roleAtLeast } from "@/lib/db/members";

export type LiveShareAccess =
  | { ok: true; claims: LiveShareClaims }
  | { ok: false; reason: "invalid" | "no-db" | "revoked" };

export async function resolveLiveShare(token: string): Promise<LiveShareAccess> {
  const verified = verifyLiveShareToken(token);
  if (!verified) return { ok: false, reason: "invalid" };
  if (!isDbConfigured()) return { ok: false, reason: "no-db" };
  const linkRevoked = await isLiveShareRevoked(verified.jti).catch(() => true);
  const minterLostAccess =
    verified.mintedBy != null &&
    !roleAtLeast(await getMembershipRole(verified.org, verified.mintedBy).catch(() => null), "owner");
  if (linkRevoked || minterLostAccess) return { ok: false, reason: "revoked" };
  return { ok: true, claims: verified };
}

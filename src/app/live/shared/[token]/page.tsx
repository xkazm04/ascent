// /live/shared/[token] — a read-only, kiosk-friendly view of an org's live war-room, authorized by a
// signed expiring token (WAR-4) instead of a session, so the wall can run on an unauthenticated TV.
// Outside the /org layout (no session gate); the token is the capability. Read-only: it renders the
// org's current standing but can't trigger scans (/api/org/scan stays session-gated). Exposes only the
// same rollup the dashboard shows. noindex so a leaked link isn't crawled.

import { LiveWarRoom } from "@/components/org/live/LiveWarRoom";
import { toLiveRepoSeeds } from "@/components/org/shared/liveWarRoomShared";
import { buildFleetTimetable } from "@/components/org/live/fleetTimetable";
import { getOrgRepoHistories, getOrgRollup, isDbConfigured } from "@/lib/db";
import { verifyLiveShareToken } from "@/lib/live-share";
import { isLiveShareRevoked } from "@/lib/db/org-share";
import { getMembershipRole, roleAtLeast } from "@/lib/db/members";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main id="main" className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5 text-center">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-base text-slate-400">{body}</p>
    </main>
  );
}

export default async function SharedLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // Decode first: signature + domain (aud) + EXPIRY are all enforced here, on read — a leaked link dies at
  // exp even though the recipient never re-mints it.
  const verified = verifyLiveShareToken(token);
  if (!verified) {
    return <Notice title="Link expired or invalid" body="This shared war-room link is no longer valid. Ask an org owner for a fresh one." />;
  }
  if (!isDbConfigured()) {
    return <Notice title="No data" body="This deployment has no database configured." />;
  }
  // Revocation is enforced on READ via two levers, NEITHER of which rotates the global secret (which would
  // sign out every user). Both fail CLOSED — a lookup error is treated as revoked rather than serving
  // private fleet data on a blip:
  //   • per-link (#1): this exact link's jti was killed via revokeLiveShareLink (src/lib/db/org-share.ts).
  //   • owner-binding (like briefing-share): a link bound to its minter is honored only while that owner
  //     still holds owner access, so removing/demoting them kills their links. Unbound (legacy) links skip.
  const linkRevoked = await isLiveShareRevoked(verified.jti).catch(() => true);
  const minterLostAccess =
    verified.mintedBy != null &&
    !roleAtLeast(await getMembershipRole(verified.org, verified.mintedBy).catch(() => null), "owner");
  if (linkRevoked || minterLostAccess) {
    return <Notice title="Link revoked" body="This shared war-room link has been revoked. Ask an org owner for a fresh one." />;
  }
  const rollup = await getOrgRollup(verified.org);
  if (!rollup || rollup.repoCount === 0) {
    return <Notice title="Nothing to show yet" body={`No scanned repositories for ${verified.org} yet.`} />;
  }
  const seed = toLiveRepoSeeds(rollup.repos);
  // Display-only extras the kiosk can safely show: the fleet-evolution timetable + fleet freshness
  // (both come from the same rollup/history the dashboard exposes — no session-gated actions).
  const fleetScannedAt = rollup.repos.reduce<string | null>((acc, r) => {
    const at = r.latest?.scannedAt ?? null;
    return at && (!acc || at > acc) ? at : acc;
  }, null);
  const timetable = buildFleetTimetable(await getOrgRepoHistories(verified.org).catch(() => []));
  return (
    <main id="main" className="mx-auto w-full max-w-6xl px-5 py-8">
      <LiveWarRoom
        slug={verified.org}
        watchedCount={rollup.repos.filter((r) => r.watched).length}
        seed={seed}
        timetable={timetable}
        trend={rollup.trend}
        fleetScannedAt={fleetScannedAt}
        readOnly
      />
    </main>
  );
}

// /live/shared/[token] — a read-only, kiosk-friendly view of an org's live war-room, authorized by a
// signed expiring token (WAR-4) instead of a session, so the wall can run on an unauthenticated TV.
// Outside the /org layout (no session gate); the token is the capability. Read-only: it renders the
// org's current standing but can't trigger scans (/api/org/scan stays session-gated). Exposes only the
// same rollup the dashboard shows. noindex so a leaked link isn't crawled. A `view: "theater"` link renders
// the standing runner's theater instead (spark theater-upgrade) — the wall below is unchanged for all others.

import { LiveWarRoom } from "@/features/inflight/live/LiveWarRoom";
import { toLiveRepoSeeds } from "@/components/org/shared/liveWarRoomShared";
import { buildFleetTimetable } from "@/features/inflight/live/fleetTimetable";
import { getOrgRepoHistories, getOrgRollup } from "@/lib/db";
import { resolveLiveShare } from "@/lib/live-share-access";
import { TheaterShell } from "@/features/inflight/live/theater/TheaterShell";
// Shared with /share/briefing/[token] — the other capability-link surface. Its default min-h-screen is
// this page's framing: the wall is a full-viewport kiosk with no header/footer chrome around it.
import { TokenNotice as Notice } from "@/components/TokenNotice";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function SharedLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  // ONE verification for every kiosk surface (src/lib/live-share-access.ts), in this order:
  //   • decode first: signature + domain (aud) + EXPIRY are all enforced on read — a leaked link dies at
  //     exp even though the recipient never re-mints it;
  //   • no database → nothing to show;
  //   • revocation on READ via two levers, NEITHER of which rotates the global secret (which would sign
  //     out every user), both failing CLOSED: per-link (#1) — this exact link's jti was killed via
  //     revokeLiveShareLink — and owner-binding — a link bound to its minter is honored only while that
  //     owner still holds owner access. The theater's pulse route (/api/live/pulse) calls the same function.
  const access = await resolveLiveShare(token);
  if (!access.ok && access.reason === "invalid") {
    return <Notice title="Link expired or invalid" body="This shared war-room link is no longer valid. Ask an org owner for a fresh one." />;
  }
  if (!access.ok && access.reason === "no-db") {
    return <Notice title="No data" body="This deployment has no database configured." />;
  }
  if (!access.ok) {
    return <Notice title="Link revoked" body="This shared war-room link has been revoked. Ask an org owner for a fresh one." />;
  }
  const verified = access.claims;
  // A `view: "theater"` link renders the standing runner's theater, fed by /api/live/pulse with this same
  // token. Every other link — including every one minted before the claim existed — renders the wall below.
  if (verified.view === "theater") {
    return <TheaterShell source={{ kind: "kiosk", slug: verified.org, token }} />;
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

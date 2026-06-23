// /live/shared/[token] — a read-only, kiosk-friendly view of an org's live war-room, authorized by a
// signed expiring token (WAR-4) instead of a session, so the wall can run on an unauthenticated TV.
// Outside the /org layout (no session gate); the token is the capability. Read-only: it renders the
// org's current standing but can't trigger scans (/api/org/scan stays session-gated). Exposes only the
// same rollup the dashboard shows. noindex so a leaked link isn't crawled.

import { LiveWarRoom } from "@/components/org/LiveWarRoom";
import { toLiveRepoSeeds } from "@/components/org/liveWarRoomShared";
import { getOrgRollup, isDbConfigured } from "@/lib/db";
import { verifyLiveShareToken } from "@/lib/live-share";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-5 text-center">
      <h1 className="text-xl font-bold text-white">{title}</h1>
      <p className="mt-2 text-base text-slate-400">{body}</p>
    </main>
  );
}

export default async function SharedLivePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyLiveShareToken(token);
  if (!verified) {
    return <Notice title="Link expired or invalid" body="This shared war-room link is no longer valid. Ask an org owner for a fresh one." />;
  }
  if (!isDbConfigured()) {
    return <Notice title="No data" body="This deployment has no database configured." />;
  }
  const rollup = await getOrgRollup(verified.org);
  if (!rollup || rollup.repoCount === 0) {
    return <Notice title="Nothing to show yet" body={`No scanned repositories for ${verified.org} yet.`} />;
  }
  const seed = toLiveRepoSeeds(rollup.repos);
  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8">
      <LiveWarRoom slug={verified.org} watchedCount={rollup.repos.filter((r) => r.watched).length} seed={seed} readOnly />
    </main>
  );
}

// POST /api/me/backlog — set the signed-in viewer's PERSONAL overlay on one shared recommendation.
//   { repo: "owner/name", dimId, title, status?, targetDate?: "YYYY-MM-DD" | null, note? }
//
// The overlay is the individual tier's answer to "track my roadmap without mutating the shared
// corpus" (decision 3): rows live under the viewer's personal org keyed by the recommendation's
// stable identity, and the shared Recommendation.status/assignee columns are never touched. Identity
// is the whole gate — the target org IS the viewer's login namespace — plus the watched-repo guard
// inside setPersonalOverlay (a 404 here, so overlays can't accrue for repos outside the workspace).

import { NextResponse } from "next/server";
import { getViewer } from "@/lib/access";
import { isDbConfigured, setPersonalOverlay, OverlayRepoNotWatchedError } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "The personal backlog requires a database." }, { status: 503 });
  }
  const viewer = await getViewer();
  if (!viewer) {
    return NextResponse.json({ error: "Sign in to track your backlog." }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    repo?: string;
    dimId?: string;
    title?: string;
    status?: string;
    targetDate?: string | null;
    note?: string;
  };
  if (!body.repo || !body.dimId || !body.title) {
    return NextResponse.json({ error: "Missing repo/dimId/title." }, { status: 400 });
  }

  try {
    const row = await setPersonalOverlay(
      viewer.login.trim().toLowerCase(),
      { repoFullName: body.repo, dimId: body.dimId, title: body.title },
      { status: body.status, targetDate: body.targetDate, note: body.note },
    );
    if (!row) {
      return NextResponse.json({ error: "Your workspace isn't set up yet. Visit /me first." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, ...row });
  } catch (err) {
    if (err instanceof OverlayRepoNotWatchedError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    console.error("[me/backlog] failed", err);
    return NextResponse.json({ error: "Failed to update your backlog." }, { status: 500 });
  }
}

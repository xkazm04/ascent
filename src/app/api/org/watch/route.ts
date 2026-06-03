// POST /api/org/watch     { org, owner, name, fullName, url?, private?, watched }
// POST /api/org/schedule  is a sibling route.
// Toggle whether a repo is tracked for org-wide scanning.

import { NextResponse } from "next/server";
import { isDbConfigured, setRepoWatch } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json(
      { error: "Org watchlist requires the GitHub App + a database." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    owner?: string;
    name?: string;
    fullName?: string;
    url?: string;
    private?: boolean;
    watched?: boolean;
  };
  if (!body.org || !body.fullName || !body.owner || !body.name) {
    return NextResponse.json({ error: "Missing org/owner/name/fullName." }, { status: 400 });
  }
  // Authorize: only a member of the org (or any caller on the shared "public" org / an auth-off
  // deploy) may change its watchlist. Without this, anyone could toggle watch flags for any org.
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;
  try {
    await setRepoWatch(
      body.org,
      { owner: body.owner, name: body.name, fullName: body.fullName, url: body.url, isPrivate: body.private },
      Boolean(body.watched),
    );
    return NextResponse.json({ ok: true, fullName: body.fullName, watched: Boolean(body.watched) });
  } catch (err) {
    console.error("[org/watch] failed", err);
    return NextResponse.json({ error: "Failed to update watchlist." }, { status: 500 });
  }
}

// POST /api/org/watch  — toggle whether repos are tracked for org-wide scanning.
//   single: { org, owner, name, fullName, url?, private?, watched }
//   bulk:   { org, watched, repos: [{ owner, name, fullName, url?, private? }, ...] }
//           (watch/unwatch a whole filtered set in one request — the connect screen's "Watch all").
// POST /api/org/schedule is the sibling route (its no-fullName body sets cadence for the watched set).

import { NextResponse } from "next/server";
import { isDbConfigured, setRepoWatch } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { requireOrgAccess } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Cap a bulk watch so one click can't write thousands of rows / run past the function ceiling. */
const MAX_BULK = 500;

interface RepoInput {
  owner?: string;
  name?: string;
  fullName?: string;
  url?: string;
  private?: boolean;
}

export async function POST(request: Request) {
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json(
      { error: "Org watchlist requires the GitHub App + a database." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as RepoInput & { org?: string; watched?: boolean; repos?: RepoInput[] };
  if (!body.org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  // Authorize: only a member of the org (or any caller on the shared "public" org / an auth-off
  // deploy) may change its watchlist. Without this, anyone could toggle watch flags for any org.
  const denied = await requireOrgAccess(body.org);
  if (denied) return denied;

  const watched = Boolean(body.watched);

  // Bulk path: watch/unwatch a whole set in one request. Writes are sequential so the lazy
  // Organization upsert inside setRepoWatch can't race itself; one bad row doesn't abort the rest.
  if (Array.isArray(body.repos)) {
    const valid = body.repos
      .filter((r): r is Required<Pick<RepoInput, "owner" | "name" | "fullName">> & RepoInput => !!(r && r.owner && r.name && r.fullName))
      .slice(0, MAX_BULK);
    if (valid.length === 0) return NextResponse.json({ error: "No valid repos in the batch." }, { status: 400 });
    let count = 0;
    const failed: string[] = [];
    for (const r of valid) {
      try {
        await setRepoWatch(body.org, { owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, isPrivate: r.private }, watched);
        count += 1;
      } catch {
        failed.push(r.fullName);
      }
    }
    return NextResponse.json({ ok: true, count, watched, failed });
  }

  // Single-repo path.
  if (!body.fullName || !body.owner || !body.name) {
    return NextResponse.json({ error: "Missing org/owner/name/fullName." }, { status: 400 });
  }
  try {
    await setRepoWatch(
      body.org,
      { owner: body.owner, name: body.name, fullName: body.fullName, url: body.url, isPrivate: body.private },
      watched,
    );
    return NextResponse.json({ ok: true, fullName: body.fullName, watched });
  } catch (err) {
    console.error("[org/watch] failed", err);
    return NextResponse.json({ error: "Failed to update watchlist." }, { status: 500 });
  }
}

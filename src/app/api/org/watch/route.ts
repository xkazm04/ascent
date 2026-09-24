// POST /api/org/watch  — toggle whether repos are tracked for org-wide scanning.
//   single: { org, owner, name, fullName, url?, private?, watched }
//   bulk:   { org, watched, repos: [{ owner, name, fullName, url?, private? }, ...] }
//           (watch/unwatch a whole filtered set in one request — the connect screen's "Watch all").
// POST /api/org/schedule is the sibling route (its no-fullName body sets cadence for the watched set).
//
// WATCH SCOPE (backlog develop-2026-09-17 row 39). A watched repo is a standing credit draw, so a
// watch (`watched: true`) must pass `watchScopeFor(org)` (src/lib/org/watch-scope.ts): on a hosted
// deployment the org's own namespace or its GitHub App installation listing, on a self-hosted one
// anything. The handle shape is checked in both modes. A refused single write is a 400; a refused
// bulk entry lands in `failed[]` and the rest are still watched. UN-watching is never refused: an
// in-scope unwatch records the explicit-unwatch row as before (setRepoWatch false), and anything else
// only clears a row the org already has (clearRepoWatch), so an unwatch cannot mint a tracked row.

import { NextResponse } from "next/server";
import { isDbConfigured, setRepoWatch } from "@/lib/db";
import { isAppConfigured } from "@/lib/github/app";
import { requireFleetOrg, requireOrgAccess } from "@/lib/authz";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { clearRepoWatch } from "@/lib/db/org-watch";
import { parseWatchHandle, watchScopeFor, type WatchScope } from "@/lib/org/watch-scope";

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

type PresentRepo = Required<Pick<RepoInput, "owner" | "name" | "fullName">> & RepoInput;

/**
 * Apply one watch-flag write under the org's watch scope. A WATCH is refused as `bad-handle` or
 * `out-of-scope`; an unwatch is never refused.
 */
async function writeWatch(
  org: string,
  inScope: WatchScope,
  r: PresentRepo,
  watched: boolean,
): Promise<"ok" | "bad-handle" | "out-of-scope"> {
  const handle = parseWatchHandle(r);
  const admitted = handle !== null && (await inScope(handle));
  if (!admitted) {
    if (watched) return handle ? "out-of-scope" : "bad-handle";
    await clearRepoWatch(org, r.fullName);
    return "ok";
  }
  await setRepoWatch(org, { owner: r.owner, name: r.name, fullName: r.fullName, url: r.url, isPrivate: r.private }, watched);
  return "ok";
}

export async function POST(request: Request) {
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json(
      { error: "Org watchlist requires the GitHub App + a database." },
      { status: 503 },
    );
  }
  const body = (await request.json().catch(() => ({}))) as RepoInput & { org?: string; watched?: boolean; repos?: RepoInput[] };
  // Canonicalize like the import/scan routes: the access gate normalizes internally, but
  // setRepoWatch → ensureOrg used to upsert the raw slug — so a mixed-case `org` passed the
  // gate yet minted a duplicate tenant that no reader (getOrgId) can reach. Whitespace-only
  // is missing, not a blank-slug tenant.
  const org = body.org ? normalizeOrgSlug(body.org) : "";
  if (!org) return NextResponse.json({ error: "Missing org." }, { status: 400 });
  // Authorize: only a member of the org (or any caller on the shared "public" org / an auth-off
  // deploy) may change its watchlist. Without this, anyone could toggle watch flags for any org.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  // Personal workspaces watch via /api/me/watch (public-repo verify + free-tier cap) — this fleet
  // path would bypass both and de-tenant the lens.
  const notFleet = await requireFleetOrg(org);
  if (notFleet) return notFleet;

  const watched = Boolean(body.watched);
  const inScope = watchScopeFor(org);

  // Bulk path: watch/unwatch a whole set in one request. Writes are sequential so the lazy
  // Organization upsert inside setRepoWatch can't race itself; one bad row doesn't abort the rest.
  if (Array.isArray(body.repos)) {
    const valid = body.repos
      .filter((r): r is PresentRepo => !!(r && r.owner && r.name && r.fullName))
      .slice(0, MAX_BULK);
    if (valid.length === 0) return NextResponse.json({ error: "No valid repos in the batch." }, { status: 400 });
    let count = 0;
    const failed: string[] = [];
    for (const r of valid) {
      try {
        if ((await writeWatch(org, inScope, r, watched)) === "ok") count += 1;
        else failed.push(r.fullName);
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
    const outcome = await writeWatch(org, inScope, body as PresentRepo, watched);
    if (outcome === "bad-handle") {
      return NextResponse.json({ error: "owner/name/fullName must be a GitHub repository handle." }, { status: 400 });
    }
    if (outcome === "out-of-scope") {
      return NextResponse.json(
        { error: `${body.fullName} is not a repository of ${org} or of its GitHub App installation.` },
        { status: 400 },
      );
    }
    return NextResponse.json({ ok: true, fullName: body.fullName, watched });
  } catch (err) {
    console.error("[org/watch] failed", err);
    return NextResponse.json({ error: "Failed to update watchlist." }, { status: 500 });
  }
}

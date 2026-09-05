// LOCAL MODE — add a repository to the org's scan scope from the Pairing tab (self-hosted only).
//
// POST { org, url } → parse "owner/repo" (or any GitHub URL shape), upsert the fleet row watched.
// This is the same primitive the onboarding import uses (setRepoWatch); the tab exists because a
// self-hoster's fleet often includes public repos they never installed an App on — the pairing tab
// is where scope is managed in local mode, so adding to scope lives beside it. Owner-gated like the
// pairing writes (scope changes what gets scanned and, once paired, what an agent can be sent into).
//
// No GitHub existence check on purpose: local mode's whole point is not leading against GitHub, and
// a paired local path makes the repo scannable even when the name never resolves publicly. A typo'd
// unpaired repo simply fails its first scan with a clear message — recoverable, not dangerous.

import { NextResponse } from "next/server";
import { PUBLIC_ORG } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";
import { dbGuard } from "@/lib/api/orgPlan";
import { selfHostGuard } from "@/lib/api/self-host";
import { parseRepoUrl } from "@/lib/github/source";
import { setRepoWatch } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const guard = selfHostGuard() ?? dbGuard("Fleet scope", "Adding repositories requires a database.");
  if (guard) return guard;

  const body = (await request.json().catch(() => ({}))) as { org?: unknown; url?: unknown };
  const org = typeof body.org === "string" ? body.org.trim().toLowerCase() : "";
  const url = typeof body.url === "string" ? body.url.trim() : "";
  if (!org || !url) return NextResponse.json({ error: "Missing 'org' or 'url'." }, { status: 400 });
  if (org === PUBLIC_ORG) {
    return NextResponse.json({ error: "The public funnel org has no managed fleet." }, { status: 403 });
  }

  const denied = await requireOrgRole(org, "owner");
  if (denied) return denied;

  const parsed = parseRepoUrl(url);
  if (!parsed) {
    return NextResponse.json({ error: "Could not read an owner/repo from that input." }, { status: 422 });
  }
  const fullName = `${parsed.owner}/${parsed.repo}`;
  await setRepoWatch(org, { owner: parsed.owner, name: parsed.repo, fullName }, true);
  return NextResponse.json({ ok: true, fullName });
}

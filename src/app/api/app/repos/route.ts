// GET /api/app/repos?org=<login>   (or ?installation_id=<id>)
// Lists the repositories an installation can access, for the connect UI.

import { NextResponse } from "next/server";
import { isAppConfigured, listInstallationRepos } from "@/lib/github/app";
import { getInstallationIdForOwner, getRepoStates, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { sessionHasInstallation } from "@/lib/authz";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAppConfigured()) {
    return NextResponse.json(
      { error: "GitHub App is not configured on this deployment." },
      { status: 503 },
    );
  }
  const { searchParams } = new URL(request.url);
  let installationId = searchParams.get("installation_id") ?? undefined;
  const org = searchParams.get("org");
  if (!installationId && org) {
    installationId = (await getInstallationIdForOwner(org)) ?? undefined;
  }
  if (!installationId) {
    return NextResponse.json({ error: "No installation found for that org." }, { status: 404 });
  }

  // Authorize BEFORE minting a token + listing PRIVATE repos: this endpoint returns an
  // installation's full repo list (including private rows), so an unauthorized caller would be a
  // cross-tenant IDOR. Gate on the EFFECTIVE installation id (not the ?org= param), so a caller
  // can't pair their own ?org= with a victim's ?installation_id= — the id is what's actually used.
  // The connect UI only lists repos for installations already in the session; a just-installed org
  // re-syncs first (see /connect). Auth-off deploys stay open (local/demo), per the authz model.
  if (isAuthConfigured() && !(await sessionHasInstallation(installationId))) {
    return NextResponse.json(
      { error: "You don't have access to this installation." },
      { status: 403 },
    );
  }

  try {
    const repos = await listInstallationRepos(installationId);
    repos.sort((a, b) => Number(b.private) - Number(a.private) || a.fullName.localeCompare(b.fullName));
    // Merge stored watch/schedule/level state (if DB + we can resolve the org login).
    const orgLogin = org ?? repos[0]?.owner;
    const states = isDbConfigured() && orgLogin ? await getRepoStates(orgLogin) : {};
    const merged = repos.map((r) => ({ ...r, state: states[r.fullName] ?? null }));
    return NextResponse.json({ installationId, org: orgLogin, repos: merged });
  } catch (err) {
    console.error("[app/repos] failed", err);
    return NextResponse.json({ error: "Failed to list installation repositories." }, { status: 502 });
  }
}

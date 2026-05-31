// GET /api/app/repos?org=<login>   (or ?installation_id=<id>)
// Lists the repositories an installation can access, for the connect UI.

import { NextResponse } from "next/server";
import { isAppConfigured, listInstallationRepos } from "@/lib/github/app";
import { getInstallationIdForOwner, getRepoStates, isDbConfigured } from "@/lib/db";

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

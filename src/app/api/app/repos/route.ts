// GET /api/app/repos?org=<login>   (or ?installation_id=<id>)
// Lists the repositories an installation can access, for the connect UI.

import { NextResponse } from "next/server";
import { isAppConfigured, listInstallationRepos } from "@/lib/github/app";
import { getInstallationIdForOwner, getOrgMovers, getRepoStates, isDbConfigured } from "@/lib/db";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled } from "@/lib/access";
import { requireOrgRead, sessionHasInstallation } from "@/lib/authz";

const MOVERS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000; // 30-day movement window for the fleet-map deltas

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
  const org = (searchParams.get("org") ?? "").trim();

  // Authorize BEFORE minting a token + listing PRIVATE repos: this endpoint returns an
  // installation's full repo list (including private rows), so an unauthorized caller is a
  // cross-tenant IDOR.
  if (authGateEnabled()) {
    // Supabase login wall (the ACTIVE prod auth). The old guard keyed off isAuthConfigured() — the
    // DORMANT custom OAuth — which is inert under the Supabase wall, so requireOrgRead/sessionHas*
    // never fired and ANY caller could list a victim org's private repos (the same IDOR the rest of
    // authz.ts was hardened against). Require a viewer with read standing on the org, then derive the
    // installation FROM the authorized org — a client-supplied ?installation_id= is IGNORED here, so a
    // caller can't pair their own ?org= with a victim's ?installation_id=. All real callers
    // (connect/onboarding/fleet-map) pass ?org=.
    if (!org) {
      return NextResponse.json({ error: "Provide ?org=<login>." }, { status: 400 });
    }
    const gate = await requireOrgRead(org);
    if (gate) return gate;
    installationId = (await getInstallationIdForOwner(org)) ?? undefined;
  } else {
    // Dormant custom OAuth / fully auth-off (local/demo). Resolve the effective installation id and,
    // when custom OAuth IS configured, gate on it being in the session (not the ?org= param), so a
    // caller can't pair their own ?org= with a victim's ?installation_id=.
    if (!installationId && org) {
      installationId = (await getInstallationIdForOwner(org)) ?? undefined;
    }
    if (installationId && isAuthConfigured() && !(await sessionHasInstallation(installationId))) {
      return NextResponse.json(
        { error: "You don't have access to this installation." },
        { status: 403 },
      );
    }
  }
  if (!installationId) {
    return NextResponse.json({ error: "No installation found for that org." }, { status: 404 });
  }

  try {
    const repos = await listInstallationRepos(installationId);
    repos.sort((a, b) => Number(b.private) - Number(a.private) || a.fullName.localeCompare(b.fullName));
    // Merge stored watch/schedule/level state + a 30-day per-repo overall delta (MAP-3, for the
    // fleet-map movers overlay) — both only when DB + we can resolve the org login.
    const orgLogin = org || repos[0]?.owner;
    const states = isDbConfigured() && orgLogin ? await getRepoStates(orgLogin) : {};
    const movers =
      isDbConfigured() && orgLogin
        ? await getOrgMovers(orgLogin, { start: new Date(Date.now() - MOVERS_WINDOW_MS) }).catch(() => null)
        : null;
    const dByName: Record<string, number> = {};
    if (movers) {
      for (const m of [...movers.gainers, ...movers.regressers, ...movers.levelChanges]) dByName[m.fullName] = m.dOverall;
    }
    const merged = repos.map((r) => ({
      ...r,
      state: states[r.fullName] ?? null,
      dOverall: dByName[r.fullName] ?? null,
    }));
    return NextResponse.json({ installationId, org: orgLogin, repos: merged });
  } catch (err) {
    console.error("[app/repos] failed", err);
    return NextResponse.json({ error: "Failed to list installation repositories." }, { status: 502 });
  }
}

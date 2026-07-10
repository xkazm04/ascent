// GET /api/app/setup  — GitHub App post-install redirect target ("Setup URL").
// GitHub sends ?installation_id=...&setup_action=install. We resolve the account login,
// store the installation, then bounce the user to /connect for that org.

import { NextResponse } from "next/server";
import { getInstallation, isAppConfigured, isOrgAdminViaInstallation } from "@/lib/github/app";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, resolveViewerLogin } from "@/lib/access";
import { upsertInstallation } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const installationId = url.searchParams.get("installation_id");

  if (!isAppConfigured()) {
    return NextResponse.redirect(new URL("/connect?error=not_configured", request.url));
  }
  if (!installationId) {
    return NextResponse.redirect(new URL("/connect?error=missing_installation", request.url));
  }

  // Authorization (github-app-installation-webhooks #2): this route mints an org row + a GitHub API
  // round-trip, but getInstallation authenticates the INSTALLATION, not the CALLER. Left unauthenticated,
  // an attacker could iterate installation ids to discover which belong to this app AND seed `private`-plan
  // org rows for accounts they don't control — installation enumeration + GitHub-API/DB amplification with
  // no throttle. Require a signed-in caller BEFORE the GitHub round-trip (kills the unauthenticated
  // enumeration/amplification), then gate the upsert to a caller who actually owns the resolved account:
  // the personal account itself, or a GitHub-confirmed org admin. When auth is NOT configured at all
  // (App-only / DB-less deployments with no session system) the prior open behavior is preserved.
  //
  // The guard used to key on `isAuthConfigured()` alone — the DORMANT custom-OAuth env, unset under the
  // ACTIVE Supabase wall — so in production authOn was false, `session` was null, and BOTH the sign-in
  // requirement and the ownership check below were dead code. resolveViewerLogin() resolves the caller
  // across both stacks (custom session first, then the JWT-validated Supabase viewer).
  const authOn = authGateEnabled() || isAuthConfigured();
  const actorLogin = authOn ? await resolveViewerLogin() : null;
  if (authOn && !actorLogin) {
    return NextResponse.redirect(new URL("/connect?error=auth_required", request.url));
  }

  try {
    const info = await getInstallation(installationId);
    if (actorLogin) {
      const accountLc = info.account.toLowerCase();
      const authorized =
        actorLogin.toLowerCase() === accountLc ||
        (await isOrgAdminViaInstallation(installationId, info.account, actorLogin).catch(() => false));
      if (!authorized) {
        console.warn(
          `[app/setup] ${actorLogin} not authorized for installation ${installationId} (account ${info.account})`,
        );
        return NextResponse.redirect(new URL("/connect?error=forbidden", request.url));
      }
    }
    await upsertInstallation({ login: info.account, installationId });
    const dest = new URL(`/connect`, request.url);
    dest.searchParams.set("org", info.account);
    dest.searchParams.set("installation_id", installationId);
    return NextResponse.redirect(dest);
  } catch (err) {
    console.error("[app/setup] failed", err);
    return NextResponse.redirect(new URL("/connect?error=setup_failed", request.url));
  }
}

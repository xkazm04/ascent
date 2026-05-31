// GET /api/app/setup  — GitHub App post-install redirect target ("Setup URL").
// GitHub sends ?installation_id=...&setup_action=install. We resolve the account login,
// store the installation, then bounce the user to /connect for that org.

import { NextResponse } from "next/server";
import { getInstallation, isAppConfigured } from "@/lib/github/app";
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

  try {
    const info = await getInstallation(installationId);
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

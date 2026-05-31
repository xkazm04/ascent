// GET /api/auth/callback — GitHub OAuth redirect. Verifies CSRF state, exchanges the
// code, loads the user + their App installations, sets the signed session cookie.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  buildSession,
  encodeSession,
  exchangeCodeForToken,
  fetchGithubUser,
  fetchUserInstallations,
  isAuthConfigured,
  NEXT_COOKIE,
  RESYNC_COOKIE,
  safeNext,
  sessionMaxAgeSeconds,
  SESSION_COOKIE,
  STATE_COOKIE,
} from "@/lib/auth";
import { upsertInstallation } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = url.origin;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  const store = await cookies();
  const savedState = store.get(STATE_COOKIE)?.value;
  const next = safeNext(store.get(NEXT_COOKIE)?.value);
  const resync = store.get(RESYNC_COOKIE)?.value === "1";

  if (!isAuthConfigured() || !code || !state || !savedState || state !== savedState) {
    return NextResponse.redirect(new URL("/connect?error=oauth", request.url));
  }

  try {
    const token = await exchangeCodeForToken(code, origin);
    const user = await fetchGithubUser(token);
    const installations = await fetchUserInstallations(token);
    // Link installations to orgs so owner->installation resolution works for scans.
    for (const i of installations) {
      try {
        await upsertInstallation({ login: i.login, installationId: i.id });
      } catch {
        /* DB optional */
      }
    }
    const session = buildSession(user, installations);
    // A re-sync lands back on the originating page with a confirmation flag, since the user
    // already passed through onboarding. A first sign-in lands on the cinematic "mission
    // control" fleet map rather than jumping straight to the next path; the intended
    // destination rides along as `next` so the entrance can hand off to it (its "Enter
    // mission control" affordance). `next` is already validated by safeNext above.
    const dest = resync
      ? `${next}${next.includes("?") ? "&" : "?"}resynced=1`
      : `/launch?next=${encodeURIComponent(next)}`;
    const res = NextResponse.redirect(new URL(dest, request.url));
    res.cookies.set(SESSION_COOKIE, encodeSession(session), {
      httpOnly: true,
      sameSite: "lax",
      secure: origin.startsWith("https"),
      path: "/",
      maxAge: sessionMaxAgeSeconds,
    });
    res.cookies.delete(STATE_COOKIE);
    res.cookies.delete(NEXT_COOKIE);
    res.cookies.delete(RESYNC_COOKIE);
    return res;
  } catch (err) {
    console.error("[auth/callback] failed", err);
    const res = NextResponse.redirect(new URL("/connect?error=oauth_failed", request.url));
    res.cookies.delete(RESYNC_COOKIE);
    return res;
  }
}

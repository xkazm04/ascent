// GET /api/auth/login?next=/path  — start GitHub OAuth (sets CSRF state cookie).

import { NextResponse } from "next/server";
import { buildAuthorizeUrl, isAuthConfigured, newState, NEXT_COOKIE, RESYNC_COOKIE, safeNext, STATE_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/connect?error=not_configured", request.url));
  }
  const url = new URL(request.url);
  const origin = url.origin;
  const next = safeNext(url.searchParams.get("next"));
  // A "re-sync access" round-trip reuses the whole OAuth flow (GitHub skips the consent
  // screen for an already-authorized user), but the callback should refresh installations
  // in place rather than replaying the first-login /launch cinematic.
  const resync = url.searchParams.get("resync") === "1";
  const state = newState();
  const secure = origin.startsWith("https");

  const res = NextResponse.redirect(buildAuthorizeUrl(origin, state));
  res.cookies.set(STATE_COOKIE, state, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600 });
  res.cookies.set(NEXT_COOKIE, next, { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600 });
  // Set or clear explicitly so a stale flag from an abandoned re-sync can't make a later
  // fresh sign-in skip the launch screen.
  if (resync) res.cookies.set(RESYNC_COOKIE, "1", { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: 600 });
  else res.cookies.delete(RESYNC_COOKIE);
  return res;
}

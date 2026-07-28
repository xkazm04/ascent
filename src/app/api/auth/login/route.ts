// GET /api/auth/login?next=/path  — start GitHub OAuth (sets CSRF state cookie).

import { NextResponse } from "next/server";
import {
  buildAuthorizeUrl,
  isAuthConfigured,
  newState,
  NEXT_COOKIE,
  oauthFlightCookieAttrs,
  publicOriginForRequest,
  RESYNC_COOKIE,
  safeNext,
  secureCookieForRequest,
  STATE_COOKIE,
} from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isAuthConfigured()) {
    return NextResponse.redirect(new URL("/connect?error=not_configured", request.url));
  }
  const url = new URL(request.url);
  // The EXTERNAL origin (x-forwarded-proto/host aware), NOT url.origin: behind a TLS-terminating
  // proxy url.origin is the internal http origin, and a redirect_uri built from it doesn't match
  // the registered public callback — GitHub rejects the authorize request and sign-in can't start.
  // Must agree with the origin the callback hands to exchangeCodeForToken (same helper).
  const origin = publicOriginForRequest(request);
  const next = safeNext(url.searchParams.get("next"));
  // A "re-sync access" round-trip reuses the whole OAuth flow (GitHub skips the consent
  // screen for an already-authorized user), but the callback should refresh installations
  // in place rather than replaying the first-login /launch cinematic.
  const resync = url.searchParams.get("resync") === "1";
  const state = newState();
  // Derive Secure from x-forwarded-proto (like the session cookie in the callback), NOT the internal
  // request origin: behind a TLS-terminating proxy `url.origin` is the internal http origin, so
  // origin.startsWith("https") is false and the security-critical CSRF state cookie would be minted
  // WITHOUT Secure — transmissible over plaintext. Single-source the decision via secureCookieForRequest.
  const secure = await secureCookieForRequest();

  const res = NextResponse.redirect(buildAuthorizeUrl(origin, state));
  res.cookies.set(STATE_COOKIE, state, oauthFlightCookieAttrs(secure));
  res.cookies.set(NEXT_COOKIE, next, oauthFlightCookieAttrs(secure));
  // Set or clear explicitly so a stale flag from an abandoned re-sync can't make a later
  // fresh sign-in skip the launch screen.
  if (resync) res.cookies.set(RESYNC_COOKIE, "1", oauthFlightCookieAttrs(secure));
  // Clear with the SAME path + secure the cookie was set with (not a bare delete with default attrs):
  // a delete whose attributes don't match the original can leave the cookie in place, so a stale
  // resync=1 from an abandoned flow could make the next FRESH sign-in take the resync branch.
  else res.cookies.set(RESYNC_COOKIE, "", oauthFlightCookieAttrs(secure, 0));
  return res;
}

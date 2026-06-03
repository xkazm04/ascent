// POST /api/auth/logout — revoke the session server-side, then clear the cookie.
//
// POST-only with a same-origin check. A safe-method GET with side effects let any
// third-party page force a sign-out via an embedded <img>/<link rel=prefetch>, and
// link prefetchers/scanners could log users out unexpectedly (drive-by CSRF). There
// is no GET export, so a GET now gets 405; the POST additionally verifies the request
// originates from this site.
//
// Deleting the cookie alone only clears *this* browser — a leaked/stolen copy stays valid
// for the full TTL. So we also bump the login's server-side session version, which
// invalidates every outstanding token for that login on its next resolve. Best-effort:
// with no DB this degrades to the prior cookie-only logout.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, decodeSession } from "@/lib/auth";
import { bumpSessionVersion } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** True when the request demonstrably comes from this same origin. */
function isSameOrigin(request: Request): boolean {
  const host = request.headers.get("host");
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      return new URL(origin).host === host;
    } catch {
      return false;
    }
  }
  // No Origin header (some same-origin top-level navigations): require fetch metadata.
  return request.headers.get("sec-fetch-site") === "same-origin";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Revoke server-side before clearing the cookie, so any other copy of this token is
  // rejected on its next resolve — not just the one we delete below. Never block logout on
  // the DB: a failure here still clears the local cookie.
  try {
    const raw = (await cookies()).get(SESSION_COOKIE)?.value;
    const session = raw ? decodeSession(raw) : null;
    if (session) await bumpSessionVersion(session.login);
  } catch (err) {
    console.warn("[auth/logout] session-version bump failed", err);
  }
  // 303 so the browser follows the redirect with GET after the form POST.
  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

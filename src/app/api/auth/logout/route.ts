// POST /api/auth/logout — clear the session cookie.
//
// POST-only with a same-origin check. A safe-method GET with side effects let any
// third-party page force a sign-out via an embedded <img>/<link rel=prefetch>, and
// link prefetchers/scanners could log users out unexpectedly (drive-by CSRF). There
// is no GET export, so a GET now gets 405; the POST additionally verifies the request
// originates from this site.

import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

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
  // 303 so the browser follows the redirect with GET after the form POST.
  const res = NextResponse.redirect(new URL("/", request.url), 303);
  res.cookies.delete(SESSION_COOKIE);
  return res;
}

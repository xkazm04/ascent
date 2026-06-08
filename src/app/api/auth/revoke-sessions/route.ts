// POST /api/auth/revoke-sessions — "sign out everywhere else". Revokes every OTHER session for the
// signed-in login (bumps the server-side session version, so other devices and any leaked cookie
// copy are rejected on their next resolve) while keeping THIS browser signed in (re-mints this
// cookie at the new version). The revocation primitive (bumpSessionVersion) already backed logout
// and uninstall; this gives the user a self-serve kill switch for a lost/shared machine.
//
// POST-only + same-origin, mirroring logout's CSRF guard: a safe GET with this side effect would
// let a third-party page force-revoke a victim's other sessions via an embedded <img>. Best-effort:
// with no DB there is no revocation authority, so we report that nothing was actually revoked.

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { SESSION_COOKIE, decodeSession, isSameOrigin, revokeOtherSessions } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const raw = (await cookies()).get(SESSION_COOKIE)?.value;
  const session = raw ? decodeSession(raw) : null;
  // No valid session → nothing to revoke; bounce back to connect (303 so the form POST follows with GET).
  if (!session) {
    return NextResponse.redirect(new URL("/connect", request.url), 303);
  }
  try {
    const revoked = await revokeOtherSessions(session);
    return NextResponse.redirect(
      new URL(`/connect?revoked=${revoked ? "others" : "none"}`, request.url),
      303,
    );
  } catch (err) {
    console.warn("[auth/revoke-sessions] failed", err);
    return NextResponse.redirect(new URL("/connect?error=revoke", request.url), 303);
  }
}
